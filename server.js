require("dotenv").config();

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createClient } = require("@supabase/supabase-js");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const photoBucket = process.env.SUPABASE_STORAGE_BUCKET || "incident-photos";
const maxPhotoBytes = 8 * 1024 * 1024;
const maxBodyBytes = Math.ceil(maxPhotoBytes * 1.4);
const allowedSeverities = new Set(["Low", "Medium", "High", "Critical"]);
const allowedStatuses = new Set(["Reported", "Assigned", "Responding", "Resolved"]);
const knownCoordinates = {
  Palarivattom: [9.9972, 76.3071],
  "Kaloor junction": [10.0014, 76.2999],
  "Vyttila ward": [9.9678, 76.3189],
  Edappally: [10.0261, 76.3086]
};
const seedState = {
  incidents: [
    { id: "inc-001", title: "Canal overflow", location: "Palarivattom", age: "14 min ago", severity: "Critical", status: "Reported" },
    { id: "inc-002", title: "Road submerged", location: "Kaloor junction", age: "28 min ago", severity: "High", status: "Reported" },
    { id: "inc-003", title: "Power outage", location: "Vyttila ward", age: "42 min ago", severity: "High", status: "Reported" },
    { id: "inc-004", title: "Medical evacuation", location: "Edappally", age: "1 hr ago", severity: "Medium", status: "Responding" }
  ],
  teams: [
    { id: "team-001", name: "Alpha 01", assignment: "Palarivattom overflow", status: "En route", eta: "06 min" },
    { id: "team-002", name: "Medical 03", assignment: "Edappally evacuation", status: "On site", eta: "—" },
    { id: "team-003", name: "Utility 02", assignment: "Vyttila power outage", status: "Standby", eta: "18 min" }
  ],
  alertActive: true
};

const configuredSupabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const projectRefFromDashboardUrl = configuredSupabaseUrl?.match(/supabase\.com\/dashboard\/project\/([^/?#]+)/)?.[1];
const supabaseUrl = projectRefFromDashboardUrl
  ? `https://${projectRefFromDashboardUrl}.supabase.co`
  : configuredSupabaseUrl;
const hasSupabaseConfig = Boolean(
  supabaseUrl &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !supabaseUrl.includes("your-project") &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("your-service-role")
);
const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;
const localState = { ...seedState };
localState.incidents = localState.incidents.map((incident) => ({
  ...incident,
  trackingId: `AEGIS-${incident.id.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`,
  description: incident.description || "Field report received.",
  createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  updatedAt: new Date().toISOString()
}));
localState.history = localState.incidents.map((incident) => ({
  id: crypto.randomUUID(),
  incidentId: incident.id,
  status: incident.status,
  note: "Initial incident report",
  createdAt: incident.createdAt
}));
const defaultShelters = [
  { id: "shelter-001", name: "Kochi Community Hall", location: "Kaloor, Kochi", latitude: 10.0014, longitude: 76.2999, capacity: 450, available: 180, status: "Open" },
  { id: "shelter-002", name: "Edappally Relief Centre", location: "Edappally, Kochi", latitude: 10.0261, longitude: 76.3086, capacity: 300, available: 62, status: "Open" },
  { id: "shelter-003", name: "Vyttila School Shelter", location: "Vyttila, Kochi", latitude: 9.9678, longitude: 76.3189, capacity: 220, available: 0, status: "Full" }
];
localState.shelters = defaultShelters;
localState.auditLogs = [];

const sendJson = (res, status, payload) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
};

const sendAuthConfig = (res) => sendJson(res, 200, {
  supabaseUrl,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
});

const countryCodeToFlag = (countryCode) => {
  if (!/^[a-z]{2}$/i.test(countryCode || "")) return "🌍";
  return countryCode.toUpperCase().replace(/./g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0)));
};

const fetchJson = async (endpoint, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(endpoint, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Geocoder returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const normalizePlaceResults = (payload, source, searchValue) => {
  const items = source === "photon"
    ? (payload.features || []).map((feature) => {
        const properties = feature.properties || {};
        const [longitude, latitude] = feature.geometry?.coordinates || [];
        return {
          address: {
            city: properties.city || properties.town || properties.village,
            state: properties.state || properties.county,
            country: properties.country,
            country_code: properties.countrycode
          },
          name: properties.name,
          placeType: properties.type || properties.osm_value,
          lat: latitude,
          lon: longitude
        };
      })
    : payload;
  const seen = new Set();
  return items
    .map((item) => {
      const address = item.address || {};
      const country = address.country || "";
      const state = address.state || address.region || address.state_district || address.county || "";
      const name = address.city || address.town || address.village || address.municipality || address.hamlet || address.suburb || address.county || address.state || address.country || item.name || item.display_name?.split(",")[0] || "";
      const placeType = item.placeType || item.addresstype || item.type || "";
      const labelParts = [name, state, country].filter((part, index, array) => part && array.indexOf(part) === index);
      const label = labelParts.join(", ");
      if (!label || seen.has(label.toLowerCase())) return null;
      seen.add(label.toLowerCase());
      const text = `${name} ${state} ${country}`.toLowerCase();
      const rank = text.startsWith(searchValue) || name.toLowerCase().startsWith(searchValue) ? 0 : text.includes(searchValue) ? 1 : 2;
      return {
        name,
        state: state || null,
        country: country || null,
        label,
        placeType: placeType || null,
        symbol: countryCodeToFlag(address.country_code),
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        importance: Number(item.importance) || 0,
        rank
      };
    })
    .filter((place) => place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude))
    .sort((left, right) => (left.rank - right.rank) || (right.importance - left.importance))
    .slice(0, 25)
    .map(({ importance, rank, ...place }) => place);
};

const getPlaceSuggestions = async (query) => {
  const value = String(query || "").trim();
  if (value.length < 2) return [];
  if (typeof fetch !== "function") throw Object.assign(new Error("Place suggestions are unavailable on this runtime."), { statusCode: 503 });
  const searchValue = value.toLowerCase();
  try {
    const payload = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=50&q=${encodeURIComponent(value)}`, {
      headers: {
        "User-Agent": "AegisUrbanDashboard/1.0 (https://urban-disaster-dashboard.onrender.com)",
        "Accept-Language": "en"
      }
    });
    return { suggestions: normalizePlaceResults(payload, "nominatim", searchValue), provider: "nominatim" };
  } catch (nominatimError) {
    console.warn(`Nominatim place search failed: ${nominatimError.message}`);
    try {
      const payload = await fetchJson(`https://photon.komoot.io/api/?limit=50&q=${encodeURIComponent(value)}`, {
        headers: { "User-Agent": "AegisUrbanDashboard/1.0 (https://urban-disaster-dashboard.onrender.com)" }
      });
      return { suggestions: normalizePlaceResults(payload, "photon", searchValue), provider: "photon" };
    } catch (photonError) {
      console.error(`All place search providers failed: ${photonError.message}`);
      throw Object.assign(new Error("Place suggestions are temporarily unavailable. Please enter the location manually."), { statusCode: 503 });
    }
  }
};

const getUserCounts = async () => {
  if (!supabase) return { total: 0, citizens: 0, coordinators: 0 };
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const { data: profiles, error: profilesError } = await supabase.from("profiles").select("role");
  if (profilesError) throw profilesError;
  return {
    total: users.users.length,
    citizens: profiles.filter((profile) => profile.role === "citizen").length,
    coordinators: profiles.filter((profile) => profile.role === "coordinator").length
  };
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  let tooLarge = false;
  req.on("data", (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) tooLarge = true;
  });
  req.on("end", () => {
    if (tooLarge) return reject(Object.assign(new Error("Request is too large. Images must be 8 MB or smaller."), { statusCode: 413 }));
    if (!body) return resolve({});
    try { resolve(JSON.parse(body)); } catch { reject(new Error("Request body must be valid JSON")); }
  });
  req.on("error", reject);
});

const formatIncident = (incident, photoUrl = null) => {
  const fallback = knownCoordinates[incident.location] || null;
  return {
  id: incident.id,
  title: incident.title,
  location: incident.location,
  latitude: incident.latitude ?? fallback?.[0] ?? null,
  longitude: incident.longitude ?? fallback?.[1] ?? null,
  description: incident.description,
  photoName: incident.photo_name || null,
  photoUrl,
  trackingId: incident.tracking_id || incident.trackingId || `AEGIS-${String(incident.id).replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`,
  createdAt: incident.created_at || incident.createdAt || null,
  updatedAt: incident.updated_at || incident.updatedAt || null,
  age: incident.created_at ? relativeAge(incident.created_at) : incident.age,
  severity: incident.severity,
  status: incident.status
  };
};

const getPhotoUrl = async (photoPath) => {
  if (!supabase || !photoPath) return null;
  const { data, error } = await supabase.storage.from(photoBucket).createSignedUrl(photoPath, 60 * 60 * 24);
  if (error) {
    if (error.code === "NoSuchKey" || error.statusCode === "404") return null;
    throw error;
  }
  return data.signedUrl;
};

const formatIncidentWithPhoto = async (incident) => formatIncident(incident, await getPhotoUrl(incident.photo_name));

const recordAudit = async (action, entityType, entityId, details) => {
  if (supabase) {
    const { error } = await supabase.from("audit_logs").insert({ action, entity_type: entityType, entity_id: entityId, details });
    if (error && error.code !== "PGRST205") throw error;
    return;
  }
  localState.auditLogs.unshift({ id: crypto.randomUUID(), action, entityType, entityId, details, createdAt: new Date().toISOString() });
};

const recordHistory = async (incidentId, status, note) => {
  if (supabase) {
    const { error } = await supabase.from("incident_history").insert({ incident_id: incidentId, status, note });
    if (error && error.code !== "PGRST205") throw error;
    return;
  }
  localState.history.unshift({ id: crypto.randomUUID(), incidentId, status, note, createdAt: new Date().toISOString() });
};

const getIncidentDetails = async (incidentId) => {
  if (supabase) {
    const incidentResult = await supabase.from("incidents").select("*").eq("id", incidentId).single();
    if (incidentResult.error) throw incidentResult.error;
    const [historyResult, assignmentResult] = await Promise.all([
      supabase.from("incident_history").select("*").eq("incident_id", incidentId).order("created_at", { ascending: true }),
      supabase.from("incident_assignments").select("assigned_at, response_teams(name, status, eta)").eq("incident_id", incidentId).order("assigned_at", { ascending: false }).limit(1)
    ]);
    if (historyResult.error && historyResult.error.code !== "PGRST205") throw historyResult.error;
    if (assignmentResult.error && assignmentResult.error.code !== "PGRST205") throw assignmentResult.error;
    return {
      incident: await formatIncidentWithPhoto(incidentResult.data),
      history: (historyResult.data || []).map((item) => ({ status: item.status, note: item.note, createdAt: item.created_at })),
      assignment: assignmentResult.data?.[0]?.response_teams || null
    };
  }
  const incident = localState.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  const assignment = localState.teams.find((team) => team.assignment?.startsWith(`${incident.title} ·`)) || null;
  return { incident: formatIncident(incident), history: localState.history.filter((item) => item.incidentId === incidentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), assignment };
};

const getShelters = async () => {
  if (!supabase) return localState.shelters;
  const { data, error } = await supabase.from("shelters").select("*").order("available", { ascending: false });
  if (error) {
    if (error.code === "PGRST205") return defaultShelters;
    throw error;
  }
  return data.length ? data : defaultShelters;
};

const getAnalytics = async () => {
  const data = await dashboard();
  const incidents = data.incidents || [];
  const bySeverity = incidents.reduce((result, incident) => ({ ...result, [incident.severity]: (result[incident.severity] || 0) + 1 }), {});
  const byStatus = incidents.reduce((result, incident) => ({ ...result, [incident.status]: (result[incident.status] || 0) + 1 }), {});
  return { total: incidents.length, bySeverity, byStatus, averageResponseMinutes: 18, generatedAt: new Date().toISOString() };
};

const ensurePhotoBucket = async () => {
  if (!supabase) return;
  const { data, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if (!data.some((bucket) => bucket.name === photoBucket)) {
    const result = await supabase.storage.createBucket(photoBucket, {
      public: false,
      fileSizeLimit: `${maxPhotoBytes}`,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
    });
    if (result.error) throw result.error;
  }
};

const relativeAge = (timestamp) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} hr ago`;
};

const dashboardFromSupabase = async () => {
  const [incidentsResult, teamsResult, alertResult] = await Promise.all([
    supabase.from("incidents").select("*").order("created_at", { ascending: false }),
    supabase.from("response_teams").select("*").order("created_at", { ascending: true }),
    supabase.from("public_alerts").select("*").eq("active", true).order("created_at", { ascending: false }).limit(1)
  ]);
  const failure = [incidentsResult, teamsResult, alertResult].find((result) => result.error);
  if (failure) throw failure.error;
  return {
    metrics: { activeIncidents: incidentsResult.data.filter((item) => item.status !== "Resolved").length, peopleAtRisk: 8460, shelterCapacity: 72, readiness: 94 },
    alert: alertResult.data[0] ? { title: alertResult.data[0].title, message: alertResult.data[0].message } : null,
    incidents: await Promise.all(incidentsResult.data.map(formatIncidentWithPhoto)),
    teams: teamsResult.data,
    shelters: await getShelters()
  };
};

const dashboard = async () => {
  if (supabase) return dashboardFromSupabase();
  return {
    metrics: { activeIncidents: localState.incidents.filter((item) => item.status !== "Resolved").length, peopleAtRisk: 8460, shelterCapacity: 72, readiness: 94 },
    alert: localState.alertActive ? { title: "Monsoon surge advisory", message: "Heavy rainfall expected in Zones 2 and 4 between 14:00–18:00." } : null,
    incidents: localState.incidents,
    teams: localState.teams,
    shelters: localState.shelters
  };
};

const createIncident = async (body) => {
  if (supabase) {
    let photoPath = null;
    try {
      if (body.photo?.dataUrl) {
      const match = body.photo.dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
      if (!match) throw new Error("Photo must be a JPEG, PNG, WebP, or GIF image.");
      const buffer = Buffer.from(match[2], "base64");
      if (buffer.length > maxPhotoBytes) throw new Error("Images must be 8 MB or smaller.");
      const safeName = (body.photo.name || "evidence").replace(/[^a-zA-Z0-9._-]/g, "-");
      photoPath = `${crypto.randomUUID()}/${safeName}`;
      const upload = await supabase.storage.from(photoBucket).upload(photoPath, buffer, {
        contentType: match[1],
        upsert: false
      });
      if (upload.error) throw upload.error;
      }
      const incidentValues = {
        title: body.title,
        location: body.location,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        description: body.description,
        photo_name: photoPath,
        severity: body.severity,
        tracking_id: `AEGIS-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`
      };
      let { data, error } = await supabase.from("incidents").insert(incidentValues).select().single();
      if (error?.code === "PGRST204") {
        const legacyValues = { ...incidentValues };
        delete legacyValues.latitude;
        delete legacyValues.longitude;
        delete legacyValues.tracking_id;
        ({ data, error } = await supabase.from("incidents").insert(legacyValues).select().single());
      }
      if (error) throw error;
      await recordHistory(data.id, data.status, "Incident report received");
      await recordAudit("created", "incident", data.id, `Incident ${data.title} reported at ${data.location}`);
      return formatIncidentWithPhoto(data);
    } catch (error) {
      if (photoPath) await supabase.storage.from(photoBucket).remove([photoPath]);
      throw error;
    }
  }
  const incident = { id: `inc-${Date.now()}`, title: body.title, location: body.location, latitude: body.latitude ?? null, longitude: body.longitude ?? null, description: body.description, photoName: body.photoName || null, age: "just now", severity: body.severity, status: "Reported", trackingId: `AEGIS-${Date.now().toString(36).toUpperCase()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  localState.incidents.unshift(incident);
  localState.history.unshift({ id: crypto.randomUUID(), incidentId: incident.id, status: "Reported", note: "Incident report received", createdAt: incident.createdAt });
  await recordAudit("created", "incident", incident.id, `Incident ${incident.title} reported at ${incident.location}`);
  return incident;
};

const updateIncidentStatus = async (incidentId, status) => {
  if (supabase) {
    const { data, error } = await supabase.from("incidents").update({ status, updated_at: new Date().toISOString() }).eq("id", incidentId).select().single();
    if (error) throw error;
    await recordHistory(incidentId, status, `Status changed to ${status}`);
    await recordAudit("status_changed", "incident", incidentId, `Incident status changed to ${status}`);
    return formatIncident(data);
  }
  const incident = localState.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  incident.status = status;
  incident.updatedAt = new Date().toISOString();
  localState.history.push({ id: crypto.randomUUID(), incidentId, status, note: `Status changed to ${status}`, createdAt: incident.updatedAt });
  await recordAudit("status_changed", "incident", incidentId, `Incident status changed to ${status}`);
  return incident;
};

const dispatchIncident = async (incidentId) => {
  if (supabase) {
    const current = await supabase.from("incidents").select("*").eq("id", incidentId).single();
    if (current.error) throw current.error;
    const available = await supabase.from("response_teams").select("*").eq("status", "Standby").limit(1).maybeSingle();
    if (available.error) throw available.error;
    const team = available.data || (await supabase.from("response_teams").select("*").limit(1).single()).data;
    if (!team) throw new Error("No response teams are configured");
    const { data, error } = await supabase.rpc("dispatch_incident", {
    p_incident_id: incidentId,
    p_team_id: team.id
    });
    if (!error) {
      await recordHistory(incidentId, "Assigned", `Assigned to ${data.team.name}`);
      await recordAudit("dispatched", "incident", incidentId, `Dispatched ${data.team.name}`);
      return { incident: formatIncident(data.incident), team: data.team };
    }
    if (error.code !== "PGRST202" && error.code !== "42883") throw error;

    const incidentUpdate = await supabase.from("incidents")
    .update({ status: "Assigned", updated_at: new Date().toISOString() })
    .eq("id", incidentId)
    .select()
    .single();
    if (incidentUpdate.error) throw incidentUpdate.error;
    const teamUpdate = await supabase.from("response_teams")
    .update({ status: "En route", assignment: `${current.data.title} · ${current.data.location}`, eta: "08 min" })
    .eq("id", team.id)
    .select()
    .single();
    if (teamUpdate.error) throw teamUpdate.error;
    const assignment = await supabase.from("incident_assignments")
    .upsert({ incident_id: incidentId, team_id: team.id }, { onConflict: "incident_id,team_id" });
    if (assignment.error) throw assignment.error;
    await recordHistory(incidentId, "Assigned", `Assigned to ${team.name}`);
    await recordAudit("dispatched", "incident", incidentId, `Dispatched ${team.name}`);
    return { incident: formatIncident(incidentUpdate.data), team: teamUpdate.data };
  }
  const incident = localState.incidents.find((item) => item.id === incidentId) || localState.incidents[0];
  const team = localState.teams.find((item) => item.status === "Standby") || localState.teams[0];
  incident.status = "Assigned";
  team.status = "En route";
  team.assignment = `${incident.title} · ${incident.location}`;
  team.eta = "08 min";
  incident.updatedAt = new Date().toISOString();
  localState.history.push({ id: crypto.randomUUID(), incidentId, status: "Assigned", note: `Assigned to ${team.name}`, createdAt: incident.updatedAt });
  await recordAudit("dispatched", "incident", incidentId, `Dispatched ${team.name}`);
  return { incident, team };
};

const serveStatic = (req, res, pathname) => {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const rootPath = path.resolve(root);
  const filePath = path.resolve(root, `.${requested}`);
  const relativePath = path.relative(rootPath, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
  res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, service: "aegis-response-api", database: supabase ? "supabase" : "local-fallback", timestamp: new Date().toISOString() });
    }
    if (url.pathname === "/api/config" && req.method === "GET") return sendAuthConfig(res);
    if (url.pathname === "/api/places" && req.method === "GET") {
      const query = url.searchParams.get("query") || "";
      return sendJson(res, 200, await getPlaceSuggestions(query));
    }
    if (url.pathname === "/api/user-counts" && req.method === "GET") return sendJson(res, 200, await getUserCounts());
    if (url.pathname === "/api/dashboard" && req.method === "GET") return sendJson(res, 200, await dashboard());
    if (url.pathname === "/api/incidents" && req.method === "GET") {
      const data = await dashboard();
      const query = url.searchParams;
      const incidents = data.incidents.filter((incident) =>
        (!query.get("severity") || incident.severity === query.get("severity")) &&
        (!query.get("status") || incident.status === query.get("status")) &&
        (!query.get("location") || incident.location.toLowerCase().includes(query.get("location").toLowerCase())) &&
        (!query.get("from") || String(incident.createdAt || "").slice(0, 10) >= query.get("from")) &&
        (!query.get("to") || String(incident.createdAt || "").slice(0, 10) <= query.get("to"))
      );
      return sendJson(res, 200, { incidents });
    }
    if (url.pathname.startsWith("/api/incidents/") && req.method === "GET") {
      const details = await getIncidentDetails(url.pathname.split("/")[3]);
      if (!details) return sendJson(res, 404, { error: "Incident not found" });
      return sendJson(res, 200, details);
    }
    if (url.pathname === "/api/incidents" && req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.title !== "string" || typeof body.location !== "string" || typeof body.description !== "string" ||
          !body.title.trim() || !body.location.trim() || !body.description.trim()) {
        return sendJson(res, 422, { error: "Title, location, and description are required" });
      }
      if (body.title.length > 120 || body.location.length > 160 || body.description.length > 2000) {
        return sendJson(res, 422, { error: "Title, location, or description is too long" });
      }
      if (!allowedSeverities.has(body.severity)) return sendJson(res, 422, { error: "Invalid incident severity" });
      const coordinates = [body.latitude, body.longitude];
      if (coordinates.some((value) => value !== null && value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) ||
          (body.latitude !== null && body.latitude !== undefined && (body.latitude < -90 || body.latitude > 90)) ||
          (body.longitude !== null && body.longitude !== undefined && (body.longitude < -180 || body.longitude > 180))) {
        return sendJson(res, 422, { error: "Latitude must be between -90 and 90 and longitude between -180 and 180" });
      }
      if (body.photo && (typeof body.photo.name !== "string" || typeof body.photo.dataUrl !== "string")) {
        return sendJson(res, 422, { error: "Invalid photo data" });
      }
      const incident = await createIncident({ ...body, title: body.title.trim(), location: body.location.trim(), description: body.description.trim() });
      return sendJson(res, 201, { incident, trackingId: incident.trackingId, message: `Incident reported successfully · Tracking ID ${incident.trackingId}` });
    }
    if (url.pathname === "/api/teams" && req.method === "GET") return sendJson(res, 200, { teams: (await dashboard()).teams });
    if (url.pathname === "/api/shelters" && req.method === "GET") return sendJson(res, 200, { shelters: await getShelters() });
    if (url.pathname === "/api/analytics" && req.method === "GET") return sendJson(res, 200, await getAnalytics());
    if (url.pathname === "/api/audit" && req.method === "GET") {
      if (supabase) {
        const result = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100);
        if (result.error && result.error.code !== "PGRST205") throw result.error;
        return sendJson(res, 200, { logs: result.data || [] });
      }
      return sendJson(res, 200, { logs: localState.auditLogs.slice(0, 100) });
    }
    if (url.pathname === "/api/incidents/dispatch" && req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.incidentId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.incidentId)) {
        return sendJson(res, 422, { error: "A valid incident must be selected" });
      }
      const result = await dispatchIncident(body.incidentId);
      return sendJson(res, 200, { ...result, message: `${result.team.name} dispatched` });
    }
    if (url.pathname.startsWith("/api/incidents/") && url.pathname.endsWith("/status") && req.method === "PATCH") {
      const incidentId = url.pathname.split("/")[3];
      const body = await readBody(req);
      if (typeof incidentId !== "string" || !/^[0-9a-f-]{36}$/i.test(incidentId)) return sendJson(res, 422, { error: "Invalid incident ID" });
      if (!allowedStatuses.has(body.status)) return sendJson(res, 422, { error: "Invalid incident status" });
      const incident = await updateIncidentStatus(incidentId, body.status);
      if (!incident) return sendJson(res, 404, { error: "Incident not found" });
      return sendJson(res, 200, { incident, message: `Incident marked ${body.status.toLowerCase()}` });
    }
    if (url.pathname === "/api/alerts/dismiss" && req.method === "POST") {
      if (supabase) {
        const { error } = await supabase.from("public_alerts").update({ active: false }).eq("active", true);
        if (error) throw error;
      } else localState.alertActive = false;
      return sendJson(res, 200, { alert: null, message: "Advisory dismissed" });
    }
    if (url.pathname === "/api/briefing" && req.method === "GET") {
      return sendJson(res, 200, { filename: "situation-room-14-oct.json", generatedAt: new Date().toISOString(), ...await dashboard() });
    }
    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    return sendJson(res, 404, { error: "Route not found" });
  } catch (error) {
    console.error(error);
    const message = error?.code === "PGRST205"
      ? "Supabase tables are not ready. Run supabase/schema.sql in the Supabase SQL Editor."
      : error?.statusCode === 413
        ? "The image is too large. Choose a smaller photo and try again."
      : error?.statusCode === 503
        ? error.message
      : error?.message?.includes("Connect Timeout")
        ? "Supabase could not be reached. Check your internet connection and try again."
        : "The request could not be completed";
    sendJson(res, error?.statusCode === 413 ? 413 : error?.statusCode === 503 || error?.code === "PGRST205" ? 503 : 500, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`Aegis backend running at http://localhost:${port} (${supabase ? "Supabase" : "local fallback"})`);
  ensurePhotoBucket().catch((error) => console.error("Unable to prepare Supabase Storage:", error));
});
