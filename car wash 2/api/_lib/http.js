class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function redirect(res, location, cookies = []) {
  res.setHeader("Cache-Control", "no-store");
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.writeHead(302, { Location: location });
  res.end();
}

function requireMethod(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { error: "method_not_allowed" });
  return false;
}

function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body !== "string") {
    throw new ApiError(400, "invalid_body", "Se esperaba un objeto JSON.");
  }

  try {
    return JSON.parse(req.body);
  } catch {
    throw new ApiError(400, "invalid_body", "El JSON enviado no es válido.");
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;

  try {
    const parsedOrigin = new URL(origin);
    const requestOrigin = parsedOrigin.origin;
    const appOrigin = process.env.APP_URL
      ? new URL(process.env.APP_URL).origin
      : null;
    return requestOrigin === appOrigin || parsedOrigin.host === req.headers.host;
  } catch {
    return false;
  }
}

function handleError(res, error) {
  if (error instanceof ApiError) {
    json(res, error.status, { error: error.code, message: error.message });
    return;
  }

  console.error("API request failed:", error?.message || "Unknown error");
  json(res, 500, { error: "internal_error", message: "Ocurrió un error. Intenta de nuevo." });
}

module.exports = { ApiError, handleError, json, readJson, redirect, requireMethod, sameOrigin };
