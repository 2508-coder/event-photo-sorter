-- Security hardening: IDOR fixes (update/delete) + profile role policies.
-- Safe & idempotent. RLS policies are permissive (OR'd), so these only ADD access.

-- admin check (SECURITY DEFINER avoids RLS recursion)
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists (select 1 from public.profiles where uid = auth.uid() and role = 'admin');
$$;

alter table public.photos enable row level security;

-- Only the owner (or an admin) may modify/remove a photo row.
drop policy if exists "photos update own or admin" on public.photos;
create policy "photos update own or admin" on public.photos
  for update using (uid = auth.uid() or public.is_admin())
  with check (uid = auth.uid() or public.is_admin());

drop policy if exists "photos delete own or admin" on public.photos;
create policy "photos delete own or admin" on public.photos
  for delete using (uid = auth.uid() or public.is_admin());

-- Profiles: user manages own row; admin may update any (role changes).
alter table public.profiles enable row level security;

drop policy if exists "profile self upsert" on public.profiles;
create policy "profile self upsert" on public.profiles
  for insert with check (uid = auth.uid());

drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles
  for update using (uid = auth.uid()) with check (uid = auth.uid());

drop policy if exists "admins update any profile" on public.profiles;
create policy "admins update any profile" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());
