import { useState } from "react";
import { downloadAllZip, exportCsv, exportJson } from "../lib/admin.js";
import { reprocessAllPhotos, deleteAllPhotos } from "../lib/store.js";

export default function AdminPanel({ photos, user, peopleCount, albumCount }) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const byCat = {};
  for (const p of photos) { const c = p.category || "—"; byCat[c] = (byCat[c] || 0) + 1; }
  const processed = photos.filter((p) => p.processed).length;
  const sensitiveCount = photos.filter((p) => p.sensitive).length;

  async function zip() {
    setBusy("zip"); setStatus("Preparing ZIP…");
    try {
      await downloadAllZip(photos, (n, t) => setStatus(`Zipping ${n}/${t}…`));
      setStatus("Download started ✓");
    } catch (e) { setStatus("ZIP failed: " + e.message); }
    finally { setBusy(""); }
  }

  async function reprocess() {
    if (!window.confirm("Re-run the AI on all photos? They'll be re-analyzed one by one.")) return;
    setBusy("re"); setStatus("Re-queuing…");
    try { await reprocessAllPhotos(user.uid); setStatus("All photos queued for reprocessing ✓"); }
    catch (e) { setStatus("Failed: " + e.message); }
    finally { setBusy(""); }
  }

  async function wipe() {
    if (!window.confirm("Delete ALL your photos permanently? This cannot be undone.")) return;
    if (!window.confirm("Are you absolutely sure? Everything will be erased.")) return;
    setBusy("del"); setStatus("Deleting…");
    try { await deleteAllPhotos(user.uid, photos); setStatus("All photos deleted."); }
    catch (e) { setStatus("Failed: " + e.message); }
    finally { setBusy(""); }
  }

  return (
    <div className="admin">
      <div className="admin-grid">
        <div className="acard"><b>{photos.length}</b><span>photos</span></div>
        <div className="acard"><b>{processed}</b><span>processed</span></div>
        <div className="acard"><b>{Object.keys(byCat).length}</b><span>categories</span></div>
        <div className="acard"><b>{sensitiveCount}</b><span>sensitive</span></div>
        <div className="acard"><b>{peopleCount}</b><span>people</span></div>
        <div className="acard"><b>{albumCount}</b><span>albums</span></div>
      </div>

      <h3 className="subh">Download &amp; export</h3>
      <div className="admin-actions">
        <button onClick={zip} disabled={!!busy || !photos.length}>⬇️ Download all photos (ZIP)</button>
        <button onClick={() => exportCsv(photos)} disabled={!photos.length}>📄 Export metadata (CSV)</button>
        <button onClick={() => exportJson(photos)} disabled={!photos.length}>🧾 Export metadata (JSON)</button>
      </div>

      <h3 className="subh">Maintenance</h3>
      <div className="admin-actions">
        <button onClick={reprocess} disabled={!!busy || !photos.length}>🔄 Re-run AI on all photos</button>
      </div>

      <h3 className="subh danger-h">Danger zone</h3>
      <div className="admin-actions">
        <button className="danger" onClick={wipe} disabled={!!busy || !photos.length}>🗑️ Delete ALL photos</button>
      </div>

      <div className="admin-cat">
        {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
          <span className="chip" key={c}>{c}: <b>{n}</b></span>
        ))}
      </div>

      {status && <div className="status">{status}</div>}
    </div>
  );
}
