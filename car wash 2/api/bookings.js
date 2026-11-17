const { createHmac } = require("node:crypto");
const { ApiError, handleError, json, readJson, requireMethod, sameOrigin } = require("./_lib/http");
const { getLocalDate, getUnavailableTimes, isPastDateTime, isValidDate, TIMES } = require("./_lib/calendar");
const { request, tablePath } = require("./_lib/supabase");

const VEHICLES = new Set(["Regular_size", "Minivan", "Pickup_truck", "Cargo_truck"]);
const SERVICES = new Set(["Tunnel wash", "Self wash", "Chemical wash", "Hand wash"]);

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getIpHash(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(503, "backend_not_configured", "El panel aún no está configurado.");
  }
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : req.socket?.remoteAddress || "unknown";
  return createHmac("sha256", secret).update(ip).digest("hex");
}

async function checkRateLimit(ipHash) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rows = await request(tablePath("booking_requests", {
    ip_hash: `eq.${ipHash}`,
    created_at: `gt.${since}`,
    select: "id",
    limit: "5",
  }));
  if (rows.length >= 5) {
    throw new ApiError(429, "rate_limited", "Espera unos minutos antes de enviar otra solicitud.");
  }
}

module.exports = async function createBooking(req, res) {
  if (!requireMethod(req, res, ["POST"])) return;
  if (!sameOrigin(req)) {
    json(res, 403, { error: "origin_not_allowed" });
    return;
  }

  try {
    const body = readJson(req);
    if (text(body.website, 200)) {
      json(res, 400, { error: "invalid_request" });
      return;
    }

    const booking = {
      vehicle_type: text(body.vehicleType, 80),
      wash_package: text(body.washPackage, 80),
      customer_name: text(body.name, 120),
      customer_email: text(body.email, 254).toLowerCase(),
      city: text(body.city, 100),
      requested_date: text(body.date, 10),
      requested_time: text(body.time, 5),
      customer_message: text(body.message, 1000),
    };

    if (!VEHICLES.has(booking.vehicle_type)
      || !SERVICES.has(booking.wash_package)
      || booking.customer_name.length < 2
      || !validEmail(booking.customer_email)
      || booking.city.length < 2
      || !isValidDate(booking.requested_date)
      || !TIMES.includes(booking.requested_time)) {
      throw new ApiError(400, "invalid_booking", "Revisa los datos de la solicitud.");
    }
    if (booking.requested_date < getLocalDate()) {
      throw new ApiError(400, "past_date", "La fecha seleccionada ya pasó.");
    }
    if (isPastDateTime(booking.requested_date, booking.requested_time)) {
      throw new ApiError(400, "past_time", "La hora seleccionada ya pasó.");
    }
    if (new Date(`${booking.requested_date}T12:00:00Z`).getUTCDay() === 0) {
      throw new ApiError(400, "closed_day", "No se reciben citas los domingos.");
    }

    const ipHash = getIpHash(req);
    await checkRateLimit(ipHash);

    let availabilityChecked = false;
    try {
      const unavailable = await getUnavailableTimes(booking.requested_date);
      availabilityChecked = true;
      if (unavailable.has(booking.requested_time)) {
        throw new ApiError(409, "slot_unavailable", "Ese horario ya no está disponible. Selecciona otro.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "slot_unavailable") throw error;
      if (!(error instanceof ApiError)
        || !["calendar_not_configured", "calendar_not_connected", "calendar_reconnect_required", "calendar_unavailable"].includes(error.code)) {
        throw error;
      }
    }

    const rows = await request("booking_requests", {
      method: "POST",
      body: { ...booking, ip_hash: ipHash },
      prefer: "return=representation",
    });
    const saved = rows?.[0];
    if (!saved?.id) throw new ApiError(503, "save_failed", "No se pudo guardar la solicitud.");

    json(res, 201, { id: saved.id, status: saved.status, availabilityChecked });
  } catch (error) {
    handleError(res, error);
  }
};
