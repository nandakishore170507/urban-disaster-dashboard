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

const getPlaceSuggestions = async (query) => {
  const value = String(query || "").trim();
  if (value.length < 2) return [];
  if (typeof fetch !== "function") throw Object.assign(new Error("Place suggestions are unavailable on this runtime."), { statusCode: 503 });
  const endpoint = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=25&q=${encodeURIComponent(value)}`;
  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        "User-Agent": "AegisUrbanDashboard/1.0",
        "Accept-Language": "en"
      }
    });
  } catch {
    throw Object.assign(new Error("Place suggestions are temporarily unavailable."), { statusCode: 503 });
  }
  if (!response.ok) throw Object.assign(new Error("Place suggestions are temporarily unavailable."), { statusCode: 503 });
  const payload = await response.json();
  const searchValue = value.toLowerCase();
  const seen = new Set();
  return payload
    .map((item) => {
      const address = item.address || {};
      const country = address.country || "";
      const state = address.state || address.region || address.state_district || address.county || "";
      const name = address.city || address.town || address.village || address.municipality || address.hamlet || address.suburb || address.county || address.state || address.country || item.name || item.display_name?.split(",")[0] || "";
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
        symbol: countryCodeToFlag(address.country_code),
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        importance: Number(item.importance) || 0,
        rank
      };
    })
    .filter(Boolean)
    .sort((left, right) => (left.rank - right.rank) || (right.importance - left.importance))
    .slice(0, 10)
    .map(({ importance, rank, ...place }) => place);
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
    teams: teamsResult.data
  };
};

const dashboard = async () => {
  if (supabase) return dashboardFromSupabase();
  return {
    metrics: { activeIncidents: localState.incidents.filter((item) => item.status !== "Resolved").length, peopleAtRisk: 8460, shelterCapacity: 72, readiness: 94 },
    alert: localState.alertActive ? { title: "Monsoon surge advisory", message: "Heavy rainfall expected in Zones 2 and 4 between 14:00–18:00." } : null,
    incidents: localState.incidents,
    teams: localState.teams
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
        severity: body.severity
      };
      let { data, error } = await supabase.from("incidents").insert(incidentValues).select().single();
      if (error?.code === "PGRST204") {
        const legacyValues = { ...incidentValues };
        delete legacyValues.latitude;
        delete legacyValues.longitude;
        ({ data, error } = await supabase.from("incidents").insert(legacyValues).select().single());
      }
      if (error) throw error;
      return formatIncidentWithPhoto(data);
    } catch (error) {
      if (photoPath) await supabase.storage.from(photoBucket).remove([photoPath]);
      throw error;
    }
  }
  const incident = { id: `inc-${Date.now()}`, title: body.title, location: body.location, latitude: body.latitude ?? null, longitude: body.longitude ?? null, description: body.description, photoName: body.photoName || null, age: "just now", severity: body.severity, status: "Reported" };
  localState.incidents.unshift(incident);
  return incident;
};

const updateIncidentStatus = async (incidentId, status) => {
  if (supabase) {
    const { data, error } = await supabase.from("incidents").update({ status, updated_at: new Date().toISOString() }).eq("id", incidentId).select().single();
    if (error) throw error;
    return formatIncident(data);
  }
  const incident = localState.incidents.find((item) => item.id === incidentId);
  if (!incident) return null;
  incident.status = status;
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
    if (!error) return { incident: formatIncident(data.incident), team: data.team };
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
    return { incident: formatIncident(incidentUpdate.data), team: teamUpdate.data };
  }
  const incident = localState.incidents.find((item) => item.id === incidentId) || localState.incidents[0];
  const team = localState.teams.find((item) => item.status === "Standby") || localState.teams[0];
  incident.status = "Assigned";
  team.status = "En route";
  team.assignment = `${incident.title} · ${incident.location}`;
  team.eta = "08 min";
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
      return sendJson(res, 200, { suggestions: await getPlaceSuggestions(query) });
    }
    if (url.pathname === "/api/user-counts" && req.method === "GET") return sendJson(res, 200, await getUserCounts());
    if (url.pathname === "/api/dashboard" && req.method === "GET") return sendJson(res, 200, await dashboard());
    if (url.pathname === "/api/incidents" && req.method === "GET") return sendJson(res, 200, { incidents: (await dashboard()).incidents });
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
      return sendJson(res, 201, { incident, message: "Incident reported successfully" });
    }
    if (url.pathname === "/api/teams" && req.method === "GET") return sendJson(res, 200, { teams: (await dashboard()).teams });
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
