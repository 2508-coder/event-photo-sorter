# notify-watchers — email guests when new photos of them appear

This runs on Supabase Edge (Deno). It reads `watchers` (guests who left an email +
face on the guest site), matches their face against new `photos`, and emails them.

## Setup
1. Email provider: create a free account at https://resend.com and get an API key.
2. Deploy the function:
   ```
   npx supabase login
   npx supabase functions deploy notify-watchers --no-verify-jwt
   ```
3. Set secrets:
   ```
   npx supabase secrets set RESEND_API_KEY=re_xxx GUEST_URL=https://yoursite/guest.html
   ```
   (Optional: `ALERT_FROM="Your Event <noreply@yourdomain.com>"` once you verify a domain in Resend.)
4. Run it on a schedule (every ~5 min). Easiest is Supabase **Scheduled Functions**
   (Dashboard → Edge Functions → Schedules) pointing at `notify-watchers`,
   or pg_cron calling the function URL.

That's it — guests who tap "Notify me" on the guest site will get an email with
their new photos.
