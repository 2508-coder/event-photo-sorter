// Anonymous guest access: fetch all photos' face data via the public RPC.
import { supabase } from "../supabase.js";

export async function fetchAllFacePhotos() {
  const { data, error } = await supabase.rpc("all_face_photos");
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id, url: r.url, faces: r.faces,
    category: r.category, caption: r.caption, createdAt: r.created_at,
  }));
}

// Log an anonymous scan (count of matches) for admin analytics.
export async function logGuestScan(matches) {
  try { await supabase.from("guest_scans").insert({ matches }); } catch (e) {}
}

// "Tag me" — guest leaves an email + their face so they can be notified later.
export async function addWatcher(email, descriptor) {
  const { error } = await supabase.from("watchers").insert({ email, descriptor });
  if (error) throw error;
}
