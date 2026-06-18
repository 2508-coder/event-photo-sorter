// cleanup-storage — one-off maintenance. Lists every object in the "photos"
// bucket, compares against storage_path values in the photos table, and deletes
// any orphaned files (in storage but not referenced by any row).
//
// Run it manually with curl (see below). Safe to run repeatedly.
// Deploy:  npx supabase functions deploy cleanup-storage

const SB = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "photos";

const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Recursively list every file path in the bucket.
async function listAll(prefix: string, out: string[]) {
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const r = await fetch(`${SB}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...sbHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const items = await r.json();
    if (!Array.isArray(items) || items.length === 0) break;
    for (const it of items) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) await listAll(path, out); // folder
      else out.push(path);                          // file
    }
    if (items.length < limit) break;
    offset += limit;
  }
}

// All storage_path values currently referenced by a row.
async function referencedPaths(): Promise<Set<string>> {
  const set = new Set<string>();
  let from = 0;
  const step = 1000;
  for (;;) {
    const r = await fetch(
      `${SB}/rest/v1/photos?select=storage_path&storage_path=not.is.null`,
      { headers: { ...sbHeaders, Range: `${from}-${from + step - 1}` } },
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    rows.forEach((x: any) => x.storage_path && set.add(x.storage_path));
    if (rows.length < step) break;
    from += step;
  }
  return set;
}

async function removeBatch(paths: string[]) {
  const r = await fetch(`${SB}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...sbHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!r.ok) throw new Error("delete: " + (await r.text()));
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const files: string[] = [];
    await listAll("", files);
    const referenced = await referencedPaths();
    const orphans = files.filter((p) => !referenced.has(p));

    for (let i = 0; i < orphans.length; i += 100) {
      await removeBatch(orphans.slice(i, i + 100));
    }

    return new Response(
      JSON.stringify({ ok: true, totalFiles: files.length, referenced: referenced.size, deleted: orphans.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
