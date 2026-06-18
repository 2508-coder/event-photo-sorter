// Supabase data layer: photos (Storage + Postgres + realtime), people, albums.
import { supabase } from "../supabase.js";

const TABLE = "photos";
const BUCKET = "photos";

// Collapse bursts of realtime events into one reload (huge win during bulk
// uploads/imports — otherwise every inserted row reloads the whole table).
function debounce(fn, ms) {
  let t = null;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// Light columns for the gallery — EXCLUDES heavy "embedding" + "faces".
const LIGHT_COLS =
  "id,url,storage_path,uid,source,uploader,processed,category,face_count," +
  "blur_score,is_blurry,brightness,phash,ocr_text,emotion,sensitive,caption," +
  "hidden,lat,lng,created_at";

export async function getHeavyData({ uid = null } = {}) {
  let q = supabase.from(TABLE).select("id,embedding,faces");
  if (uid) q = q.eq("uid", uid);
  const { data } = await q;
  return data || [];
}

// Load gallery rows. Tries light columns; if the DB is missing any of them
// (older schema), falls back to "*" so photos always show.
async function loadPhotoRows(uid) {
  let q = supabase.from(TABLE).select(LIGHT_COLS);
  if (uid) q = q.eq("uid", uid);
  let { data, error } = await q.order("created_at", { ascending: false });
  if (error) {
    let q2 = supabase.from(TABLE).select("*");
    if (uid) q2 = q2.eq("uid", uid);
    ({ data } = await q2.order("created_at", { ascending: false }));
  }
  return (data || []).map(rowToApp);
}

function rowToApp(r) {
  return {
    id: r.id,
    url: r.url,
    storagePath: r.storage_path,
    uid: r.uid,
    source: r.source,
    uploader: r.uploader,
    processed: r.processed,
    category: r.category,
    embedding: r.embedding,
    faces: r.faces,
    faceCount: r.face_count,
    blurScore: r.blur_score,
    isBlurry: r.is_blurry,
    brightness: r.brightness,
    phash: r.phash,
    ocrText: r.ocr_text,
    emotion: r.emotion,
    sensitive: r.sensitive,
    caption: r.caption,
    hidden: r.hidden,
    lat: r.lat,
    lng: r.lng,
    createdAt: r.created_at,
  };
}

function aiToRow(d) {
  const row = {};
  if ("processed" in d) row.processed = d.processed;
  if ("category" in d) row.category = d.category;
  if ("embedding" in d) row.embedding = d.embedding;
  if ("faces" in d) row.faces = d.faces;
  if ("faceCount" in d) row.face_count = d.faceCount;
  if ("blurScore" in d) row.blur_score = d.blurScore;
  if ("isBlurry" in d) row.is_blurry = d.isBlurry;
  if ("brightness" in d) row.brightness = d.brightness;
  if ("phash" in d) row.phash = d.phash;
  if ("ocrText" in d) row.ocr_text = d.ocrText;
  if ("emotion" in d) row.emotion = d.emotion;
  if ("sensitive" in d) row.sensitive = d.sensitive;
  if ("caption" in d) row.caption = d.caption;
  if ("hidden" in d) row.hidden = d.hidden;
  if ("lat" in d) row.lat = d.lat;
  if ("lng" in d) row.lng = d.lng;
  if ("processError" in d) row.process_error = d.processError;
  return row;
}

export async function uploadPhoto(blob, { source, uploader, uid } = {}) {
  const id =
    (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now() + "-" + Math.random().toString(16).slice(2);
  const ext = (blob.type && blob.type.split("/")[1]) || "jpg";
  const path = `${uid}/${id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { error } = await supabase.from(TABLE).insert({
    uid,
    url: pub.publicUrl,
    storage_path: path,
    source: source || "gallery",
    uploader: uploader || "anonymous",
    processed: false,
  });
  if (error) throw error;
}

export function subscribePhotos(uid, cb) {
  async function load() { cb(await loadPhotoRows(uid)); }
  load();
  const reload = debounce(load, 1500);
  const channel = supabase
    .channel("photos-" + uid)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `uid=eq.${uid}` },
      () => reload()
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export async function savePhotoAI(id, data) {
  const { error } = await supabase.from(TABLE).update(aiToRow(data)).eq("id", id);
  if (error) throw error;
}

export async function semanticSearch(embedding, count = 60) {
  const vec = "[" + embedding.join(",") + "]";
  const { data, error } = await supabase.rpc("match_photos", {
    query_embedding: vec,
    match_count: count,
  });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    url: r.url,
    category: r.category,
    ocrText: r.ocr_text,
    isBlurry: r.is_blurry,
    score: r.similarity,
  }));
}

// ---- People (named face clusters) ----
export async function getPeople(uid) {
  const { data } = await supabase.from("people").select("*").eq("uid", uid);
  return (data || []).map((p) => ({ id: p.id, name: p.name, centroid: p.centroid }));
}
export async function savePerson(uid, name, centroid) {
  const { error } = await supabase.from("people").insert({ uid, name, centroid });
  if (error) throw error;
}

// ---- Smart albums (saved searches) ----
export async function getAlbums(uid) {
  const { data } = await supabase
    .from("albums")
    .select("*")
    .eq("uid", uid)
    .order("created_at", { ascending: false });
  return (data || []).map((a) => ({ id: a.id, name: a.name, query: a.query }));
}
export async function saveAlbum(uid, name, query) {
  const { error } = await supabase.from("albums").insert({ uid, name, query });
  if (error) throw error;
}
export async function deleteAlbum(id) {
  await supabase.from("albums").delete().eq("id", id);
}

// ---- Admin actions ----
export async function reprocessAllPhotos(uid) {
  const { error } = await supabase.from(TABLE).update({ processed: false }).eq("uid", uid);
  if (error) throw error;
}
export async function deletePhoto(id, storagePath) {
  if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]);
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}
export async function deleteAllPhotos(uid, photos) {
  const paths = photos.map((p) => p.storagePath).filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  const { error } = await supabase.from(TABLE).delete().eq("uid", uid);
  if (error) throw error;
}

// ---- Profiles / roles (admin dashboard) ----
export async function upsertProfile(uid, email) {
  await supabase
    .from("profiles")
    .upsert({ uid, email, last_seen: new Date().toISOString() }, { onConflict: "uid" });
}
export async function getMyRole(uid) {
  const { data } = await supabase.from("profiles").select("role").eq("uid", uid).maybeSingle();
  return (data && data.role) || "cameraman";
}
export async function getCameramen() {
  const { data } = await supabase
    .from("profiles")
    .select("uid,email,role,last_seen")
    .order("last_seen", { ascending: false });
  return data || [];
}
// Admin: subscribe to ALL photos across every cameraman (RLS allows admin).
export function subscribeAllPhotos(cb) {
  async function load() { cb(await loadPhotoRows(null)); }
  load();
  const reload = debounce(load, 1500);
  const channel = supabase
    .channel("photos-all")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => reload())
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---- Dashboard: moderation, roles, guest analytics ----
export async function setPhotoHidden(id, hidden) {
  const { error } = await supabase.from(TABLE).update({ hidden }).eq("id", id);
  if (error) throw error;
}
export async function setUserRole(uid, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("uid", uid);
  if (error) throw error;
}
export async function getGuestStats() {
  const { data } = await supabase.from("guest_scans").select("matches");
  const scans = (data || []).length;
  const served = (data || []).reduce((a, r) => a + (r.matches || 0), 0);
  return { scans, served };
}
export async function reprocessAllPool() {
  const { error } = await supabase.from(TABLE).update({ processed: false }).not("id", "is", null);
  if (error) throw error;
}
export async function reprocessFailed() {
  const { error } = await supabase
    .from(TABLE)
    .update({ processed: false, process_error: null })
    .not("process_error", "is", null);
  if (error) throw error;
}
export async function getWatchers() {
  const { data } = await supabase
    .from("watchers")
    .select("id,email,created_at")
    .order("created_at", { ascending: false });
  return data || [];
}
export async function runAlertsNow() {
  const { data, error } = await supabase.functions.invoke("notify-watchers", { body: {} });
  if (error) throw error;
  return data || {};
}
