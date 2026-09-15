const toast = document.getElementById("toast");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const modalBody = document.getElementById("modalBody");
const api = (path, options) => fetch(`/api${path}`, options).then(async (response) => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "API request failed");
  return data;
});
const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
};

const openModal = (title, subtitle, rows, actionLabel) => {
  modalTitle.textContent = title;
  modalSubtitle.textContent = subtitle;
  modalBody.innerHTML = `<div class="detail-list">${rows.map(([label, value]) => `<div class="detail-row"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>${actionLabel ? `<button class="modal-action" id="modalAction">${actionLabel} →</button>` : ""}`;
  modalBackdrop.classList.add("open");
  const action = document.getElementById("modalAction");
  if (action) action.addEventListener("click", () => {
    modalBackdrop.classList.remove("open");
    showToast(`${actionLabel} completed`);
  });
};

document.getElementById("modalClose").addEventListener("click", () => modalBackdrop.classList.remove("open"));
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) modalBackdrop.classList.remove("open");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") modalBackdrop.classList.remove("open");
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((navItem) => navItem.classList.remove("active"));
    item.classList.add("active");
    const name = item.textContent.trim().replace(/\s+\d+$/, "");
    const views = {
      "Situation room": ["Situation room", "Current city-wide operational picture", [["Active incidents", "12"], ["People at risk", "8,460"], ["Readiness", "94%"]]],
      "Live incidents": ["Live incidents", "All active reports requiring coordination", [["Critical", "3 incidents"], ["High", "5 incidents"], ["Medium", "4 incidents"]]],
      "Shelters & capacity": ["Shelters & capacity", "Current evacuation center availability", [["Open shelters", "8"], ["Beds available", "1,280"], ["Occupancy", "72%"]]],
      Resources: ["Resources", "Rescue, medical and utility deployment", [["Teams deployed", "47 / 50"], ["Vehicles available", "18"], ["Medical kits", "324"]]],
      "Public alerts": ["Public alerts", "Emergency communications sent to residents", [["Reach in 24 hours", "84.2K people"], ["Active advisories", "2"], ["Delivery rate", "98.6%"]]]
    };
    const view = views[name];
    openModal(view[0], view[1], view[2], name === "Situation room" ? "" : `Open ${name}`);
  });
});

document.querySelectorAll(".map-controls button").forEach((control) => {
  control.addEventListener("click", () => {
    document.querySelectorAll(".map-controls button").forEach((button) => button.classList.remove("selected"));
    control.classList.add("selected");
    showToast(`${control.textContent} map layer enabled`);
  });
});

document.getElementById("dismissAlert").addEventListener("click", (event) => {
  api("/alerts/dismiss", { method: "POST" })
    .then(() => {
      event.currentTarget.closest(".alert-banner").remove();
      showToast("Monsoon advisory dismissed");
    })
    .catch((error) => showToast(error.message));
});

document.getElementById("dispatchButton").addEventListener("click", () => {
  api("/incidents/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentId: document.querySelector(".active-incident")?.dataset.incidentId })
  }).then((data) => showToast(data.message)).catch((error) => showToast(error.message));
});

document.getElementById("exportButton").addEventListener("click", () => {
  api("/briefing").then((data) => openModal("Export briefing", "Your current operational snapshot is ready", [["Report", "Situation room · 14 Oct 2026"], ["Coverage", "Kochi metropolitan region"], ["Incidents", String(data.incidents.length)], ["Format", "JSON briefing"]], "Download briefing")).catch((error) => showToast(error.message));
});

document.querySelector(".icon-button").addEventListener("click", () => {
  showToast("No new emergency notifications");
});

document.querySelectorAll(".more").forEach((button) => {
  button.addEventListener("click", () => {
    const label = button.textContent.replace("↗", "").trim();
    if (label === "View all") {
      openModal("All priority incidents", "12 incidents sorted by response urgency", [["Critical", "Canal overflow · Palarivattom"], ["High", "Road submerged · Kaloor"], ["High", "Power outage · Vyttila"], ["Medium", "Medical evacuation · Edappally"]], "Assign response team");
    } else {
      openModal("Field response teams", "Live deployment and availability", [["Alpha 01", "En route · ETA 06 min"], ["Medical 03", "On site · Edappally"], ["Utility 02", "Standby · ETA 18 min"], ["Available reserve", "3 teams"]], "Deploy reserve team");
    }
  });
});

document.querySelectorAll(".incident").forEach((incident) => {
  const incidentNames = { "Canal overflow": "inc-001", "Road submerged": "inc-002", "Power outage": "inc-003", "Medical evacuation": "inc-004" };
  incident.dataset.incidentId = incidentNames[incident.querySelector("strong").textContent];
  incident.addEventListener("click", () => {
    document.querySelectorAll(".incident").forEach((item) => item.classList.remove("active-incident"));
    incident.classList.add("active-incident");
    showToast(`${incident.querySelector("strong").textContent} selected for response coordination`);
  });
});

const tooltip = document.getElementById("mapTooltip");
document.querySelectorAll(".map-pin").forEach((pin) => {
  pin.addEventListener("click", () => {
    tooltip.textContent = pin.dataset.incident;
    tooltip.style.display = "block";
    tooltip.style.left = `${pin.offsetLeft + 30}px`;
    tooltip.style.top = `${pin.offsetTop - 6}px`;
    window.clearTimeout(pin.tooltipTimer);
    pin.tooltipTimer = window.setTimeout(() => (tooltip.style.display = "none"), 2600);
  });
});
