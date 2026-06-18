-- Allow admins to view the tag-me watchers list.
drop policy if exists "watchers_admin_select" on public.watchers;
create policy "watchers_admin_select" on public.watchers
  for select using (public.is_admin());
