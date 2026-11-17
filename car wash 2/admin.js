const loginCard = document.querySelector("#login-card");
const loginMessage = document.querySelector("#login-message");
const dashboard = document.querySelector("#dashboard");
const dashboardMessage = document.querySelector("#dashboard-message");
const calendarStatus = document.querySelector("#calendar-status");
const calendarConnect = document.querySelector("#calendar-connect");
const bookingList = document.querySelector("#booking-list");
const emptyState = document.querySelector("#empty-state");
const refreshButton = document.querySelector("#refresh-button");

const query = new URLSearchParams(window.location.search);
const loginErrors = {
  "login-required": "Inicia sesión antes de conectar Google Calendar.",
  "not-authorized": "Esta cuenta de Google no tiene permiso para entrar al panel.",
  "oauth-state": "No se pudo validar la conexión segura. Intenta de nuevo.",
  "oauth-canceled": "Se canceló la autorización de Google.",
  "calendar-consent": "Google no otorgó acceso al calendario. Vuelve a conectarlo y acepta los permisos.",
  "oauth-not-configured": "Falta configurar Google OAuth y la clave de sesión en Vercel.",
  "oauth-failed": "No se pudo completar la conexión con Google. Revisa la configuración e inténtalo de nuevo.",
  "storage-not-configured": "Falta configurar Supabase en Vercel.",
  "oauth_not_configured": "Falta configurar Google OAuth y la clave de sesión en Vercel.",
};

function showLogin(message) {
  loginCard.hidden = false;
  dashboard.hidden = true;
  if (message) loginMessage.textContent = message;
}

function showError(message) {
  dashboardMessage.textContent = message;
  dashboardMessage.dataset.state = "error";
}

function clearMessage() {
  dashboardMessage.textContent = "";
  delete dashboardMessage.dataset.state;
}

async function getJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("El servidor devolvió una respuesta no válida.");
  }
  if (!response.ok) {
    const error = new Error(data.message || "No se pudo completar la operación.");
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

function serviceName(value) {
  return {
    "Tunnel wash": "Lavado en túnel",
    "Self wash": "Lavado autoservicio",
    "Chemical wash": "Lavado especial",
    "Hand wash": "Lavado a mano",
  }[value] || value;
}

function vehicleName(value) {
  return {
    Regular_size: "Auto estándar",
    Minivan: "Miniván",
    Pickup_truck: "Camioneta pickup",
    Cargo_truck: "Camión de carga",
  }[value] || value;
}

function createDetail(label, value) {
  const item = document.createElement("p");
  const name = document.createElement("strong");
  name.textContent = `${label}: `;
  item.append(name, document.createTextNode(value || "—"));
  return item;
}

function renderBookings(bookings) {
  bookingList.replaceChildren();
  emptyState.hidden = bookings.length > 0;

  for (const booking of bookings) {
    const card = document.createElement("article");
    card.className = "booking-card";
    const heading = document.createElement("div");
    heading.className = "booking-card__heading";
    const title = document.createElement("h2");
    title.textContent = booking.customer_name;
    const date = document.createElement("time");
    date.textContent = `${booking.requested_date} · ${String(booking.requested_time).slice(0, 5)}`;
    heading.append(title, date);

    const details = document.createElement("div");
    details.className = "booking-card__details";
    details.append(
      createDetail("Servicio", serviceName(booking.wash_package)),
      createDetail("Vehículo", vehicleName(booking.vehicle_type)),
      createDetail("Correo", booking.customer_email),
      createDetail("Ciudad", booking.city),
      createDetail("Mensaje", booking.customer_message),
    );

    const actions = document.createElement("div");
    actions.className = "booking-card__actions";
    const approveButton = document.createElement("button");
    approveButton.className = "admin-button";
    approveButton.type = "button";
    approveButton.textContent = "Aprobar y agendar";
    approveButton.addEventListener("click", () => handleBookingAction(booking.id, "approve", approveButton));
    const rejectButton = document.createElement("button");
    rejectButton.className = "admin-button admin-button--danger";
    rejectButton.type = "button";
    rejectButton.textContent = "Rechazar";
    rejectButton.addEventListener("click", () => handleBookingAction(booking.id, "reject", rejectButton));
    actions.append(approveButton, rejectButton);

    card.append(heading, details, actions);
    bookingList.append(card);
  }
}

async function handleBookingAction(id, action, button) {
  button.disabled = true;
  clearMessage();
  try {
    await getJson("/api/admin/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    await loadDashboard();
  } catch (error) {
    if (error.status === 401) {
      showLogin("Tu sesión terminó. Inicia sesión de nuevo.");
      return;
    }
    showError(error.message);
    button.disabled = false;
  }
}

async function loadDashboard() {
  refreshButton.disabled = true;
  clearMessage();
  try {
    const calendar = await getJson("/api/admin/calendar");
    loginCard.hidden = true;
    dashboard.hidden = false;
    calendarStatus.textContent = calendar.connected
      ? `Conectado: ${calendar.email}`
      : calendar.reconnectRequired
        ? "La conexión necesita renovarse. Vuelve a autorizar Google Calendar."
        : "Aún no está conectado. Las solicitudes se podrán aprobar después de autorizar el calendario.";
    calendarConnect.hidden = calendar.connected;
    calendarConnect.textContent = calendar.reconnectRequired
      ? "Volver a conectar"
      : "Conectar calendario";

    const result = await getJson("/api/admin/bookings");
    renderBookings(result.bookings || []);
  } catch (error) {
    if (error.status === 401) {
      showLogin("Inicia sesión con la cuenta autorizada para continuar.");
      return;
    }
    loginCard.hidden = true;
    dashboard.hidden = false;
    showError(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadDashboard);

if (query.has("error")) {
  showLogin(loginErrors[query.get("error")] || "No se pudo completar el acceso.");
} else if (query.has("connected")) {
  loginMessage.textContent = "Google Calendar quedó conectado.";
  loadDashboard();
} else if (query.has("logged_out")) {
  showLogin("Se cerró la sesión.");
} else {
  loadDashboard();
}
