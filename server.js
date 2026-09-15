const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = __dirname;
const port = Number(process.env.PORT || 4173);

const state = {
  incidents: [
    { id: "inc-001", title: "Canal overflow", location: "Palarivattom", age: "14 min ago", severity: "Critical", status: "Unassigned" },
    { id: "inc-002", title: "Road submerged", location: "Kaloor junction", age: "28 min ago", severity: "High", status: "Unassigned" },
    { id: "inc-003", title: "Power outage", location: "Vyttila ward", age: "42 min ago", severity: "High", status: "Unassigned" },
    { id: "inc-004", title: "Medical evacuation", location: "Edappally", age: "1 hr ago", severity: "Medium", status: "On site" }
  ],
  teams: [
    { id: "team-001", name: "Alpha 01", assignment: "Palarivattom overflow", status: "En route", eta: "06 min" },
    { id: "team-002", name: "Medical 03", assignment: "Edappally evacuation", status: "On site", eta: "—" },
    { id: "team-003", name: "Utility 02", assignment: "Vyttila power outage", status: "Standby", eta: "18 min" }
  ],
  alertActive: true
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (!body) return resolve({});
    try { resolve(JSON.parse(body)); } catch (error) { reject(new Error("Request body must be valid JSON")); }
  });
  req.on("error", reject);
});

const dashboard = () => ({
  metrics: { activeIncidents: 12, peopleAtRisk: 8460, shelterCapacity: 72, readiness: 94 },
  alert: state.alertActive ? {
    title: "Monsoon surge advisory",
    message: "Heavy rainfall expected in Zones 2 and 4 between 14:00–18:00."
  } : null,
  incidents: state.incidents,
  teams: state.teams
});

const serveStatic = (req, res, pathname) => {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(path.resolve(root)) || !fs.existsSync(filePath)) {
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
      return sendJson(res, 200, { ok: true, service: "aegis-response-api", timestamp: new Date().toISOString() });
    }
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      return sendJson(res, 200, dashboard());
    }
    if (url.pathname === "/api/incidents" && req.method === "GET") {
      return sendJson(res, 200, { incidents: state.incidents });
    }
    if (url.pathname === "/api/teams" && req.method === "GET") {
      return sendJson(res, 200, { teams: state.teams });
    }
    if (url.pathname === "/api/incidents/dispatch" && req.method === "POST") {
      const body = await readBody(req);
      const incident = state.incidents.find((item) => item.id === body.incidentId) || state.incidents[0];
      const team = state.teams.find((item) => item.status === "Standby") || state.teams[0];
      incident.status = "Team dispatched";
      team.status = "En route";
      team.assignment = `${incident.title} · ${incident.location}`;
      team.eta = "08 min";
      return sendJson(res, 200, { message: `${team.name} dispatched`, incident, team });
    }
    if (url.pathname === "/api/alerts/dismiss" && req.method === "POST") {
      state.alertActive = false;
      return sendJson(res, 200, { alert: null, message: "Advisory dismissed" });
    }
    if (url.pathname === "/api/briefing" && req.method === "GET") {
      return sendJson(res, 200, { filename: "situation-room-14-oct.json", generatedAt: new Date().toISOString(), ...dashboard() });
    }
    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    return sendJson(res, 404, { error: "Route not found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Aegis backend running at http://localhost:${port}`);
});
