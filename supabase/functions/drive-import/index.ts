// drive-import — runs on a schedule (every 2 min). Looks in the "Event Photos"
// Drive folder (and its date subfolders) for NEW images that were added in
// Drive directly (not by the website), downloads them into Supabase Storage and
// inserts a photos row so they appear on the site and get AI-processed.
//
// Loop protection: files uploaded by the website carry appProperties.src=website
// AND their Drive id is stored on the photo row, so they are skipped here.
//
// Needs the same Google secrets as drive-sync, but the refresh token must have
// READ access (re-do the consent with scope: https://www.googleapis.com/auth/drive).
// Deploy:  npx supabase functions deploy drive-import

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "photos";
const IMPORT_FOLDER = "drive-import"; // readable storage folder name

// Resolve a REAL owner uid for imported photos. photos.uid has a foreign key to
// the users table, so it must be an existing account. We prefer an explicit
// IMPORT_UID secret; otherwise we auto-pick the admin account (then any account).
let _ownerUid: string | null = null;
async function getOwnerUid(): Promise<string> {
  if (_ownerUid) return _ownerUid;
  const env = Deno.env.get("IMPORT_UID");
  if (env && /^[0-9a-f-]{36}$/i.test(env)) { _ownerUid = env; return env; }

  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  // Try an admin first.
  let r = await fetch(`${SB}/rest/v1/profiles?select=uid&role=eq.admin&limit=1`, { headers });
  let rows = await r.json();
  if (Array.isArray(rows) && rows.length && rows[0].uid) { _ownerUid = rows[0].uid; return _ownerUid!; }
  // Fall back to any existing profile.
  r = await fetch(`${SB}/rest/v1/profiles?select=uid&limit=1`, { headers });
  rows = await r.json();
  if (Array.isArray(rows) && rows.length && rows[0].uid) { _ownerUid = rows[0].uid; return _ownerUid!; }
  throw new Error("no owner uid: create an account / set an admin in profiles first");
}

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

async function findRoot(token: string): Promise<string | null> {
  const name = Deno.env.get("DRIVE_ROOT_NAME") || "Event Photos";
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const r = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&spaces=drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  return j.files && j.files.length ? j.files[0].id : null;
}

async function listChildren(token: string, parentId: string, foldersOnly: boolean) {
  const mimeClause = foldersOnly
    ? "mimeType='application/vnd.google-apps.folder'"
    : "mimeType contains 'image/'";
  const q = encodeURIComponent(`'${parentId}' in parents and ${mimeClause} and trashed=false`);
  const out: any[] = [];
  let pageToken = "";
  do {
    const url =
      `${DRIVE_FILES}?q=${q}&fields=nextPageToken,files(id,name,mimeType,appProperties)` +
      `&pageSize=1000&spaces=drive` + (pageToken ? `&pageToken=${pageToken}` : "");
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    (j.files || []).forEach((f: any) => out.push(f));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

// All Drive ids we already have, so we never import the same file twice.
async function existingDriveIds(): Promise<Set<string>> {
  const r = await fetch(
    `${SB}/rest/v1/photos?select=drive_file_id&drive_file_id=not.is.null`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  );
  const rows = await r.json();
  return new Set((rows || []).map((x: any) => x.drive_file_id));
}

async function importFile(token: string, f: any) {
  const ownerUid = await getOwnerUid();
  // Download bytes from Drive.
  const dl = await fetch(`${DRIVE_FILES}/${f.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dl.ok) throw new Error("download " + f.id + ": " + dl.status);
  const contentType = dl.headers.get("content-type") || f.mimeType || "image/jpeg";
  const bytes = new Uint8Array(await dl.arrayBuffer());

  const ext = (f.name && f.name.includes(".")) ? f.name.split(".").pop() : "jpg";
  const storagePath = `${IMPORT_FOLDER}/${f.id}.${ext}`;

  // Upload into Supabase Storage (service role). x-upsert overwrites instead of
  // failing with a 409 when the object already exists.
  const up = await fetch(`${SB}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) {
    const txt = await up.text();
    // A duplicate is fine — the object exists, carry on to insert the row.
    if (!txt.includes("Duplicate") && up.status !== 409) {
      throw new Error("storage " + f.id + ": " + txt);
    }
  }

  const publicUrl = `${SB}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  // Insert the photo row (processed=false -> AI runs when gallery is open).
  // on_conflict + ignore-duplicates: if two overlapping runs try the same Drive
  // file, the DB unique index makes the 2nd a no-op instead of a duplicate row.
  const ins = await fetch(`${SB}/rest/v1/photos?on_conflict=drive_file_id`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=ignore-duplicates",
    },
    body: JSON.stringify({
      uid: ownerUid,
      url: publicUrl,
      storage_path: storagePath,
      source: "drive",
      uploader: "Google Drive",
      processed: false,
      drive_file_id: f.id,
    }),
  });
  if (!ins.ok) throw new Error("insert " + f.id + ": " + (await ins.text()));
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const token = await getAccessToken();
    const root = await findRoot(token);
    if (!root) return new Response(JSON.stringify({ ok: true, imported: 0, note: "no root folder yet" }), { headers: { "Content-Type": "application/json" } });

    // Collect candidate folders: root + its date subfolders.
    const folders = [root, ...(await listChildren(token, root, true)).map((f) => f.id)];

    // Gather all image files in those folders.
    let files: any[] = [];
    for (const fid of folders) {
      files = files.concat(await listChildren(token, fid, false));
    }

    const seen = await existingDriveIds();
    let imported = 0;
    const errors: string[] = [];
    for (const f of files) {
      if (seen.has(f.id)) continue;                     // already in DB
      if (f.appProperties && f.appProperties.src === "website") continue; // site-origin
      try { await importFile(token, f); imported++; }
      catch (e) { errors.push(String(e)); }
    }

    return new Response(JSON.stringify({ ok: true, scanned: files.length, imported, errors }), {
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
