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

Location autocomplete in the report form now uses global geocoding suggestions (countries, states, and cities) through `/api/places`, with starts-with matches ranked before contains matches and country symbols shown in the suggestion list.

If you already ran the schema, run it again after updates so the `dispatch_incident` transaction function is created. The function should only be callable by the backend service role.

For the interactive map, run the updated schema once more so `incidents.latitude` and `incidents.longitude` are added. Reports may include coordinates; existing Kochi seed locations use built-in fallback coordinates.

## Run locally

```powershell
npm install
npm start
```

The API uses Supabase when the service-role variables are configured. If the Supabase variables are placeholders, it uses in-memory demo data for previewing; otherwise, run the schema before using the API.

For safety, the server binds to `127.0.0.1` by default, so the service-role-backed mutation endpoints are not exposed to your network during the local demo. Set `HOST` only when deploying behind an authenticated reverse proxy or after adding Supabase Auth.