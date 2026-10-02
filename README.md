# Aegis Urban Disaster Dashboard

## Supabase setup

1. Open the Supabase SQL Editor for your project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) once. It creates the prototype tables and seed data.
3. Keep the server credentials in `.env`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-or-secret-key
```

The service-role/secret key is used only by `server.js`; never expose it in browser code or commit `.env`.

Create a Storage bucket named `incident-photos` before submitting reports. The bucket can remain private because the API creates a signed photo URL for each incident. You can override the bucket name with `SUPABASE_STORAGE_BUCKET`.

The deployed dashboard is currently public and opens directly without a login screen. Supabase profile and email-authentication code remains available for a future protected version, but it is not required to view or use this public prototype.

Location autocomplete in the report form uses global geocoding suggestions through `/api/places`, with starts-with matches ranked before contains matches, country symbols, and place-type labels such as village, town, or city. The endpoint requests up to 50 results from Nominatim and falls back to Photon when Nominatim is unavailable.

Public geocoding services return ranked results, not an exhaustive list of every village worldwide. For guaranteed global coverage, import a GeoNames global dump into a searchable database and configure that index on the server; do not attempt to load the entire dump into the browser.

The dashboard also includes incident tracking IDs and response timelines, polling-based live refreshes, severity/status/date/location filters, shelter availability and directions, analytics, rainfall watch overlays, offline report queuing, English/Malayalam/Hindi labels, an audit-log view, and CSV/print-to-PDF exports. Run the updated `supabase/schema.sql` to create the history, shelter, and audit tables used by these features. Until then, demo shelter data remains available and older incident rows receive generated tracking IDs.

If you already ran the schema, run it again after updates so the `dispatch_incident` transaction function is created. The function should only be callable by the backend service role.

For the interactive map, run the updated schema once more so `incidents.latitude` and `incidents.longitude` are added. Reports may include coordinates; existing Kochi seed locations use built-in fallback coordinates.

## Run locally

```powershell
npm install
npm start
```

The API uses Supabase when the service-role variables are configured. If the Supabase variables are placeholders, it uses in-memory demo data for previewing; otherwise, run the schema before using the API.

For safety, the server binds to `127.0.0.1` by default, so the service-role-backed mutation endpoints are not exposed to your network during the local demo. Set `HOST` only when deploying behind an authenticated reverse proxy or after adding Supabase Auth.