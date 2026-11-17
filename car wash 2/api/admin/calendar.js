const { handleError, json, requireMethod } = require("../_lib/http");
const { requireAdmin } = require("../_lib/auth");
const { getAccessToken } = require("../_lib/calendar");
const { request, tablePath } = require("../_lib/supabase");

module.exports = async function adminCalendar(req, res) {
  if (!requireMethod(req, res, ["GET"])) return;
  const email = requireAdmin(req, res);
  if (!email) return;

  try {
    const rows = await request(tablePath("google_calendar_credentials", {
      id: "eq.1",
      select: "connected_email,updated_at",
      limit: "1",
    }));
    const connection = rows?.[0];
    let connected = Boolean(connection);
    let reconnectRequired = false;
    if (connected) {
      try {
        await getAccessToken();
      } catch (error) {
        connected = false;
        reconnectRequired = error?.code === "calendar_reconnect_required";
        if (!reconnectRequired) throw error;
      }
    }
    json(res, 200, {
      connected,
      reconnectRequired,
      email: connection?.connected_email || null,
      connectedAt: connection?.updated_at || null,
    });
  } catch (error) {
    handleError(res, error);
  }
};
