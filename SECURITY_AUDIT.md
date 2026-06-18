# Security Architecture Review & Threat Model
### AI Photo Sorter — React + Supabase + in-browser AI

> Scope: web app (`index.html` admin/main, `guest.html`, `qr.html`), Supabase
> (Postgres + RLS, public `photos` bucket, Realtime, Auth, pgvector), Google
> Apps Script integrations (Drive sync, Gmail alerts). AI runs client-side.

## Risk summary

| # | Risk | Domain | Severity |
|---|------|--------|----------|
| 1 | Anonymous guest RPC exposes the entire photo set + face data | Access control | **Critical** |
| 2 | Public storage bucket — objects readable by anyone with a URL | Storage | **High** |
| 3 | Weak webhook/cron shared secret (`"7"`) | Misconfig | **High** |
| 4 | service_role key leakage (Apps Script / repo / build) | Secrets | **Critical** |
| 5 | Missing/weak RLS on update/delete → IDOR | Access control | **High** |
| 6 | Open self-signup → anyone uploads to the event | Auth | **High** |
| 7 | EXIF GPS retained in stored originals + exposed | Privacy | **High** |
| 8 | Malicious/over-size upload, content-type spoofing → stored XSS | Upload | **Medium** |
| 9 | No rate limiting on anon RPCs (data scrape, email/abuse) | Abuse | **Medium** |
| 10 | XSS via innerHTML in Leaflet popups / HTML email | Injection | **Medium** |
| 11 | Weak auth hygiene (no email verify, weak passwords) | Auth | **Medium** |

---

## 1. Web Vulnerabilities (OWASP Top 10)

### 1.1 Broken Access Control — Anonymous guest RPC over-exposure  ⚠️ Critical
- **Threat:** The guest face-scan calls a `SECURITY DEFINER` RPC (`all_face_photos()`) that returns every non-hidden photo (URLs + stored face descriptors) to *anonymous* callers. An attacker doesn't need to scan a face — they call the RPC directly with your public anon key and dump the entire event: all images and everyone's biometric face vectors.
- **Impact:** Mass exfiltration of attendees' photos and face embeddings (biometric data). Serious privacy/GDPR-class exposure.
- **Mitigation:**
  - Make the RPC return the **minimum** needed and do matching **server-side**: accept the scan descriptor as a parameter and return only photos that match (don't ship all descriptors to the client).
  - Add **rate limiting** (see 3.3) and a short-lived guest token issued only after a real scan.
  - Never return `lat/lng`, `uploader`, or raw descriptors to anonymous callers.
  - Exclude `hidden = true` (already) **and** add a per-event flag so the RPC only serves the active event.

### 1.2 IDOR on photo management  ⚠️ High
- **Threat:** `deletePhoto(id)`, `setPhotoHidden(id)`, `setUserRole(uid)` operate by ID. If RLS isn't enforced on `UPDATE`/`DELETE`, any logged-in cameraman can delete or unhide *other* users' photos by guessing UUIDs.
- **Impact:** Data tampering/destruction, moderation bypass.
- **Mitigation:** Enforce row ownership + admin override in RLS (don't rely on the UI):
  ```sql
  alter table public.photos enable row level security;
  create policy "owner or admin can modify" on public.photos
    for update using (uid = auth.uid() or public.is_admin())
    with check (uid = auth.uid() or public.is_admin());
  create policy "owner or admin can delete" on public.photos
    for delete using (uid = auth.uid() or public.is_admin());
  ```

### 1.3 Injection (SQLi / XSS)
- **SQLi — Low.** Supabase PostgREST/`.rpc()` parameterize queries. One thing to watch: `semanticSearch` builds a vector string `"[" + embedding.join(",") + "]"`. Keep it numeric-only (validate the array is finite numbers) so it can't be abused to inject into the vector literal.
- **XSS — Medium.** React escapes JSX, so OCR text/captions/filenames are safe. **But** `MapView` builds Leaflet popups with raw HTML string interpolation, and the Gmail alert script builds `htmlBody` from `photo.url`. If any interpolated value were attacker-controlled, that's stored XSS.
- **Mitigation:** Never use `innerHTML`/HTML-string building with user data — set text via DOM APIs or escape. Validate that `url` is a Supabase storage URL before embedding. Add a Content-Security-Policy header on the host (Netlify `_headers`).

### 1.4 CSRF — Low
- **Why low:** Supabase auth uses **bearer tokens in headers**, not ambient cookies, so classic CSRF doesn't apply to the data API.
- **Mitigation:** Keep using header tokens (don't move auth to cookies without `SameSite`). For the Edge Function/cron endpoints, keep the shared-secret header (but strengthen it — see 1.5/3.1).

### 1.5 Security misconfiguration — weak shared secret
- **Threat:** Your webhook/cron secret is `"7"`. Anyone can call `drive-import`/`drive-sync`/`cleanup-storage` with `x-webhook-secret: 7`.
- **Impact:** Trigger unbounded imports, run cleanup (delete storage), exhaust quotas.
- **Mitigation:** Replace with a long random value and update the cron + webhook headers:
  ```
  npx supabase secrets set WEBHOOK_SECRET="$(openssl rand -hex 32)"
  ```

---

## 2. Data Privacy & File Upload Security

### 2.1 EXIF / GPS leakage  ⚠️ High
- **Threat:** Gallery uploads send the **original file**, which keeps EXIF — including precise GPS. You also extract and store `lat/lng`. So both the stored image *and* the DB reveal where/when attendees were.
- **Impact:** Physical-safety/stalking risk; location of minors at a campus event.
- **Mitigation:**
  - **Strip EXIF on upload** by re-encoding every image through a `<canvas>` before upload (your camera-capture path already does this; do the same for gallery uploads). Canvas re-encode drops all metadata.
  - If you need the map, store coordinates **admin-only** and never return `lat/lng` to guests; consider rounding/fuzzing coordinates.

### 2.2 Malicious file upload  Medium
- **Threat:** "PHP disguised as JPEG" — *good news:* Supabase Storage is object storage, **not** a PHP host, so there's no server-side code execution / RCE from an upload. The real risks are: (a) uploading an actual HTML/SVG file with `text/html`/`image/svg+xml` content-type → **stored XSS** when the public URL is opened; (b) content-type sniffing; (c) huge files exhausting storage/bandwidth.
- **Impact:** Stored XSS on the storage domain, storage abuse, denial of wallet.
- **Mitigation:**
  - Validate **MIME + magic bytes** client-side and reject non-image; re-encode to JPEG/WebP via canvas (this also neutralizes SVG/HTML payloads).
  - Restrict the bucket to image content-types and a **max file size** (Supabase bucket settings: allowed MIME types + file size limit).
  - Ensure objects are served with `Content-Disposition: attachment` or correct image content-type, never `text/html`. Disable SVG, or sanitize it.

---

## 3. AI & API Security

### 3.1 API keys & secrets
- **anon key (frontend) — OK by design.** It's meant to be public; security comes from **RLS**, not from hiding the key. So your whole security model rests on correct RLS (sections 1.1/1.2).
- **service_role key — Critical to protect.** It bypasses RLS entirely. It currently lives in Google Apps Script (server-side = acceptable) and in your function secrets. **Never** put it in the React app, the `dist/` build, or commit it to a repo. Scrub it from `apps-script*/Code.gs` before sharing those files.
- **Mitigation:** Rotate keys if they've ever been pasted into chat/screenshots/repo (Supabase → Settings → API → roll keys). Strengthen `WEBHOOK_SECRET` (3.1 above). Add a `.gitignore`/secret-scan before any commit.

### 3.2 Prompt injection / data poisoning
- **Prompt injection — N/A.** You run CLIP/face models in the browser; there's no LLM text endpoint accepting instructions, so there's nothing to "prompt-inject."
- **Data poisoning — Low.** A malicious upload could skew "Best of"/category stats, but impact is cosmetic. Models load from a public CDN — add **Subresource Integrity** / pin exact versions so a compromised CDN can't swap the model code.

### 3.3 Rate-limiting / abuse  Medium
- **Threat:** Anonymous endpoints — the guest RPC, `logGuestScan`, and `addWatcher` — have no throttling. `addWatcher(email)` can be abused to **email-bomb** arbitrary addresses via your Gmail alert script; the guest RPC can be scraped in a loop.
- **Mitigation:**
  - Add a **captcha** (hCaptcha/Turnstile) on the guest scan + watcher signup.
  - Rate-limit by IP at the edge (Supabase Edge Function in front, or Cloudflare Turnstile + WAF).
  - Validate/confirm the watcher email (double opt-in) before it can receive mail; cap emails/day.

---

## 4. Infrastructure & Storage

### 4.1 Public bucket  ⚠️ High
- **Threat:** The `photos` bucket is **public** — every object is readable by anyone with the URL (and paths are derived from UUIDs, but URLs leak via the RPC, sharing, caches, referrers).
- **Impact:** Permanent public exposure of all event photos regardless of app logic.
- **Mitigation (choose per your privacy bar):**
  - **Most secure:** make the bucket **private** and serve images via **short-lived signed URLs** (`createSignedUrl`) generated only for authorized users/guests after a match.
  - **Middle ground:** keep public for the live event but set a **lifecycle** to purge after the event, and disable bucket **listing**.
  - Either way: set allowed MIME types + size limits on the bucket (ties to 2.2).

### 4.2 In transit & at rest
- **In transit:** Supabase serves over **TLS** already; force HTTPS on the host (Netlify does by default) and add **HSTS** via `_headers`.
- **At rest:** Supabase encrypts storage/DB at rest. For extra sensitivity, you control retention + deletion; document a data-retention/erasure policy (guests can request removal).

### 4.3 Defense-in-depth checklist
- RLS enabled + tested on **every** table (`photos`, `profiles`, `people`, `albums`, `watchers`, `guest_scans`).
- Realtime: confirm channels respect RLS so subscribers can't receive rows they can't select.
- Least privilege: service_role only in server contexts; rotate on suspicion.
- Add security headers via Netlify `public/_headers`:
  ```
  /*
    Content-Security-Policy: default-src 'self'; img-src 'self' https://*.supabase.co https://images.weserv.nl data:; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://*.supabase.co
    X-Content-Type-Options: nosniff
    Referrer-Policy: no-referrer
    Strict-Transport-Security: max-age=31536000
  ```
- Backups: enable Supabase PITR/backups before the event.

---

## Priority fix order (do these first)
1. **Lock down the guest RPC** (1.1) — biggest exposure of photos + biometrics.
2. **Strong `WEBHOOK_SECRET`** + **rotate keys** if ever exposed (3.1).
3. **RLS on update/delete + profiles** (1.2).
4. **Strip EXIF on all uploads** (2.1).
5. **Decide bucket privacy** (4.1) and set MIME/size limits (2.2).
6. **Captcha + email opt-in** on guest/watcher endpoints (3.3).

> Note: This review reflects the architecture as described; validate each RLS
> policy against your live database, since RLS is the true security perimeter
> for a Supabase app with a public anon key.
