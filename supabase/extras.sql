-- ============================================================
-- GPS map + "tag me" email alerts. Run once in Supabase SQL Editor.
-- ============================================================
alter table public.photos add column if not exists lat double precision;
alter table public.photos add column if not exists lng double precision;

-- Guests who want to be notified when new photos of them appear
create table if not exists public.watchers (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  descriptor   jsonb not null,
  notified_ids jsonb default '[]'::jsonb,
  created_at   timestamptz default now()
);
alter table public.watchers enable row level security;
drop policy if exists "watchers_insert" on public.watchers;
create policy "watchers_insert" on public.watchers
  for insert to anon, authenticated with check (true);
-- (No public SELECT: the email Edge Function reads this with the service role.)

-- admin can read watchers
drop policy if exists "watchers_admin_select" on public.watchers;
create policy "watchers_admin_select" on public.watchers
  for select using (public.is_admin());
