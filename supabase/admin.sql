-- ============================================================
-- Admin roles, cameraman tracking, and anonymous guest face search.
-- Run once in Supabase SQL Editor (idempotent).
-- ============================================================

-- 1) Profiles: one row per signed-in user (cameraman/admin) + last_seen
create table if not exists public.profiles (
  uid        uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text default 'cameraman',
  last_seen  timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

-- Helper: is the current user an admin? (security definer avoids RLS recursion)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where uid = auth.uid() and role = 'admin');
$$;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (uid = auth.uid() or public.is_admin());
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert with check (uid = auth.uid());
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (uid = auth.uid());

-- 2) Admin can see + manage ALL photos (added alongside the per-user policies)
drop policy if exists "photos_admin_select" on public.photos;
create policy "photos_admin_select" on public.photos for select using (public.is_admin());
drop policy if exists "photos_admin_update" on public.photos;
create policy "photos_admin_update" on public.photos for update using (public.is_admin());
drop policy if exists "photos_admin_delete" on public.photos;
create policy "photos_admin_delete" on public.photos for delete using (public.is_admin());

-- 3) Anonymous guest face search: returns only what's needed to match + view.
create or replace function public.all_face_photos()
returns table (id uuid, url text, faces jsonb, category text, caption text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.url, p.faces, p.category, p.caption, p.created_at
  from public.photos p
  where p.faces is not null and jsonb_array_length(p.faces) > 0;
$$;
grant execute on function public.all_face_photos() to anon, authenticated;

-- ============================================================
-- 4) >>> MAKE YOURSELF ADMIN <<<
-- After that email signs up once in the app, run (edit the address):
--   update public.profiles set role = 'admin' where email = 'YOUR_ADMIN_EMAIL@example.com';
-- ============================================================
