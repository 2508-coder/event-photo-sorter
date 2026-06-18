# Drive -> Website importer (Google Apps Script)

Reliable replacement for the Edge Function + cron. Runs inside your Google
account, so there are no OAuth tokens, scopes, or consent-screen steps.

## Setup (5 minutes)

1. Go to **https://script.google.com** → **New project**.
2. Delete the sample code, paste everything from `Code.gs`.
3. Fill in the 3 config values at the top:
   - `SERVICE_ROLE_KEY` — Supabase → Settings → API → **service_role** key.
   - `FOLDER_ID` — open your "Event Photos" folder in Drive; the URL is
     `https://drive.google.com/drive/folders/XXXX` → copy the `XXXX`.
   - (`SUPABASE_URL` is already filled in.)
4. Click **Save**.
5. In the function dropdown choose **importNewPhotos** → **Run**.
   - First run asks for permission → **Review permissions** → pick your Google
     account → "Advanced" → "Go to (project) (unsafe)" → **Allow**.
     (It's your own script; this is normal.)
6. Choose **createTrigger** in the dropdown → **Run**. This makes it run every
   minute automatically.

Done. Drop a photo into the Drive folder; within ~1 minute it's on the website.

## Important — turn off the old cron so they don't both run

In the Supabase SQL editor:
```sql
select cron.unschedule('drive-import-2min');   -- or 'drive-import-10s' if that's active
```
(The website -> Drive direction via the `drive-sync` function can stay as-is.)

## Seeing the photos
Imported photos are owned by your **admin** account. Log in as admin, open the
**All** tab. They won't appear on a cameraman login or the guest page — by design.

## Notes
- Duplicates can't happen — the unique `drive_file_id` index blocks them.
- Check **Executions** (left sidebar in Apps Script) to see each run's log,
  e.g. "Imported 3 new photo(s)."
- It remembers synced files, so it only uploads new ones each run.
