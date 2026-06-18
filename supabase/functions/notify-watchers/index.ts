// Supabase Edge Function: email guests when new photos of them are posted.
// Deploy:  supabase functions deploy notify-watchers --no-verify-jwt
// Secrets: supabase secrets set RESEND_API_KEY=... GUEST_URL=https://yoursite/guest.html
// Trigger: schedule it (pg_cron / Supabase scheduled functions) every few minutes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = Deno.env.get("ALERT_FROM") ?? "Event Photos <onboarding@resend.dev>";
const GUEST_URL = Deno.env.get("GUEST_URL") ?? "";
const THRESHOLD = 0.56;

function dist(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: watchers } = await sb.from("watchers").select("*");
  const { data: photos } = await sb.from("photos")
    .select("id,url,faces").not("faces", "is", null).eq("hidden", false);

  let emailed = 0;
  for (const w of watchers ?? []) {
    const notified = new Set<string>(w.notified_ids ?? []);
    const fresh: any[] = [];
    for (const p of photos ?? []) {
      if (notified.has(p.id)) continue;
      const faces = p.faces ?? [];
      if (faces.some((f: any) => dist(w.descriptor, f.v) < THRESHOLD)) fresh.push(p);
    }
    if (!fresh.length) continue;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: w.email,
        subject: `📸 ${fresh.length} new photo(s) of you!`,
        html:
          `<h2>New photos of you are in!</h2><p>We found ${fresh.length} new photo(s) of you at the event.</p>` +
          fresh.slice(0, 12).map((p) => `<img src="${p.url}" style="width:160px;margin:4px;border-radius:8px"/>`).join("") +
          (GUEST_URL ? `<p><a href="${GUEST_URL}">Open the photo finder →</a></p>` : ""),
      }),
    });

    await sb.from("watchers")
      .update({ notified_ids: [...notified, ...fresh.map((p) => p.id)] })
      .eq("id", w.id);
    emailed++;
  }
  return new Response(JSON.stringify({ ok: true, emailed }), { headers: { "Content-Type": "application/json" } });
});
