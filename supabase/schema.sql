-- Trip Map schema. Run this once in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  is_shared boolean not null default false,
  share_slug text unique,
  trim_ends boolean not null default false,
  music text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null default 'Day',
  color text not null default '#E8A44C',
  position int not null default 0,
  pts jsonb not null,          -- [[lat,lng,ele,t], ...]  t = epoch ms or null
  dist_m double precision not null default 0,
  gain_m double precision not null default 0,
  has_time boolean not null default false
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,  -- manual day override
  path text not null,          -- storage path in the photos bucket
  lat double precision,        -- null = unplaced (in the tray)
  lng double precision,
  caption text not null default '',
  taken_wall jsonb,            -- {y,mo,d,h,mi,s} wall-clock capture time
  tz_offset_min int,           -- embedded tz offset if the camera recorded one
  created_at timestamptz not null default now()
);

alter table public.trips  enable row level security;
alter table public.days   enable row level security;
alter table public.photos enable row level security;

-- Trips: owners see and manage their own; anyone can read a shared trip.
create policy trips_select on public.trips for select
  using (owner = auth.uid() or is_shared = true);
create policy trips_insert on public.trips for insert
  with check (owner = auth.uid());
create policy trips_update on public.trips for update
  using (owner = auth.uid());
create policy trips_delete on public.trips for delete
  using (owner = auth.uid());

-- Days & photos inherit access from their trip.
create policy days_select on public.days for select using (
  exists (select 1 from public.trips t where t.id = trip_id
          and (t.owner = auth.uid() or t.is_shared)));
create policy days_write on public.days for all using (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()))
  with check (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()));

create policy photos_select on public.photos for select using (
  exists (select 1 from public.trips t where t.id = trip_id
          and (t.owner = auth.uid() or t.is_shared)));
create policy photos_write on public.photos for all using (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()))
  with check (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()));

-- Public photo bucket (paths are unguessable UUIDs; canvas re-encoding strips EXIF).
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;

create policy photos_bucket_insert on storage.objects for insert
  with check (bucket_id = 'photos' and auth.uid() is not null);
create policy photos_bucket_delete on storage.objects for delete
  using (bucket_id = 'photos' and owner = auth.uid());
