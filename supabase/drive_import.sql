-- Drive -> website import setup.
-- Run this whole file in the Supabase SQL editor.

-- 1) Column used to dedupe (so the same Drive file is never imported twice,
--    and website-uploaded files don't bounce back).
alter table public.photos add column if not exists drive_file_id text;
create index if not exists photos_drive_file_id_idx on public.photos (drive_file_id);

-- 2) Extensions needed to call the function on a schedule.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Schedule the import every 2 minutes.
--    >>> REPLACE the secret below with your WEBHOOK_SECRET value. <<<
select cron.schedule(
  'drive-import-2min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://nyhjkcrbomolgeraikss.functions.supabase.co/drive-import',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', 'REPLACE_WITH_YOUR_WEBHOOK_SECRET'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- To make it faster (e.g. every 10 seconds), unschedule and reschedule with
-- '10 seconds' instead of '*/2 * * * *'. Note: 10s burns free-tier limits fast.
--   select cron.unschedule('drive-import-2min');
-- To see scheduled jobs:
--   select * from cron.job;
