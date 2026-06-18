-- ============================================================
-- Admin dashboard add-ons: moderation (hidden), role management,
-- and guest scan analytics. Run once in Supabase SQL Editor.
-- ============================================================

-- 1) Moderation flag: hide a photo from the public guest search
alter table public.photos add column if not exists hidden boolean default false;

-- guest RPC now skips hidden photos
create or replace function public.all_face_photos()
returns table (id uuid, url text, faces jsonb, category text, caption text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.url, p.faces, p.category, p.caption, p.created_at
  from public.photos p
  where p.faces is not null and jsonb_array_length(p.faces) > 0
    and coalesce(p.hidden, false) = false;
$$;
grant execute on function public.all_face_photos() to anon, authenticated;

-- 2) Let admins change anyone's role (promote/demote cameramen)
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin());

-- 3) Guest scan analytics
create table if not exists public.guest_scans (
  id         uuid primary key default gen_random_uuid(),
  matches    int default 0,
  created_at timestamptz default now()
);
alter table public.guest_scans enable row level security;
drop policy if exists "gs_insert" on public.guest_scans;
create policy "gs_insert" on public.guest_scans
  for insert to anon, authenticated with check (true);
drop policy if exists "gs_select" on public.guest_scans;
create policy "gs_select" on public.guest_scans
  for select using (public.is_admin());
