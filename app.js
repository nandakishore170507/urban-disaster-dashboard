const toast = document.getElementById("toast");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");
const modalBody = document.getElementById("modalBody");
const incidentPhotoUrls = new Map();
let worldMap;
const mapMarkers = [];
const mapMarkersByIncidentId = new Map();
let lastFocusedElement;
let dashboardData;
let allIncidents = [];
let rainfallLayer;
let currentLanguage = localStorage.getItem("aegis-language") || "en";
const translations = {
  en: { report: "+ Report incident", guide: "How Aegis works", incidents: "Priority incidents", analytics: "View incident analytics ↗" },
  ml: { report: "+ സംഭവം റിപ്പോർട്ട്", guide: "Aegis എങ്ങനെ പ്രവർത്തിക്കുന്നു", incidents: "പ്രധാന സംഭവങ്ങൾ", analytics: "വിശകലനം കാണുക ↗" },
  hi: { report: "+ घटना रिपोर्ट", guide: "Aegis कैसे काम करता है", incidents: "प्राथमिक घटनाएँ", analytics: "विश्लेषण देखें ↗" }
};
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

const formatCurrentDate = () => new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric"
}).format(new Date()).toUpperCase();

const updateClock = () => {
  const dateElement = document.getElementById("currentDate");
  if (dateElement) dateElement.textContent = formatCurrentDate();
};

const markUpdated = () => {
  const updatedElement = document.getElementById("lastUpdated");
  if (updatedElement) updatedElement.textContent = `· Updated ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date())}`;
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

const getFilters = () => ({
  severity: document.getElementById("severityFilter")?.value || "",
  status: document.getElementById("statusFilter")?.value || "",
  location: document.getElementById("locationFilter")?.value.trim().toLowerCase() || "",
  date: document.getElementById("dateFilter")?.value || ""
});

const filteredIncidents = () => allIncidents.filter((incident) =>
  (!getFilters().severity || incident.severity === getFilters().severity) &&
  (!getFilters().status || incident.status === getFilters().status) &&
  (!getFilters().location || incident.location.toLowerCase().includes(getFilters().location)) &&
  (!getFilters().date || String(incident.createdAt || "").slice(0, 10) === getFilters().date)
);

const renderIncidentList = () => {
  const incidentList = document.querySelector(".incident-list");
  const incidents = filteredIncidents();
  if (!incidentList) return;
  incidentList.innerHTML = incidents.slice(0, 4).map((incident, index) => {
    const severityClass = incident.severity.toLowerCase() === "critical" ? "critical-text" : incident.severity.toLowerCase() === "high" ? "high-text" : "medium-text";
    const markerClass = incident.severity.toLowerCase() === "critical" ? "red" : incident.severity.toLowerCase() === "high" ? "orange" : "yellow";
    return `<button class="incident${index === 0 ? " active-incident" : ""}" data-incident-id="${escapeHtml(incident.id)}"><span class="incident-marker ${markerClass}">!</span><span class="incident-copy"><strong>${escapeHtml(incident.title)}</strong><small>${escapeHtml(incident.location)} · ${escapeHtml(incident.age)}</small></span><span class="severity ${severityClass}">${escapeHtml(incident.severity)}</span></button>`;
  }).join("") || `<p class="empty-state">No incidents match these filters.</p>`;
  bindIncidentSelection();
};

const renderDashboard = (data) => {
  dashboardData = data;
  allIncidents = data.incidents || [];
  markUpdated();
  const metricValues = document.querySelectorAll(".stat-card > strong");
  if (metricValues[0]) metricValues[0].textContent = data.metrics.activeIncidents;
  if (metricValues[1]) metricValues[1].textContent = Number(data.metrics.peopleAtRisk).toLocaleString();
  if (metricValues[2]) metricValues[2].textContent = `${data.metrics.shelterCapacity}%`;
  if (metricValues[3]) metricValues[3].textContent = `${data.metrics.readiness}%`;
  const activeIncidentCount = document.getElementById("activeIncidentCount");
  if (activeIncidentCount) activeIncidentCount.textContent = `${data.metrics.activeIncidents} active incidents`;
  const incidentBadge = document.querySelector(".nav-item:nth-child(2) b");
  if (incidentBadge) incidentBadge.textContent = data.metrics.activeIncidents;
  data.incidents.forEach((incident) => { if (incident.photoUrl) incidentPhotoUrls.set(incident.id, incident.photoUrl); });
  renderIncidentList();
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
  mapMarkersByIncidentId.clear();
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
    mapMarkersByIncidentId.set(incident.id, marker);
  });
  if (locatedIncidents.length > 1) {
    worldMap.fitBounds(L.featureGroup(mapMarkers).getBounds().pad(0.25), { maxZoom: 12 });
  }
  window.setTimeout(() => worldMap.invalidateSize(), 0);
};

const focusIncidentOnMap = (incident) => {
  if (!incident || !worldMap) return;
  const marker = mapMarkersByIncidentId.get(incident.id);
  if (marker) {
    worldMap.setView(marker.getLatLng(), 12, { animate: true });
    marker.openPopup();
    return;
  }
  if (Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude)) {
    worldMap.setView([incident.latitude, incident.longitude], 12, { animate: true });
  } else {
    showToast("Map coordinates are not available for this incident.");
  }
};

const openIncidentDetails = async (incidentId) => {
  try {
    const details = await api(`/incidents/${encodeURIComponent(incidentId)}`);
    const incident = details.incident;
    const history = details.history || [];
    openModal(incident.title, `Tracking ID ${incident.trackingId || "pending"}`, [
      ["Location", incident.location],
      ["Severity", incident.severity],
      ["Status", incident.status],
      ["Description", incident.description || "No description provided"],
      ["Assigned team", details.assignment?.name || "Unassigned"],
      ["ETA", details.assignment?.eta || "Awaiting dispatch"]
    ], incident.status === "Resolved" ? "" : "Mark resolved", incident.status === "Resolved" ? null : async () => {
      await api(`/incidents/${encodeURIComponent(incident.id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Resolved" })
      });
      closeModal();
      await api("/dashboard").then(renderDashboard);
      showToast("Incident marked resolved");
    });
    const timeline = document.createElement("div");
    timeline.className = "timeline";
    timeline.innerHTML = `<h3>Response timeline</h3>${history.map((entry) => `<div class="timeline-item"><b>${escapeHtml(entry.status)}</b><span>${escapeHtml(entry.note || "")}</span><small>${new Date(entry.createdAt).toLocaleString()}</small></div>`).join("") || `<p class="empty-state">No timeline events yet.</p>`}`;
    modalBody.append(timeline);
  } catch (error) {
    if (!navigator.onLine) {
      const queuedReports = JSON.parse(localStorage.getItem("aegis-offline-reports") || "[]");
      queuedReports.push(Object.fromEntries(form.entries()));
      localStorage.setItem("aegis-offline-reports", JSON.stringify(queuedReports));
      showToast("No connection. Report saved and will send when you are online.");
      modalBackdrop.classList.remove("open");
      return;
    }
    showToast(error.message);
  }
};

const bindIncidentSelection = () => {
  document.querySelectorAll(".incident").forEach((incident) => {
    incident.addEventListener("click", () => {
      document.querySelectorAll(".incident").forEach((item) => item.classList.remove("active-incident"));
      incident.classList.add("active-incident");
      const selected = allIncidents.find((item) => item.id === incident.dataset.incidentId);
      focusIncidentOnMap(selected);
      openIncidentDetails(incident.dataset.incidentId);
    });
  });
};

const openModal = (title, subtitle, rows, actionLabel, actionHandler) => {
  lastFocusedElement = document.activeElement;
  modalTitle.textContent = title;
  modalSubtitle.textContent = subtitle;
  modalBody.innerHTML = `<div class="detail-list">${rows.map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>${actionLabel ? `<button class="modal-action" id="modalAction">${escapeHtml(actionLabel)} →</button>` : ""}`;
  modalBackdrop.classList.add("open");
  document.getElementById("modalClose").focus();
  const action = document.getElementById("modalAction");
  if (action) action.addEventListener("click", () => {
    if (actionHandler) {
      action.disabled = true;
      actionHandler(action).catch((error) => {
        action.disabled = false;
        showToast(error.message);
      });
      return;
    }
    closeModal();
    showToast(`${actionLabel} completed`);
  });
};

const openReportForm = () => {
  modalTitle.textContent = "Report a disaster";
  modalSubtitle.textContent = "Send a field report to the command center";
  modalBody.innerHTML = `<form class="report-form" id="reportForm">
    <label>Incident type<input name="title" required placeholder="e.g. Flooded road"></label>
    <label>Location<input name="location" id="locationInput" required autocomplete="off" placeholder="Area, ward, or landmark"><div class="location-suggestions" id="locationSuggestions"></div></label>
    <div class="coordinate-fields"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" placeholder="e.g. 9.9312"></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" placeholder="e.g. 76.2673"></label></div>
    <label>Severity<select name="severity"><option>Medium</option><option>High</option><option>Critical</option></select></label>
    <label>Description<textarea name="description" required rows="4" placeholder="What is happening? Who needs help?"></textarea></label>
    <label>Photo evidence<input name="photo" type="file" accept="image/*"></label>
    <button class="modal-action" type="submit">Submit report →</button>
  </form>`;
  modalBackdrop.classList.add("open");
  const reportForm = document.getElementById("reportForm");
  const locationInput = document.getElementById("locationInput");
  const suggestions = document.getElementById("locationSuggestions");
  const latitudeInput = reportForm.querySelector('input[name="latitude"]');
  const longitudeInput = reportForm.querySelector('input[name="longitude"]');
  let suggestionTimer;
  let requestId = 0;
  const clearSuggestions = () => { suggestions.innerHTML = ""; };
  const selectPlace = (button) => {
    locationInput.value = button.dataset.placeLabel || "";
    latitudeInput.value = button.dataset.placeLat || "";
    longitudeInput.value = button.dataset.placeLon || "";
    clearSuggestions();
  };
  locationInput.addEventListener("input", () => {
    const value = locationInput.value.trim();
    window.clearTimeout(suggestionTimer);
    if (value.length < 2) {
      clearSuggestions();
      return;
    }
    suggestionTimer = window.setTimeout(async () => {
      const currentRequestId = ++requestId;
      try {
        const result = await api(`/places?query=${encodeURIComponent(value)}`);
        if (currentRequestId !== requestId) return;
        const matches = Array.isArray(result.suggestions) ? result.suggestions : [];
        if (!matches.length) {
          clearSuggestions();
          return;
        }
        suggestions.innerHTML = matches.map((place) => `<button type="button" class="location-suggestion" data-place-label="${escapeHtml(place.label)}" data-place-lat="${escapeHtml(place.latitude)}" data-place-lon="${escapeHtml(place.longitude)}"><span class="place-label"><span class="place-flag" aria-hidden="true">${escapeHtml(place.symbol || "🌍")}</span>${escapeHtml(place.label)}</span>${place.placeType ? `<small>${escapeHtml(place.placeType)}</small>` : ""}</button>`).join("");
        suggestions.querySelectorAll(".location-suggestion").forEach((button) => {
          button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            selectPlace(button);
          });
          button.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectPlace(button);
            }
          });
        });
      } catch {
        if (currentRequestId === requestId) {
          clearSuggestions();
          showToast("Place suggestions are temporarily unavailable.");
        }
      }
    }, 180);
  });
  suggestions.addEventListener("pointerdown", (event) => event.preventDefault());
  locationInput.addEventListener("blur", () => {
    window.clearTimeout(suggestionTimer);
    window.setTimeout(() => {
      if (!suggestions.matches(":hover")) clearSuggestions();
    }, 250);
  });
  reportForm.addEventListener("submit", async (event) => {
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
const flushOfflineReports = async () => {
  const queuedReports = JSON.parse(localStorage.getItem("aegis-offline-reports") || "[]");
  if (!queuedReports.length || !navigator.onLine) return;
  const remaining = [];
  for (const report of queuedReports) {
    try {
      await api("/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
    } catch {
      remaining.push(report);
    }
  }
  localStorage.setItem("aegis-offline-reports", JSON.stringify(remaining));
  if (queuedReports.length !== remaining.length) {
    showToast(`${queuedReports.length - remaining.length} offline report(s) submitted`);
    api("/dashboard").then(renderDashboard);
  }
};
window.addEventListener("online", flushOfflineReports);
window.setTimeout(flushOfflineReports, 1000);
const closeModal = () => {
  modalBackdrop.classList.remove("open");
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
};
document.getElementById("modalClose").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalBackdrop.classList.contains("open")) closeModal();
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((navItem) => navItem.classList.remove("active"));
    item.classList.add("active");
    openNavigationView(item.dataset.view);
  });

  ["severityFilter", "statusFilter", "locationFilter", "dateFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderIncidentList);
    document.getElementById(id)?.addEventListener("change", renderIncidentList);
  });

  const addRainfallLayer = () => {
    if (!worldMap || rainfallLayer) return;
    rainfallLayer = L.layerGroup([
      L.circle([9.99, 76.31], { radius: 8500, color: "#4b8ee8", fillColor: "#4b8ee8", fillOpacity: 0.2, weight: 1 }).bindPopup("Heavy rainfall watch · Zone 2"),
      L.circle([9.96, 76.34], { radius: 6500, color: "#5796e2", fillColor: "#5796e2", fillOpacity: 0.18, weight: 1 }).bindPopup("Rainfall watch · Zone 4")
    ]);
  };

  document.querySelectorAll(".map-controls button").forEach((control) => {
    control.addEventListener("click", () => {
      if (control.textContent.trim() === "Rainfall") {
        addRainfallLayer();
        rainfallLayer.addTo(worldMap);
      } else if (rainfallLayer) {
        worldMap.removeLayer(rainfallLayer);
      }
    });
  });

  document.getElementById("analyticsButton")?.addEventListener("click", async () => {
    try {
      const analytics = await api("/analytics");
      openModal("Incident analytics", "Current response performance", [
        ["Total incidents", analytics.total],
        ["Critical", analytics.bySeverity.Critical || 0],
        ["Resolved", analytics.byStatus.Resolved || 0],
        ["Average response", `${analytics.averageResponseMinutes} minutes`]
      ], "");
    } catch (error) { showToast(error.message); }
  });

  document.getElementById("languageSelect")?.addEventListener("change", (event) => {
    currentLanguage = event.target.value;
    localStorage.setItem("aegis-language", currentLanguage);
    const text = translations[currentLanguage] || translations.en;
    document.getElementById("reportButton").textContent = text.report;
    document.getElementById("guideButton").textContent = text.guide;
    document.querySelector(".incident-panel h2").textContent = text.incidents;
    document.getElementById("analyticsButton").textContent = text.analytics;
  });
  document.getElementById("languageSelect").value = currentLanguage;
  document.getElementById("languageSelect").dispatchEvent(new Event("change"));

  window.setInterval(() => {
    if (!modalBackdrop.classList.contains("open") && document.visibilityState === "visible") api("/dashboard").then(renderDashboard).catch(() => {});
  }, 30000);
});

const openNavigationView = (name) => {
  const data = dashboardData;
  if (name === "Situation room") {
    closeModal();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("Situation room selected");
    return;
  }
  if (name === "Live incidents") {
    const incidents = data?.incidents || [];
    modalTitle.textContent = "Live incidents";
    modalSubtitle.textContent = "Reports requiring attention, sorted by urgency";
    modalBody.innerHTML = incidents.length
      ? `<div class="section-list">${incidents.map((incident) => `<button class="section-list-item" data-section-incident="${escapeHtml(incident.id)}"><span><strong>${escapeHtml(incident.title)}</strong><small>${escapeHtml(incident.location)} · ${escapeHtml(incident.status)}</small></span><b>${escapeHtml(incident.severity)}</b></button>`).join("")}</div>`
      : `<p class="empty-state">No active incidents are available.</p>`;
    modalBackdrop.classList.add("open");
    modalBody.querySelectorAll("[data-section-incident]").forEach((button) => button.addEventListener("click", () => {
      const incident = incidents.find((item) => item.id === button.dataset.sectionIncident);
      if (incident) {
        focusIncidentOnMap(incident);
        openIncidentDetails(incident.id);
      }
    }));
    document.getElementById("modalClose").focus();
    return;
  }
  const views = {
    "Shelters & capacity": {
      subtitle: "Current evacuation support information",
      rows: (data?.shelters || []).map((shelter) => [`${shelter.name} · ${shelter.status}`, `${shelter.available}/${shelter.capacity} beds · ${shelter.location}`])
    },
    Resources: {
      subtitle: "Rescue, medical, and utility deployment",
      rows: (data?.teams || []).map((team) => [team.name, `${team.status} · ${team.eta} · ${team.assignment || "Available"}`])
    },
    "Public alerts": {
      subtitle: "Emergency communications for residents",
      rows: data?.alert ? [["Active advisory", data.alert.title], ["Message", data.alert.message], ["Action", "Follow local authority instructions and avoid flooded roads"]] : [["Active advisories", "No active advisories"], ["Status", "Monitoring conditions"]]
    }
  };
  if (name === "Shelters & capacity") {
    openModal(name, views[name].subtitle, views[name].rows, "");
    const directions = document.createElement("div");
    directions.className = "shelter-links";
    (data?.shelters || []).forEach((shelter) => {
      const link = document.createElement("a");
      link.href = `https://www.google.com/maps/dir/?api=1&destination=${shelter.latitude},${shelter.longitude}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `Directions to ${shelter.name} →`;
      directions.append(link);
    });
    modalBody.append(directions);
    return;
  }
  if (name === "Resources") {
    openModal(name, views[name].subtitle, views[name].rows, "");
    const auditButton = document.createElement("button");
    auditButton.className = "modal-action";
    auditButton.textContent = "View audit log →";
    auditButton.addEventListener("click", async () => {
      const result = await api("/audit");
      modalTitle.textContent = "Admin audit log";
      modalSubtitle.textContent = "Recent response actions";
      modalBody.innerHTML = `<div class="timeline">${(result.logs || []).map((log) => `<div class="timeline-item"><b>${escapeHtml(log.action)}</b><span>${escapeHtml(log.details)}</span><small>${escapeHtml(log.created_at || log.createdAt || "")}</small></div>`).join("") || "<p class='empty-state'>No audit events yet.</p>"}</div>`;
    });
    modalBody.append(auditButton);
    return;
  }
  const view = views[name];
  if (view) openModal(name, view.subtitle, view.rows, "");
};

document.querySelectorAll(".map-controls button").forEach((control) => {
  control.addEventListener("click", () => {
    document.querySelectorAll(".map-controls button").forEach((button) => button.classList.remove("selected"));
    control.classList.add("selected");
    showToast(`${control.textContent} map layer enabled`);
  });

});

document.getElementById("guideButton").addEventListener("click", () => {
  openModal("How Aegis works", "A simple guide to reading this response dashboard", [
    ["Active incidents", "Reports that still need coordination"],
    ["People at risk", "Estimated residents affected across reported zones"],
    ["Shelter capacity", "Available beds compared with total shelter capacity"],
    ["Response readiness", "Teams currently checked in and ready to deploy"],
    ["Map colors", "Red is critical, orange is high priority, blue marks lower-risk or support locations"]
  ], "");
});

const dismissAlert = async (actionButton) => {
  if (actionButton) actionButton.disabled = true;
  await api("/alerts/dismiss", { method: "POST" });
  dashboardData = dashboardData ? { ...dashboardData, alert: null } : dashboardData;
  document.querySelector(".alert-banner")?.remove();
  document.querySelector(".notification")?.remove();
  closeModal();
  showToast("Monsoon advisory dismissed");
};

document.getElementById("dismissAlert").addEventListener("click", (event) => {
  dismissAlert(event.currentTarget).catch((error) => {
    event.currentTarget.disabled = false;
    showToast(error.message);
  });
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
  openModal("Export reports", "Choose a format for the current incident data", [
    ["CSV", "Spreadsheet-compatible incident report"],
    ["PDF", "Print-ready report for saving as PDF"]
  ], "Download CSV", async () => {
    const rows = [["Tracking ID", "Title", "Location", "Severity", "Status", "Created"]];
    allIncidents.forEach((incident) => rows.push([incident.trackingId, incident.title, incident.location, incident.severity, incident.status, incident.createdAt || ""]));
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "aegis-incidents.csv";
    link.click();
    URL.revokeObjectURL(url);
    closeModal();
    showToast("CSV report downloaded");
  });
  const pdfButton = document.createElement("button");
  pdfButton.className = "modal-action secondary-action";
  pdfButton.textContent = "Print / Save as PDF →";
  pdfButton.addEventListener("click", () => window.print());
  modalBody.append(pdfButton);
});

document.getElementById("notificationButton").addEventListener("click", () => {
  openModal("Emergency notifications", "Latest operational updates for the response network", [
    ["Current advisory", dashboardData?.alert?.title || "No active advisory"],
    ["Weather update", dashboardData?.alert?.message || "No new weather warnings"],
    ["Response teams", `${dashboardData?.teams?.filter((team) => team.status !== "Standby").length || 0} teams currently deployed`],
    ["Incident queue", `${dashboardData?.metrics?.activeIncidents || 0} active incidents require monitoring`],
    ["Recommended action", "Review critical incidents on the map and dispatch a team when support is required"]
  ], dashboardData?.alert ? "Dismiss advisory" : "", dashboardData?.alert ? dismissAlert : null);
});

document.querySelector(".profile").addEventListener("click", () => {
  modalTitle.textContent = "Your Aegis profile";
  modalSubtitle.textContent = "Public dashboard access";
  modalBody.innerHTML = `<div class="detail-list">
    <div class="detail-row"><span>Access</span><strong>Public dashboard</strong></div>
    <div class="detail-row"><span>Purpose</span><strong>Disaster response monitoring</strong></div>
  </div>`;
  modalBackdrop.classList.add("open");
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

api("/dashboard").then(renderDashboard).catch((error) => showToast(error.message));
updateClock();
window.setInterval(updateClock, 60 * 1000);
