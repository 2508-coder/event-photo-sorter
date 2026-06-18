# Auto-copy uploads to Google Drive (by date)

Every photo a cameraman uploads is automatically saved into **your** Google
Drive, inside a subfolder named by date (e.g. `2026-06-16`). The website keeps
working normally on Supabase; this just mirrors each new photo to Drive.

How it works:

```
cameraman uploads -> Supabase (photos row) -> DB webhook -> drive-sync function -> your Google Drive / YYYY-MM-DD
```

You connect your Google account **once** (it produces a long-lived refresh
token). After that it runs in the cloud forever — no PC or browser needs to stay
open.

---

## Step 1 — Make the Drive folder

1. In Google Drive, create a folder, e.g. **"Event Photos"**.
2. Open it. The URL looks like `https://drive.google.com/drive/folders/XXXXXXXX`.
   Copy that `XXXXXXXX` — that's your **DRIVE_PARENT_FOLDER_ID**.

## Step 2 — Create an OAuth client (free)

1. Go to https://console.cloud.google.com/ → create a project (any name).
2. APIs & Services → **Library** → search **Google Drive API** → **Enable**.
3. APIs & Services → **OAuth consent screen** → choose **External** → fill the
   app name + your email → Save. Under **Test users**, add your own Gmail.
4. APIs & Services → **Credentials** → **Create credentials** →
   **OAuth client ID** → Application type **Web application**.
   - Under *Authorized redirect URIs* add:
     `https://developers.google.com/oauthplayground`
   - Create. Copy the **Client ID** and **Client secret**.

## Step 3 — Get your refresh token (one time, no code)

1. Go to https://developers.google.com/oauthplayground
2. Click the **gear (⚙)** top-right → tick **"Use your own OAuth credentials"**
   → paste your Client ID + Client secret.
3. On the left, in "Input your own scopes", paste:
   `https://www.googleapis.com/auth/drive.file`
   then click **Authorize APIs** → sign in with your Google account → allow.
4. Click **Exchange authorization code for tokens**.
5. Copy the **Refresh token** value shown. That's **GOOGLE_REFRESH_TOKEN**.

## Step 4 — Set the secrets

In a terminal inside the `webapp` folder (one line each):

```
npx supabase secrets set GOOGLE_CLIENT_ID="your-client-id"
npx supabase secrets set GOOGLE_CLIENT_SECRET="your-client-secret"
npx supabase secrets set GOOGLE_REFRESH_TOKEN="your-refresh-token"
npx supabase secrets set DRIVE_PARENT_FOLDER_ID="your-folder-id"
npx supabase secrets set WEBHOOK_SECRET="pick-any-random-string-123"
```

(Remember the WEBHOOK_SECRET value — you'll paste it in Step 6.)

## Step 5 — Deploy the function

```
npx supabase functions deploy drive-sync
```

Your function URL is:
`https://nyhjkcrbomolgeraikss.functions.supabase.co/drive-sync`

## Step 6 — Create the Database Webhook

In the Supabase dashboard:

1. **Database → Webhooks → Create a new hook**.
2. Name: `drive-sync`. Table: **photos**. Events: **Insert**.
3. Type: **HTTP Request**, Method **POST**.
4. URL: `https://nyhjkcrbomolgeraikss.functions.supabase.co/drive-sync`
5. Add an HTTP **header**:
   - Name: `x-webhook-secret`
   - Value: the same WEBHOOK_SECRET string from Step 4.
6. Save.

## Done

Upload a test photo from the site. Within a few seconds it appears in your
Drive under today's date folder. Check the function logs (Dashboard →
Edge Functions → drive-sync → Logs) if anything fails.

### Notes
- Scope `drive.file` only lets the app see/manage files **it created** — it
  cannot read the rest of your Drive. Safe and minimal.
- The refresh token can expire if the OAuth consent screen stays in "Testing"
  for a long time; if uploads stop, redo Step 3 and re-set GOOGLE_REFRESH_TOKEN.
  Publishing the consent screen avoids this.
