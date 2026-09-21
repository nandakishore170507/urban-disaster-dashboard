create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null default 'citizen' check (role in ('citizen', 'coordinator')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can create their own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  location text not null,
  latitude double precision,
  longitude double precision,
  description text not null,
  photo_name text,
  severity text not null default 'Medium' check (severity in ('Low', 'Medium', 'High', 'Critical')),
  status text not null default 'Reported' check (status in ('Reported', 'Assigned', 'Responding', 'Resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.response_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  assignment text,
  status text not null default 'Standby' check (status in ('Standby', 'En route', 'On site')),
  eta text not null default '—',
  created_at timestamptz not null default now()
);

create table if not exists public.incident_assignments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  team_id uuid not null references public.response_teams(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (incident_id, team_id)
);

create table if not exists public.public_alerts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists incidents_created_at_idx on public.incidents (created_at desc);
create index if not exists incidents_status_idx on public.incidents (status);

alter table public.incidents enable row level security;
alter table public.response_teams enable row level security;
alter table public.incident_assignments enable row level security;
alter table public.public_alerts enable row level security;

insert into public.response_teams (name, assignment, status, eta)
values
  ('Alpha 01', 'Palarivattom overflow', 'En route', '06 min'),
  ('Medical 03', 'Edappally evacuation', 'On site', '—'),
  ('Utility 02', 'Vyttila power outage', 'Standby', '18 min')
on conflict (name) do nothing;

insert into public.incidents (title, location, description, severity, status)
select *
from (values
  ('Canal overflow', 'Palarivattom', 'Overflow reported near the canal.', 'Critical', 'Reported'),
  ('Road submerged', 'Kaloor junction', 'Road access is blocked by rising water.', 'High', 'Reported'),
  ('Power outage', 'Vyttila ward', 'Multiple streets are without power.', 'High', 'Reported'),
  ('Medical evacuation', 'Edappally', 'Residents require medical evacuation.', 'Medium', 'Responding')
) as seed(title, location, description, severity, status)
where not exists (select 1 from public.incidents);

alter table public.incidents add column if not exists latitude double precision;
alter table public.incidents add column if not exists longitude double precision;

insert into public.public_alerts (title, message)
select 'Monsoon surge advisory',
       'Heavy rainfall expected in Zones 2 and 4 between 14:00–18:00.'
where not exists (select 1 from public.public_alerts where active);

create or replace function public.dispatch_incident(p_incident_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  incident_row public.incidents;
  team_row public.response_teams;
begin
  update public.incidents
  set status = 'Assigned', updated_at = now()
  where id = p_incident_id
  returning * into incident_row;
  if incident_row.id is null then raise exception 'Incident not found'; end if;

  update public.response_teams
  set status = 'En route',
      assignment = incident_row.title || ' · ' || incident_row.location,
      eta = '08 min'
  where id = p_team_id
  returning * into team_row;
  if team_row.id is null then raise exception 'Response team not found'; end if;

  insert into public.incident_assignments (incident_id, team_id)
  values (p_incident_id, p_team_id)
  on conflict (incident_id, team_id) do nothing;

  return jsonb_build_object(
    'incident', to_jsonb(incident_row),
    'team', to_jsonb(team_row)
  );
end;
$$;

revoke execute on function public.dispatch_incident(uuid, uuid) from public;
grant execute on function public.dispatch_incident(uuid, uuid) to service_role;
