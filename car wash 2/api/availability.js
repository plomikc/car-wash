const { handleError, json, requireMethod } = require("./_lib/http");
const {
  TIMES,
  getLocalDate,
  getUnavailableTimes,
  isValidDate,
} = require("./_lib/calendar");

module.exports = async function availability(req, res) {
  if (!requireMethod(req, res, ["GET"])) return;
  const date = new URL(req.url, "https://localhost").searchParams.get("date");
  if (!isValidDate(date)) {
    json(res, 400, { error: "invalid_date", message: "Selecciona una fecha válida." });
    return;
  }
  if (date < getLocalDate()) {
    json(res, 400, { error: "past_date", message: "La fecha seleccionada ya pasó." });
    return;
  }
  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) {
    json(res, 200, { availableTimes: [], busyTimes: TIMES, message: "No se reciben citas los domingos." });
    return;
  }

  try {
    const unavailable = await getUnavailableTimes(date);
    json(res, 200, {
      availableTimes: TIMES.filter((time) => !unavailable.has(time)),
      busyTimes: TIMES.filter((time) => unavailable.has(time)),
    });
  } catch (error) {
    handleError(res, error);
  }
};
