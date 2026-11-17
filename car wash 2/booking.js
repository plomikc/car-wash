const form = document.querySelector("#bookCar");
const dateInput = document.querySelector("#date");
const timeInput = document.querySelector("#time");
const availabilityStatus = document.querySelector("#availability-status");
const formStatus = document.querySelector("#form-status");
const whatsappNumber = "526861352440";

if (!(form instanceof HTMLFormElement)
  || !(dateInput instanceof HTMLInputElement)
  || !(timeInput instanceof HTMLSelectElement)) {
  throw new Error("No se encontró el formulario de reserva o sus campos de fecha y hora.");
}

const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Tijuana",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date()).map(({ type, value }) => [type, value]));
dateInput.min = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;

const timeOptions = [...timeInput.options].filter((option) => option.value);
timeOptions.forEach((option) => {
  option.dataset.label = option.textContent;
});

function setFormStatus(message, state = "") {
  if (!formStatus) return;
  formStatus.textContent = message;
  if (state) formStatus.dataset.state = state;
  else delete formStatus.dataset.state;
}

function validateBusinessDay() {
  const selectedDate = dateInput.value
    ? new Date(`${dateInput.value}T12:00:00Z`)
    : null;
  const isSunday = selectedDate?.getUTCDay() === 0;
  dateInput.setCustomValidity(isSunday ? "El negocio recibe citas de lunes a sábado." : "");
  if (isSunday) {
    timeInput.value = "";
    timeOptions.forEach((option) => {
      option.disabled = true;
    });
    if (availabilityStatus) availabilityStatus.textContent = "No se reciben citas los domingos.";
    setFormStatus("No se reciben citas los domingos.", "error");
  } else if (formStatus?.textContent === "No se reciben citas los domingos.") {
    setFormStatus("");
  }
  return !isSunday;
}

function resetTimeOptions() {
  timeOptions.forEach((option) => {
    option.disabled = false;
    option.textContent = option.dataset.label;
  });
}

async function loadAvailability() {
  if (!dateInput.value) {
    resetTimeOptions();
    if (availabilityStatus) availabilityStatus.textContent = "";
    return;
  }
  if (!validateBusinessDay()) return;

  const requestedDate = dateInput.value;
  timeInput.value = "";
  timeOptions.forEach((option) => {
    option.disabled = true;
  });
  if (availabilityStatus) availabilityStatus.textContent = "Consultando horarios disponibles…";

  try {
    const response = await fetch(`/api/availability?date=${encodeURIComponent(requestedDate)}`, {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "No se pudo consultar la agenda.");
    if (dateInput.value !== requestedDate) return;

    const available = new Set(result.availableTimes);
    timeOptions.forEach((option) => {
      const isAvailable = available.has(option.value);
      option.disabled = !isAvailable;
      option.textContent = isAvailable
        ? option.dataset.label
        : `${option.dataset.label} — no disponible`;
    });

    if (availabilityStatus) {
      availabilityStatus.textContent = available.size
        ? "Los horarios ocupados aparecen deshabilitados."
        : result.message || "No hay horarios disponibles para esta fecha.";
    }
  } catch {
    if (dateInput.value !== requestedDate) return;
    resetTimeOptions();
    if (availabilityStatus) {
      availabilityStatus.textContent = "No se pudo verificar Google Calendar; el dueño confirmará la disponibilidad.";
    }
  }
}

dateInput.addEventListener("input", validateBusinessDay);
dateInput.addEventListener("change", () => {
  if (validateBusinessDay()) loadAvailability();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  validateBusinessDay();
  if (!form.reportValidity()) {
    setFormStatus("Revisa los datos del formulario antes de enviar la solicitud.", "error");
    return;
  }

  const formData = new FormData(form);
  const booking = {
    vehicleType: formData.get("vehicle-type"),
    washPackage: formData.get("wash_packages"),
    name: formData.get("Name"),
    email: formData.get("email"),
    city: formData.get("city"),
    date: formData.get("date"),
    time: formData.get("time"),
    message: formData.get("message"),
    website: formData.get("website"),
  };
  const whatsappWindow = window.open("about:blank", "_blank");
  if (whatsappWindow) whatsappWindow.opener = null;

  let savedRequest = null;
  let saveError = null;
  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(booking),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.message || "No se pudo registrar la solicitud.");
      error.status = response.status;
      error.code = result.error;
      throw error;
    }
    savedRequest = result;
  } catch (error) {
    saveError = error;
  }

  if (saveError?.code === "slot_unavailable" || saveError?.code === "past_time") {
    whatsappWindow?.close();
    await loadAvailability();
    setFormStatus(saveError.message, "error");
    timeInput.focus();
    return;
  }

  const message = [
    "¡Hola! Me gustaría solicitar una cita para lavar mi auto.",
    "",
    `Vehículo: ${booking.vehicleType}`,
    `Tipo de lavado: ${booking.washPackage}`,
    `Nombre: ${booking.name}`,
    `Correo: ${booking.email}`,
    `Ciudad: ${booking.city}`,
    `Fecha preferida: ${booking.date}`,
    `Hora preferida: ${booking.time}`,
    `Mensaje: ${booking.message || "Sin mensaje adicional"}`,
    savedRequest?.id ? `Folio de solicitud: ${savedRequest.id}` : "",
    "",
    "Entiendo que la cita queda pendiente de confirmación.",
  ].filter(Boolean).join("\n");
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  if (whatsappWindow) {
    whatsappWindow.location.href = whatsappUrl;
  } else {
    window.location.assign(whatsappUrl);
  }

  if (savedRequest) {
    setFormStatus(savedRequest.availabilityChecked
      ? "Solicitud guardada como pendiente. El dueño confirmará la cita por WhatsApp."
      : "Solicitud guardada como pendiente. La disponibilidad de Calendar aún no pudo verificarse.", "success");
  } else {
    setFormStatus("Se abrirá WhatsApp, pero la solicitud no quedó guardada en el panel. El dueño tendrá que confirmar la disponibilidad.", "error");
  }
});
