const { ApiError } = require("./http");
const { request, tablePath } = require("./supabase");

const TIME_ZONE = "America/Tijuana";
const TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

function calendarConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!clientId || !clientSecret || !calendarId) {
    throw new ApiError(503, "calendar_not_configured", "Google Calendar aún no está configurado.");
  }
  return { clientId, clientSecret, calendarId };
}

function getLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateTimeInZone(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
  const localAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return new Date(utcGuess - (localAsUtc - utcGuess)).toISOString();
}

function isPastDateTime(date, time) {
  return new Date(dateTimeInZone(date, time)).getTime() <= Date.now();
}

function getDateTimeSlots(date) {
  return TIMES.map((start) => {
    const endHour = Number(start.slice(0, 2)) + 1;
    const end = `${String(endHour).padStart(2, "0")}:00`;
    return {
      start,
      startIso: dateTimeInZone(date, start),
      endIso: dateTimeInZone(date, end),
    };
  });
}

async function getRefreshToken() {
  const rows = await request(tablePath("google_calendar_credentials", {
    id: "eq.1",
    select: "refresh_token",
    limit: "1",
  }));
  const token = rows?.[0]?.refresh_token;
  if (!token) {
    throw new ApiError(503, "calendar_not_connected", "El dueño aún no ha conectado su Google Calendar.");
  }
  return token;
}

async function getAccessToken() {
  const { clientId, clientSecret } = calendarConfig();
  const refreshToken = await getRefreshToken();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new ApiError(503, "calendar_reconnect_required", "Hay que volver a conectar Google Calendar.");
  }
  return data.access_token;
}

async function getBusyTimes(date) {
  const { calendarId } = calendarConfig();
  const accessToken = await getAccessToken();
  const slots = getDateTimeSlots(date);
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: dateTimeInZone(date, "10:00"),
      timeMax: dateTimeInZone(date, "18:00"),
      timeZone: TIME_ZONE,
      items: [{ id: calendarId }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(503, "calendar_unavailable", "No se pudo consultar Google Calendar.");
  }

  const busy = data.calendars?.[calendarId]?.busy || [];
  return slots.filter((slot) => busy.some((interval) =>
    new Date(interval.start) < new Date(slot.endIso)
    && new Date(interval.end) > new Date(slot.startIso),
  )).map((slot) => slot.start);
}

async function getClaimedTimes(date, excludeBookingId) {
  const query = {
    requested_date: `eq.${date}`,
    status: "eq.approving",
    select: "requested_time",
  };
  if (excludeBookingId) query.id = `neq.${excludeBookingId}`;
  const rows = await request(tablePath("booking_requests", query));
  return rows.map(({ requested_time: time }) => String(time).slice(0, 5));
}

async function getUnavailableTimes(date, excludeBookingId) {
  const [busyTimes, claimedTimes] = await Promise.all([
    getBusyTimes(date),
    getClaimedTimes(date, excludeBookingId),
  ]);
  return new Set([
    ...busyTimes,
    ...claimedTimes,
    ...TIMES.filter((time) => isPastDateTime(date, time)),
  ]);
}

async function createCalendarEvent(booking) {
  const { calendarId } = calendarConfig();
  const accessToken = await getAccessToken();
  const start = `${String(booking.requested_time).slice(0, 5)}`;
  const [hours, minutes] = start.split(":").map(Number);
  const end = `${String(hours + 1).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const eventId = booking.id.replaceAll("-", "");
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: eventId,
        summary: `Andrew's Car Wash — ${booking.customer_name}`,
        extendedProperties: { private: { bookingRequestId: booking.id } },
        description: [
          `Servicio: ${booking.wash_package}`,
          `Vehículo: ${booking.vehicle_type}`,
          `Correo: ${booking.customer_email}`,
          `Ciudad: ${booking.city}`,
          booking.customer_message ? `Mensaje: ${booking.customer_message}` : "",
          `Solicitud: ${booking.id}`,
        ].filter(Boolean).join("\n"),
        start: { dateTime: dateTimeInZone(booking.requested_date, start), timeZone: TIME_ZONE },
        end: { dateTime: dateTimeInZone(booking.requested_date, end), timeZone: TIME_ZONE },
      }),
    },
  );
  if (response.status === 409) {
    const existing = await getCalendarEvent(booking);
    if (existing) return existing;
    throw new ApiError(503, "calendar_event_conflict", "No se pudo verificar el evento existente en Google Calendar.");
  }
  const data = await response.json();
  if (!response.ok || !data.id) {
    throw new ApiError(503, "calendar_event_failed", "No se pudo crear el evento en Google Calendar.");
  }
  return data.id;
}

async function getCalendarEvent(booking) {
  const { calendarId } = calendarConfig();
  const accessToken = await getAccessToken();
  const eventId = booking.id.replaceAll("-", "");
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404) return null;

  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(503, "calendar_event_lookup_failed", "No se pudo consultar el evento en Google Calendar.");
  }
  if (data.extendedProperties?.private?.bookingRequestId !== booking.id) {
    throw new ApiError(409, "calendar_event_conflict", "El evento asociado a esta solicitud no se pudo verificar.");
  }
  return data.id;
}

module.exports = {
  TIMES,
  TIME_ZONE,
  createCalendarEvent,
  dateTimeInZone,
  getAccessToken,
  getBusyTimes,
  getCalendarEvent,
  getClaimedTimes,
  getDateTimeSlots,
  getLocalDate,
  getUnavailableTimes,
  isValidDate,
  isPastDateTime,
};
