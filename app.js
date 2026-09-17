const toast = document.getElementById("toast");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const modalBody = document.getElementById("modalBody");
const incidentPhotoUrls = new Map();
let worldMap;
const mapMarkers = [];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const api = (path, options) => fetch(`/api${path}`, options).then(async (response) => {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  let data;
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`The server returned invalid JSON (${response.status}).`);
    }
  } else {
    throw new Error(response.ok
      ? "The app server returned HTML instead of JSON. Open the dashboard through http://localhost:4173."
      : `The app server returned an unexpected response (${response.status}).`);
  }
  if (!response.ok) throw new Error(data.error || "API request failed");
  return data;
});
const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
};

const readImageAsDataUrl = (file) => new Promise((resolve, reject) => {
  if (!file || !file.size) return resolve(null);
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const maxDimension = 1800;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ name: file.name.replace(/\.[^.]+$/, ".jpg"), dataUrl: canvas.toDataURL("image/jpeg", 0.78) });
    };
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = reader.result;
  };
  reader.onerror = () => reject(new Error("The selected image could not be read."));
  reader.readAsDataURL(file);
});

const renderDashboard = (data) => {
  const metricValues = document.querySelectorAll(".stat-card > strong");
  if (metricValues[0]) metricValues[0].textContent = data.metrics.activeIncidents;
  if (metricValues[1]) metricValues[1].textContent = Number(data.metrics.peopleAtRisk).toLocaleString();
  if (metricValues[2]) metricValues[2].textContent = `${data.metrics.shelterCapacity}%`;
  if (metricValues[3]) metricValues[3].textContent = `${data.metrics.readiness}%`;
  const activeIncidentCount = document.getElementById("activeIncidentCount");
  if (activeIncidentCount) activeIncidentCount.textContent = `${data.metrics.activeIncidents} active incidents`;
  const incidentBadge = document.querySelector(".nav-item:nth-child(2) b");
  if (incidentBadge) incidentBadge.textContent = data.metrics.activeIncidents;
  const incidentList = document.querySelector(".incident-list");
  if (incidentList && data.incidents.length) {
    incidentList.innerHTML = data.incidents.slice(0, 4).map((incident, index) => {
      if (incident.photoUrl) incidentPhotoUrls.set(incident.id, incident.photoUrl);
      const severityClass = incident.severity.toLowerCase() === "critical" ? "critical-text" : incident.severity.toLowerCase() === "high" ? "high-text" : "medium-text";
      const markerClass = incident.severity.toLowerCase() === "critical" ? "red" : incident.severity.toLowerCase() === "high" ? "orange" : "yellow";
      return `<button class="incident${index === 0 ? " active-incident" : ""}" data-incident-id="${escapeHtml(incident.id)}"><span class="incident-marker ${markerClass}">!</span><span class="incident-copy"><strong>${escapeHtml(incident.title)}</strong><small>${escapeHtml(incident.location)} · ${escapeHtml(incident.age)}</small></span><span class="severity ${severityClass}">${escapeHtml(incident.severity)}</span></button>`;
    }).join("");
    bindIncidentSelection();
  }
  renderWorldMap(data.incidents);
  const teamRows = document.querySelector(".table-panel tbody");
  if (teamRows) {
    teamRows.innerHTML = data.teams.map((team) => `<tr><td><span class="team-icon">↟</span> ${escapeHtml(team.name)}</td><td>${escapeHtml(team.assignment || "Unassigned")}</td><td><span class="status ${team.status === "Standby" ? "waiting-status" : "active-status"}">● ${escapeHtml(team.status)}</span></td><td>${escapeHtml(team.eta)}</td></tr>`).join("");
  }
  const alertBanner = document.querySelector(".alert-banner");
  if (alertBanner && !data.alert) alertBanner.remove();
  if (alertBanner && data.alert) {
    const alertText = alertBanner.querySelector("div:nth-child(2)");
    if (alertText) alertText.innerHTML = `<strong>${escapeHtml(data.alert.title)}</strong><span>${escapeHtml(data.alert.message)}</span>`;
  }
};

const renderWorldMap = (incidents) => {
  if (!window.L || !document.getElementById("worldMap")) return;
  if (!worldMap) {
    worldMap = L.map("worldMap", { worldCopyJump: true }).setView([9.9312, 76.2673], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(worldMap);
  }
  mapMarkers.splice(0).forEach((marker) => marker.remove());
  const locatedIncidents = incidents.filter((incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude));
  locatedIncidents.forEach((incident) => {
    const color = incident.severity === "Critical" ? "#e9655e" : incident.severity === "High" ? "#eca04c" : "#5796e2";
    const marker = L.circleMarker([incident.latitude, incident.longitude], {
      radius: 8,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2
    }).addTo(worldMap);
    marker.bindPopup(`<strong>${escapeHtml(incident.title)}</strong><br>${escapeHtml(incident.location)}<br>${escapeHtml(incident.severity)}`);
    mapMarkers.push(marker);
  });
  if (locatedIncidents.length > 1) {
    worldMap.fitBounds(L.featureGroup(mapMarkers).getBounds().pad(0.25), { maxZoom: 12 });
  }
  window.setTimeout(() => worldMap.invalidateSize(), 0);
};

const bindIncidentSelection = () => {
  document.querySelectorAll(".incident").forEach((incident) => {
    incident.addEventListener("click", () => {
      document.querySelectorAll(".incident").forEach((item) => item.classList.remove("active-incident"));
      incident.classList.add("active-incident");
      const photoUrl = incidentPhotoUrls.get(incident.dataset.incidentId);
      if (photoUrl) {
        openModal(
          incident.querySelector("strong").textContent,
          "Incident evidence",
          [["Location", incident.querySelector("small").textContent], ["Severity", incident.querySelector(".severity").textContent]],
          ""
        );
        const photoLink = document.createElement("a");
        photoLink.className = "modal-action";
        photoLink.href = photoUrl;
        photoLink.target = "_blank";
        photoLink.rel = "noopener";
        photoLink.textContent = "View saved photo →";
        modalBody.append(photoLink);
      } else {
        showToast(`${incident.querySelector("strong").textContent} selected for response coordination`);
      }
    });
  });
};

api("/dashboard").then(renderDashboard).catch((error) => showToast(error.message));

const openModal = (title, subtitle, rows, actionLabel) => {
  modalTitle.textContent = title;
  modalSubtitle.textContent = subtitle;
  modalBody.innerHTML = `<div class="detail-list">${rows.map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>${actionLabel ? `<button class="modal-action" id="modalAction">${escapeHtml(actionLabel)} →</button>` : ""}`;
  modalBackdrop.classList.add("open");
  const action = document.getElementById("modalAction");
  if (action) action.addEventListener("click", () => {
    modalBackdrop.classList.remove("open");
    showToast(`${actionLabel} completed`);
  });
};

const openReportForm = () => {
  modalTitle.textContent = "Report a disaster";
  modalSubtitle.textContent = "Send a field report to the command center";
  modalBody.innerHTML = `<form class="report-form" id="reportForm">
    <label>Incident type<input name="title" required placeholder="e.g. Flooded road"></label>
    <label>Location<input name="location" required placeholder="Area, ward, or landmark"></label>
    <div class="coordinate-fields"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" placeholder="e.g. 9.9312"></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" placeholder="e.g. 76.2673"></label></div>
    <label>Severity<select name="severity"><option>Medium</option><option>High</option><option>Critical</option></select></label>
    <label>Description<textarea name="description" required rows="4" placeholder="What is happening? Who needs help?"></textarea></label>
    <label>Photo evidence<input name="photo" type="file" accept="image/*"></label>
    <button class="modal-action" type="submit">Submit report →</button>
  </form>`;
  modalBackdrop.classList.add("open");
  document.getElementById("reportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting…";
      }
      const photo = await readImageAsDataUrl(form.get("photo"));
      const result = await api("/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"), location: form.get("location"),
          latitude: form.get("latitude") ? Number(form.get("latitude")) : null,
          longitude: form.get("longitude") ? Number(form.get("longitude")) : null,
          severity: form.get("severity"), description: form.get("description"),
          photo
        })
      });
      modalBackdrop.classList.remove("open");
      showToast(result.message);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      showToast(error.message);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Submit report →";
      }
    }
  });
};

document.getElementById("reportButton").addEventListener("click", openReportForm);
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
    if (view) openModal(view[0], view[1], view[2], name === "Situation room" ? "" : `Open ${name}`);
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
  const incidentId = document.querySelector(".active-incident")?.dataset.incidentId;
  if (!incidentId) {
    showToast("Select an incident first");
    return;
  }
  api("/incidents/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentId })
  }).then((data) => {
    showToast(data.message);
    window.setTimeout(() => window.location.reload(), 700);
  }).catch((error) => showToast(error.message));
});

document.getElementById("exportButton").addEventListener("click", () => {
  api("/briefing").then((data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = data.filename || "aegis-briefing.json";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Briefing downloaded");
  }).catch((error) => showToast(error.message));
});

document.querySelector(".icon-button").addEventListener("click", () => {
  showToast("No new emergency notifications");
});

document.querySelector(".profile").addEventListener("click", () => {
  openModal(
    "Officer profile",
    "Current command-center operator",
    [["Name", "Riya Kapoor"], ["Role", "District coordinator"], ["Access", "Operations and dispatch"], ["Status", "On duty"]],
    ""
  );
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

bindIncidentSelection();

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
