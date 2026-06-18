# Import photos FROM Google Drive to the website

Watches your "Event Photos" Drive folder (and its date subfolders) and, every
2 minutes, imports any new images you added in Drive directly — so they show up
on the website and get AI-processed.

```
you drop a photo in Drive  ->  (every 2 min) drive-import  ->  Supabase  ->  website
```

Loop protection: photos the website itself saved to Drive are tagged and
skipped, so nothing bounces back and forth.

---

## Step 1 — Upgrade the Google token to READ access (one time)

The current token can only see files the app created. To read photos you add by
hand, redo the consent with full Drive scope:

1. Go to https://developers.google.com/oauthplayground → gear ⚙ →
   "Use your own OAuth credentials" → paste your Client ID + secret (same as
   before).
2. In "Input your own scopes" paste exactly:
   `https://www.googleapis.com/auth/drive`
3. Authorize APIs → sign in → Allow → **Exchange authorization code for tokens**.
4. Copy the new **Refresh token** and update the secret:
   ```
   npx supabase secrets set GOOGLE_REFRESH_TOKEN="the-new-refresh-token"
   ```
   (This token still works for the site->Drive direction too.)

## Step 2 — Run the SQL

In the Supabase SQL editor, open `supabase/drive_import.sql`, replace
`REPLACE_WITH_YOUR_WEBHOOK_SECRET` with your WEBHOOK_SECRET value, and run it.
This adds the dedupe column and schedules the 2-minute job.

> If `create extension pg_cron` / `pg_net` errors, enable them first in
> Dashboard → Database → Extensions (search pg_cron, pg_net, toggle on), then
> re-run the SQL.

## Step 3 — Deploy both functions

```
cd "C:\induction pro 2\ai photo sorter\webapp"
npx supabase functions deploy drive-sync
npx supabase functions deploy drive-import
```

(`drive-sync` is redeployed because it now tags files + records their Drive id.)

## Step 4 — Test

1. Add a photo straight into the "Event Photos" folder (or a date subfolder) in
   Google Drive.
2. Within ~2 minutes it appears on the website.
3. Check Dashboard → Edge Functions → drive-import → Logs. A run returns
   `{ ok: true, scanned: N, imported: M }`.

## Notes / cautions

- Any image already sitting in "Event Photos" when you first enable this will be
  imported on the first run. If you have test junk in there, delete it from
  Drive first.
- Imported photos are attributed to uploader "Google Drive" and processed by the
  in-browser AI when an admin has the gallery/dashboard open.
- To pause: `select cron.unschedule('drive-import-2min');` in SQL.
