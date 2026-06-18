# Tag-me email alerts (Google Apps Script + Gmail)

Free replacement for the notify-watchers Edge Function. No Resend, no API key,
no Edge Function. Emails guests (via your Gmail) when new photos matching their
face are posted.

## Setup
1. https://script.google.com -> New project -> paste all of `Code.gs`.
2. Fill in `SERVICE_ROLE_KEY` (Supabase -> Settings -> API -> service_role),
   `GUEST_URL` (your live guest page), and `MATCH_THRESHOLD`
   (0.5 for the faceapi engine, 0.9 for human).
3. Run **sendAlerts** once -> approve the permission prompt (Gmail + external requests).
4. Run **createAlertsTrigger** once -> now it checks every 15 minutes automatically.

## How it works
- Tracks the last run time; each run only looks at photos added since then.
- For each watcher, compares their stored face descriptor to new photos' faces
  (plain euclidean distance — the descriptors were already computed by the app).
- Emails matches via Gmail with preview thumbnails + a link to the guest page.

## Notes
- Gmail free quota ~100 recipients/day. Plenty for most events; for huge events
  use a Google Workspace account (higher limit).
- After this is running you can ignore the dashboard's "Run alerts now" button
  (or remove it later) — alerts now come from here.
- Keep MATCH_THRESHOLD in sync with your app's face engine.
