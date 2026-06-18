// drive-sync — runs in Supabase's cloud. Fired by a Database Webhook whenever a
// new row is inserted into "photos". Downloads the image and uploads it into
// the admin's Google Drive, inside a per-date subfolder (YYYY-MM-DD).
//
// Secrets required (supabase secrets set ...):
//   GOOGLE_CLIENT_ID        OAuth client id
//   GOOGLE_CLIENT_SECRET    OAuth client secret
//   GOOGLE_REFRESH_TOKEN    refresh token from the one-time consent (see README)
//   DRIVE_PARENT_FOLDER_ID  the Drive folder to put dated subfolders in
//   WEBHOOK_SECRET          any random string; must match the webhook header
//
// Deploy:  npx supabase functions deploy drive-sync

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

// Cache date-folder ids across invocations of the same warm instance.
const folderCache = new Map<string, string>();

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
    refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("token: " + (await r.text()));
  return (await r.json()).access_token;
}

// With the drive.file scope the app can only see folders IT created, so we
// create our own top-level folder (by name) instead of relying on a hand-made
// one. It shows up in your My Drive.
async function findOrCreateRoot(token: string): Promise<string> {
  const name = Deno.env.get("DRIVE_ROOT_NAME") || "Event Photos";
  if (folderCache.has("__root__")) return folderCache.get("__root__")!;

  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const sr = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&spaces=drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sj = await sr.json();
  if (sj.files && sj.files.length) {
    folderCache.set("__root__", sj.files[0].id);
    return sj.files[0].id;
  }

  const cr = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!cr.ok) throw new Error("mkdir root: " + (await cr.text()));
  const id = (await cr.json()).id;
  folderCache.set("__root__", id);
  return id;
}

async function findOrCreateDateFolder(token: string, date: string): Promise<string> {
  if (folderCache.has(date)) return folderCache.get(date)!;
  const parent = await findOrCreateRoot(token);

  // Look for an existing subfolder with this name.
  const q = encodeURIComponent(
    `name='${date}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const sr = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&spaces=drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sj = await sr.json();
  if (sj.files && sj.files.length) {
    folderCache.set(date, sj.files[0].id);
    return sj.files[0].id;
  }

  // Create it.
  const cr = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: date,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parent],
    }),
  });
  if (!cr.ok) throw new Error("mkdir: " + (await cr.text()));
  const id = (await cr.json()).id;
  folderCache.set(date, id);
  return id;
}

async function uploadToDrive(token: string, folderId: string, name: string, bytes: Uint8Array, contentType: string) {
  // appProperties.src marks this file as website-origin so the importer skips it.
  const meta = { name, parents: [folderId], appProperties: { src: "website" } };
  const boundary = "drivesync" + crypto.randomUUID();
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const r = await fetch(DRIVE_UPLOAD, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!r.ok) throw new Error("upload: " + (await r.text()));
  return (await r.json()).id as string;
}

Deno.serve(async (req) => {
  // Simple shared-secret check so only your webhook can trigger this.
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const payload = await req.json();
    const rec = payload.record || payload; // DB webhook sends { record: {...} }
    const url: string = rec.url;
    const storagePath: string = rec.storage_path || "";
    if (!url) return new Response("no url", { status: 200 });

    // LOOP BREAKER: never push a photo back to Drive if it was imported FROM
    // Drive. Without this, imported rows get re-uploaded as new Drive files,
    // which the importer then re-imports — multiplying copies endlessly.
    if (rec.source === "drive") {
      return new Response(JSON.stringify({ ok: true, skipped: "drive-origin" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Date subfolder from created_at (fallback: today, UTC).
    const created = rec.created_at ? new Date(rec.created_at) : new Date();
    const date = created.toISOString().slice(0, 10); // YYYY-MM-DD

    // File name: keep the original storage filename if present.
    const baseName = storagePath.split("/").pop() || (rec.id + ".jpg");

    // Download the image bytes from the public URL.
    const img = await fetch(url);
    if (!img.ok) throw new Error("fetch image: " + img.status);
    const contentType = img.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(await img.arrayBuffer());

    const token = await getAccessToken();
    const folderId = await findOrCreateDateFolder(token, date);
    const fileId = await uploadToDrive(token, folderId, baseName, bytes, contentType);

    // Record the Drive id on the photo row so the importer never re-imports it.
    try {
      const SB = Deno.env.get("SUPABASE_URL");
      const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SB && KEY && rec.id) {
        await fetch(`${SB}/rest/v1/photos?id=eq.${rec.id}`, {
          method: "PATCH",
          headers: {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ drive_file_id: fileId }),
        });
      }
    } catch (_) { /* non-fatal */ }

    return new Response(JSON.stringify({ ok: true, fileId, folder: date }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
