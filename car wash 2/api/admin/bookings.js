const { ApiError, handleError, json, readJson, requireMethod, sameOrigin } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { createCalendarEvent, getCalendarEvent, getLocalDate, getUnavailableTimes, isPastDateTime, isValidDate, TIMES } = require("../_lib/calendar");
const { request, tablePath } = require("../_lib/supabase");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function updateBooking(id, status, extra = {}, fromStatus) {
  const query = {
    id: `eq.${id}`,
    select: "id,status",
  };
  if (fromStatus) query.status = `eq.${fromStatus}`;
  const rows = await request(tablePath("booking_requests", query), {
    method: "PATCH",
    body: { status, updated_at: new Date().toISOString(), ...extra },
    prefer: "return=representation",
  });
  return rows?.[0] || null;
}

async function restorePending(id) {
  await updateBooking(id, "pending", { calendar_event_id: null });
}

async function approve(id) {
  const claimed = await updateBooking(id, "approving", {}, "pending");
  if (!claimed) throw new ApiError(409, "request_already_handled", "La solicitud ya fue atendida.");

  try {
    const rows = await request(tablePath("booking_requests", {
      id: `eq.${id}`,
      select: "*",
      limit: "1",
    }));
    const booking = rows?.[0];
    if (!booking) throw new ApiError(404, "request_not_found", "No se encontró la solicitud.");
    if (!isValidDate(booking.requested_date)
      || !TIMES.includes(String(booking.requested_time).slice(0, 5))
      || booking.requested_date < getLocalDate()
      || isPastDateTime(booking.requested_date, String(booking.requested_time).slice(0, 5))) {
      throw new ApiError(409, "request_expired", "La fecha u hora de esta solicitud ya no es válida.");
    }

    let eventId = await getCalendarEvent(booking);
    if (!eventId) {
      const unavailable = await getUnavailableTimes(booking.requested_date, id);
      if (unavailable.has(String(booking.requested_time).slice(0, 5))) {
        throw new ApiError(409, "slot_unavailable", "El horario se ocupó. No se creó el evento.");
      }
      eventId = await createCalendarEvent(booking);
    }

    const confirmed = await updateBooking(id, "confirmed", { calendar_event_id: eventId });
    if (!confirmed) throw new ApiError(503, "confirmation_failed", "El evento se creó, pero no se pudo actualizar la solicitud.");
    return confirmed;
  } catch (error) {
    await restorePending(id);
    throw error;
  }
}

async function reject(id) {
  const rows = await request(tablePath("booking_requests", {
    id: `eq.${id}`,
    status: "eq.pending",
    select: "id,status",
  }), {
    method: "PATCH",
    body: { status: "rejected", updated_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  if (!rows?.length) throw new ApiError(409, "request_already_handled", "La solicitud ya fue atendida.");
  return rows[0];
}

module.exports = async function adminBookings(req, res) {
  if (!requireMethod(req, res, ["GET", "POST"])) return;
  if (req.method === "POST" && !sameOrigin(req)) {
    json(res, 403, { error: "origin_not_allowed" });
    return;
  }
  const email = requireAdmin(req, res);
  if (!email) return;

  try {
    if (req.method === "GET") {
      const rows = await request(tablePath("booking_requests", {
        status: "eq.pending",
        select: "id,vehicle_type,wash_package,customer_name,customer_email,city,requested_date,requested_time,customer_message,created_at",
        order: "created_at.desc",
        limit: "100",
      }));
      json(res, 200, { bookings: rows || [] });
      return;
    }

    const body = readJson(req);
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID.test(id) || !["approve", "reject"].includes(body.action)) {
      throw new ApiError(400, "invalid_action", "La acción solicitada no es válida.");
    }

    let result;
    if (body.action === "approve") {
      result = await approve(id);
    } else {
      result = await reject(id);
    }
    json(res, 200, { id: result.id, status: result.status });
  } catch (error) {
    if (error?.databaseCode === "23505") {
      json(res, 409, { error: "slot_unavailable", message: "Ese horario ya tiene otra solicitud confirmada." });
      return;
    }
    handleError(res, error);
  }
};
