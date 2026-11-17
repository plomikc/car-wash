const { ApiError } = require("./http");

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ApiError(503, "backend_not_configured", "El panel aún no está conectado a Supabase.");
  }
  return { url, key };
}

async function request(path, { method = "GET", body, prefer } = {}) {
  const { url, key } = config();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = new ApiError(
      response.status === 409 ? 409 : 503,
      response.status === 409 ? "database_conflict" : "database_error",
      "No se pudo completar la operación de almacenamiento.",
    );
    error.databaseCode = data?.code;
    throw error;
  }

  return data;
}

function tablePath(table, query = {}) {
  const params = new URLSearchParams(query);
  return `${table}?${params.toString()}`;
}

module.exports = { request, tablePath };
