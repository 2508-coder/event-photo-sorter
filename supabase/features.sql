-- ============================================================
-- Feature add-on: lighting, emotion, privacy flag, captions,
-- people names, and smart albums. Run once in Supabase SQL Editor.
-- (Fresh setups: schema.sql already includes all of this.)
-- ============================================================
alter table public.photos add column if not exists brightness double precision;
alter table public.photos add column if not exists emotion   text;
alter table public.photos add column if not exists sensitive boolean;
alter table public.photos add column if not exists caption   text;

-- Named people (each row = one person, identified by a face centroid)
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null references auth.users(id) on delete cascade,
  name text not null,
  centroid jsonb not null,
  created_at timestamptz default now()
);
alter table public.people enable row level security;
drop policy if exists "people_all_own" on public.people;
create policy "people_all_own" on public.people
  for all using (auth.uid() = uid) with check (auth.uid() = uid);

-- Smart albums (a saved natural-language search)
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null references auth.users(id) on delete cascade,
  name text not null,
  query text not null,
  created_at timestamptz default now()
);
alter table public.albums enable row level security;
drop policy if exists "albums_all_own" on public.albums;
create policy "albums_all_own" on public.albums
  for all using (auth.uid() = uid) with check (auth.uid() = uid);
