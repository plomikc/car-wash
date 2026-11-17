const { createHmac, timingSafeEqual } = require("node:crypto");
const { ApiError, json } = require("./http");

const SESSION_COOKIE = "__Host-carwash_admin";
const SESSION_SECONDS = 60 * 60 * 8;

function getAdminEmail() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new ApiError(503, "admin_not_configured", "Falta configurar el correo administrador.");
  }
  return email;
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(503, "auth_not_configured", "Falta configurar la clave de sesión del panel.");
  }
  return secret;
}

function cookieValue(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const item = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try {
    return decodeURIComponent(item.slice(name.length + 1));
  } catch {
    return null;
  }
}

function sign(payload) {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function createSessionCookie(email) {
  const payload = Buffer.from(JSON.stringify({
    email: email.toLowerCase(),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  })).toString("base64url");
  const value = `${payload}.${sign(payload)}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function getSessionEmail(req) {
  const value = cookieValue(req, SESSION_COOKIE);
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    if (session.email !== getAdminEmail()) return null;
    return session.email;
  } catch {
    return null;
  }
}

function requireAdmin(req, res) {
  const email = getSessionEmail(req);
  if (email) return email;
  json(res, 401, { error: "unauthorized", message: "Inicia sesión con la cuenta autorizada." });
  return null;
}

module.exports = {
  SESSION_COOKIE,
  clearSessionCookie,
  createSessionCookie,
  getAdminEmail,
  getSessionEmail,
  requireAdmin,
};
