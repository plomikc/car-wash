const { randomBytes } = require("node:crypto");
const {
  clearSessionCookie,
  createSessionCookie,
  getAdminEmail,
  getSessionEmail,
} = require("./_lib/auth");
const { ApiError, handleError, redirect } = require("./_lib/http");
const { request, tablePath } = require("./_lib/supabase");

const STATE_COOKIE = "__Host-carwash_oauth_state";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

function getConfig() {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri } = process.env;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !redirectUri || !appUrl) {
    throw new ApiError(503, "oauth_not_configured", "Falta configurar la conexión segura con Google.");
  }
  return { clientId, clientSecret, redirectUri, appUrl };
}

function getCookie(req, name) {
  const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

function stateCookie(value, maxAge) {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function adminUrl(appUrl, params = {}) {
  const url = new URL("/admin", appUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function begin(req, res, action) {
  const { clientId, redirectUri } = getConfig();
  if (action === "connect" && !getSessionEmail(req)) {
    redirect(res, adminUrl(process.env.APP_URL, { error: "login-required" }));
    return;
  }

  const state = randomBytes(32).toString("hex");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", action === "connect"
    ? `openid email profile ${CALENDAR_SCOPE}`
    : "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", action === "connect" ? "consent select_account" : "select_account");
  authUrl.searchParams.set("access_type", "offline");
  if (action === "connect") authUrl.searchParams.set("include_granted_scopes", "true");
  redirect(res, authUrl.toString(), [stateCookie(`${action}.${state}`, 600)]);
}

async function exchangeCode(code, config) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new ApiError(502, "google_oauth_failed", "Google no pudo completar la autorización.");
  }
  return data;
}

async function getGoogleUser(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = await response.json();
  if (!response.ok || !user.email || user.email_verified !== true) {
    throw new ApiError(401, "google_identity_failed", "No se pudo verificar la cuenta de Google.");
  }
  return user;
}

async function storeRefreshToken(refreshToken, email) {
  await request(tablePath("google_calendar_credentials", { on_conflict: "id" }), {
    method: "POST",
    body: { id: 1, refresh_token: refreshToken, connected_email: email },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function finish(req, res) {
  const appUrl = process.env.APP_URL;
  const clearState = stateCookie("", 0);
  if (!appUrl) {
    handleError(res, new ApiError(503, "oauth_not_configured", "Falta configurar la conexión segura con Google."));
    return;
  }

  let config;
  try {
    config = getConfig();
  } catch {
    redirect(res, adminUrl(appUrl, { error: "oauth-not-configured" }), [clearState]);
    return;
  }

  const { clientId, clientSecret, redirectUri } = config;
  const query = new URL(req.url, appUrl).searchParams;
  const providerError = query.get("error");
  const code = query.get("code");
  const state = query.get("state");
  const stateCookieValue = getCookie(req, STATE_COOKIE);
  const [action, savedState] = (stateCookieValue || "").split(".");

  if (providerError) {
    redirect(res, adminUrl(appUrl, { error: "oauth-canceled" }), [clearState]);
    return;
  }
  if (!code || !state || state !== savedState || !["login", "connect"].includes(action)) {
    redirect(res, adminUrl(appUrl, { error: "oauth-state" }), [clearState, clearSessionCookie()]);
    return;
  }

  if (action === "connect" && !getSessionEmail(req)) {
    redirect(res, adminUrl(appUrl, { error: "login-required" }), [clearState]);
    return;
  }

  try {
    const tokens = await exchangeCode(code, { clientId, clientSecret, redirectUri });
    const user = await getGoogleUser(tokens.access_token);
    const adminEmail = getAdminEmail();
    const email = user.email.trim().toLowerCase();
    if (email !== adminEmail) {
      redirect(res, adminUrl(appUrl, { error: "not-authorized" }), [clearState, clearSessionCookie()]);
      return;
    }

    const cookies = [clearState, createSessionCookie(email)];
    if (action === "connect") {
      if (!tokens.refresh_token) {
        const existing = await request(tablePath("google_calendar_credentials", {
          id: "eq.1",
          select: "id",
          limit: "1",
        }));
        if (!existing.length) {
          redirect(res, adminUrl(appUrl, { error: "calendar-consent" }), cookies);
          return;
        }
      } else {
        await storeRefreshToken(tokens.refresh_token, email);
      }
      redirect(res, adminUrl(appUrl, { connected: "1" }), cookies);
      return;
    }

    redirect(res, adminUrl(appUrl), cookies);
  } catch (error) {
    console.error("Google OAuth callback failed:", error?.message || "Unknown error");
    redirect(res, adminUrl(appUrl, {
      error: error instanceof ApiError && error.code === "backend_not_configured"
        ? "storage-not-configured"
        : "oauth-failed",
    }), [clearState]);
  }
}

module.exports = async function googleAuth(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  const query = new URL(req.url, process.env.APP_URL || "https://localhost").searchParams;
  const action = query.get("action");
  if (action === "logout") {
    if (!process.env.APP_URL) {
      handleError(res, new ApiError(503, "oauth_not_configured", "Falta configurar la dirección del panel."));
      return;
    }
    redirect(res, adminUrl(process.env.APP_URL, { logged_out: "1" }), [clearSessionCookie()]);
    return;
  }
  if (action === "login" || action === "connect") {
    try {
      await begin(req, res, action);
    } catch (error) {
      if (process.env.APP_URL) {
        redirect(res, adminUrl(process.env.APP_URL, {
          error: error instanceof ApiError ? "oauth-not-configured" : "oauth-failed",
        }));
      } else {
        handleError(res, error);
      }
    }
    return;
  }
  if (action === "callback") {
    await finish(req, res);
    return;
  }

  res.status(404).end();
};
