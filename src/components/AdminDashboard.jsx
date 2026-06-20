import { useEffect, useMemo, useRef, useState } from "react";
import { downloadAllZip, downloadPhoto, downloadAllZipWatermarked, bestOfPdf } from "../lib/admin.js";
import {
  setPhotoHidden, setUserRole, getGuestStats, deletePhoto, deleteAllPhotos,
  reprocessAllPool, reprocessFailed, getWatchers, runAlertsNow,
} from "../lib/store.js";
import { hammingHex, DUP_HAMMING } from "../ai/quality.js";
import { showToast } from "../lib/toast.js";

const QR_CDN = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm";

function Bars({ data, color = "var(--accent)" }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="empty">No data yet.</div>;
  return (
    <div className="chart-bars">
      {data.map((d, i) => (
        <div className="cb-col" key={i} title={`${d.label}: ${d.value}`}>
          <div className="cb-bar" style={{ height: `${(d.value / max) * 100}%`, background: color }} />
          <span className="cb-lbl">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function MiniCard({ p, onHide, onDel }) {
  return (
    <div className="card">
      {p.hidden ? <span className="badge warn">hidden</span> : null}
      <img src={p.url} loading="lazy" alt="" />
      <div className="actions">
        <button title={p.hidden ? "Show to guests" : "Hide from guests"} onClick={() => onHide(p)}>{p.hidden ? "👁" : "🙈"}</button>
        <button title="Download" onClick={() => downloadPhoto(p)}>⬇️</button>
        <button title="Delete" onClick={() => onDel(p)}>🗑️</button>
      </div>
    </div>
  );
}

export default function AdminDashboard({ photos, cameramen, onChanged }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState(null);          // selected cameraman uid
  const [guest, setGuest] = useState({ scans: 0, served: 0 });
  const [watchers, setWatchers] = useState([]);
  const [wm, setWm] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("wmText")) || "");
  const qrRef = useRef(null);

  const guestUrl = (typeof window !== "undefined" ? window.location.origin : "") + "/guest.html";

  useEffect(() => { getGuestStats().then(setGuest).catch(() => {}); }, [photos]);
  useEffect(() => { getWatchers().then(setWatchers).catch(() => {}); }, [photos]);
  async function runAlerts() {
    setBusy("alerts"); setMsg("Running alerts…");
    try { const r = await runAlertsNow(); setMsg("✓ Alerts run — emailed " + ((r && r.emailed) || 0) + " guest(s)."); }
    catch (e) { setMsg("Alerts function not deployed yet (or failed): " + e.message); }
    finally { setBusy(""); }
  }
  useEffect(() => {
    (async () => {
      try {
        const m = await import(/* @vite-ignore */ QR_CDN);
        const QR = m.default || m;
        if (qrRef.current) await QR.toCanvas(qrRef.current, guestUrl, { width: 190, margin: 2, color: { dark: "#08130d", light: "#ffffff" } });
      } catch (e) {}
    })();
  }, [guestUrl]);

  const processed = photos.filter((p) => p.processed).length;
  const pending = photos.filter((p) => !p.processed).length;
  const failed = photos.filter((p) => p.processError).length;
  const hidden = photos.filter((p) => p.hidden).length;
  const blurry = photos.filter((p) => p.isBlurry).length;

  const byDay = useMemo(() => {
    const m = {};
    for (const p of photos) { const d = (p.createdAt || "").slice(0, 10); if (d) m[d] = (m[d] || 0) + 1; }
    return Object.keys(m).sort().slice(-14).map((d) => ({ label: d.slice(5), value: m[d] }));
  }, [photos]);
  const byCat = useMemo(() => {
    const m = {}; for (const p of photos) if (p.category) m[p.category] = (m[p.category] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [photos]);
  const byEmotion = useMemo(() => {
    const m = {}; for (const p of photos) if (p.emotion) m[p.emotion] = (m[p.emotion] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [photos]);

  const camStats = useMemo(() => {
    const m = {}; for (const p of photos) m[p.uid] = (m[p.uid] || 0) + 1;
    return cameramen.map((c) => ({ ...c, count: m[c.uid] || 0 })).sort((a, b) => b.count - a.count);
  }, [photos, cameramen]);

  const dupGroups = useMemo(() => {
    const wh = photos.filter((p) => p.phash);
    const used = new Set(); const groups = [];
    for (let i = 0; i < wh.length; i++) {
      if (used.has(wh[i].id)) continue;
      const g = [wh[i]]; used.add(wh[i].id);
      for (let j = i + 1; j < wh.length; j++) {
        if (used.has(wh[j].id)) continue;
        if (hammingHex(wh[i].phash, wh[j].phash) <= DUP_HAMMING) { g.push(wh[j]); used.add(wh[j].id); }
      }
      if (g.length > 1) groups.push(g);
    }
    return groups;
  }, [photos]);
  const dupReclaimable = dupGroups.reduce((a, g) => a + g.length - 1, 0);

  const moderation = useMemo(() => photos.filter((p) => p.sensitive || p.hidden), [photos]);
  const selPhotos = useMemo(() => (sel ? photos.filter((p) => p.uid === sel) : []), [sel, photos]);
  const highlights = useMemo(() => {
    const good = photos.filter((p) => p.processed && !p.isBlurry);
    const byCat = {};
    for (const p of good) { const c = p.category || "Other"; if (!byCat[c] || (p.blurScore || 0) > (byCat[c].blurScore || 0)) byCat[c] = p; }
    let picks = Object.values(byCat);
    const ids = new Set(picks.map((p) => p.id));
    const rest = good.filter((p) => !ids.has(p.id)).sort((a, b) => (b.blurScore || 0) - (a.blurScore || 0));
    return picks.concat(rest).slice(0, 18);
  }, [photos]);

  async function run(label, fn) {
    setBusy(label); setMsg("");
    try { await fn(); setMsg("✓ Done."); showToast("✓ Done", "success"); onChanged && onChanged(); }
    catch (e) { setMsg("Failed: " + e.message); showToast("❌ " + e.message, "error"); }
    finally { setBusy(""); }
  }

  async function toggleHide(p) { await run("hide", () => setPhotoHidden(p.id, !p.hidden)); }
  async function delOne(p) { if (window.confirm("Delete this photo permanently?")) await run("del", () => deletePhoto(p.id, p.storagePath)); }
  async function delCameraman(c) {
    if (!window.confirm(`Delete ALL ${c.count} photos from ${c.email}?`)) return;
    await run("delcam", () => deleteAllPhotos(c.uid, photos.filter((p) => p.uid === c.uid)));
  }
  async function toggleRole(c) {
    const next = c.role === "admin" ? "cameraman" : "admin";
    if (!window.confirm(`Make ${c.email} a ${next}?`)) return;
    await run("role", () => setUserRole(c.uid, next));
  }
  async function deleteDupes() {
    if (!window.confirm(`Delete ${dupReclaimable} duplicate photo(s), keeping the sharpest in each set?`)) return;
    await run("dupes", async () => {
      for (const g of dupGroups) {
        const best = g.reduce((b, p) => ((p.blurScore || 0) > (b.blurScore || -1) ? p : b), g[0]);
        for (const p of g) if (p.id !== best.id) await deletePhoto(p.id, p.storagePath);
      }
    });
  }
  async function deleteBlurry() {
    if (!window.confirm(`Delete all ${blurry} blurry photo(s)?`)) return;
    await run("blur", async () => { for (const p of photos) if (p.isBlurry) await deletePhoto(p.id, p.storagePath); });
  }

  return (
    <div className="dash">
      <div className="admin-grid">
        <div className="acard"><b>{photos.length}</b><span>photos</span></div>
        <div className="acard"><b>{processed}</b><span>processed</span></div>
        <div className="acard"><b>{pending}</b><span>pending</span></div>
        <div className="acard"><b>{failed}</b><span>failed</span></div>
        <div className="acard"><b>{cameramen.filter((c) => c.role !== "admin").length}</b><span>cameramen</span></div>
        <div className="acard"><b>{hidden}</b><span>hidden</span></div>
        <div className="acard"><b>{guest.scans}</b><span>guest scans</span></div>
        <div className="acard"><b>{guest.served}</b><span>photos served</span></div>
      </div>

      <div className="dash-charts">
        <div className="panel"><h4>Uploads (last 14 days)</h4><Bars data={byDay} color="var(--accent2)" /></div>
        <div className="panel"><h4>Categories</h4><Bars data={byCat} /></div>
        <div className="panel"><h4>Emotions</h4><Bars data={byEmotion} color="#e8b54a" /></div>
      </div>

      <h3 className="subh">Cameramen</h3>
      <table className="cmtable">
        <thead><tr><th>Email</th><th>Role</th><th>Photos</th><th>Last seen</th><th>Actions</th></tr></thead>
        <tbody>
          {camStats.map((c) => (
            <tr key={c.uid}>
              <td>{c.email}</td>
              <td>{c.role === "admin" ? "👑 admin" : "📷 cameraman"}</td>
              <td>{c.count}</td>
              <td>{c.last_seen ? new Date(c.last_seen).toLocaleString() : "—"}</td>
              <td className="cm-actions">
                <button onClick={() => setSel(sel === c.uid ? null : c.uid)}>{sel === c.uid ? "Hide" : "View"}</button>
                <button onClick={() => toggleRole(c)} disabled={!!busy}>{c.role === "admin" ? "Demote" : "Promote"}</button>
                <button className="danger" onClick={() => delCameraman(c)} disabled={!!busy || !c.count}>Delete all</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sel && (
        <div className="panel">
          <h4>{selPhotos.length} photo(s) from this cameraman</h4>
          <div className="grid">{selPhotos.map((p) => <MiniCard key={p.id} p={p} onHide={toggleHide} onDel={delOne} />)}</div>
        </div>
      )}

      <h3 className="subh">Processing</h3>
      <div className="admin-actions">
        <button onClick={() => run("rf", reprocessFailed)} disabled={!!busy || !failed}>🔁 Reprocess failed ({failed})</button>
        <button onClick={() => run("ra", reprocessAllPool)} disabled={!!busy || !photos.length}>🔄 Reprocess everything</button>
      </div>

      <h3 className="subh">Cleanup</h3>
      <div className="admin-actions">
        <button onClick={deleteDupes} disabled={!!busy || !dupReclaimable}>🧹 Delete duplicates, keep best ({dupReclaimable})</button>
        <button className="danger" onClick={deleteBlurry} disabled={!!busy || !blurry}>🗑️ Delete blurry ({blurry})</button>
        <button onClick={() => run("zip", () => downloadAllZip(photos))} disabled={!!busy || !photos.length}>⬇️ Download whole event (ZIP)</button>
      </div>

      <h3 className="subh">Moderation ({moderation.length} flagged/hidden)</h3>
      {moderation.length
        ? <div className="grid">{moderation.map((p) => <MiniCard key={p.id} p={p} onHide={toggleHide} onDel={delOne} />)}</div>
        : <div className="empty">Nothing flagged. 👍</div>}

      <h3 className="subh">Branding &amp; exports</h3>
      <div className="panel">
        <div className="brand-row">
          <input placeholder="Watermark / event name (e.g. TechFest 2026)" value={wm}
                 onChange={(e) => { setWm(e.target.value); try { localStorage.setItem("wmText", e.target.value); } catch (x) {} }} />
        </div>
        <div className="admin-actions" style={{ marginTop: 10 }}>
          <button onClick={() => run("wmzip", () => downloadAllZipWatermarked(photos, wm, (n, t) => setMsg(`Watermarking ${n}/${t}…`)))} disabled={!!busy || !photos.length}>🏷️ Download event — watermarked ZIP</button>
          <button onClick={() => run("pdf", () => bestOfPdf(highlights, wm || "Best of the Event", (n, t) => setMsg(`Building PDF ${n}/${t}…`)))} disabled={!!busy || !highlights.length}>📄 Best-of PDF ({highlights.length})</button>
        </div>
      </div>

      <div className="dash-bottom">
        <div className="panel qr-panel">
          <h4>Guest QR &amp; link</h4>
          <canvas ref={qrRef} className="qr-canvas" />
          <div className="qr-link">{guestUrl}</div>
          <button onClick={() => navigator.clipboard && navigator.clipboard.writeText(guestUrl)}>📋 Copy guest link</button>
        </div>
        <div className="panel">
          <h4>Guest activity</h4>
          <p className="big-stat"><b>{guest.scans}</b> face scans</p>
          <p className="big-stat"><b>{guest.served}</b> photos delivered to guests</p>
        </div>
      </div>

      <h3 className="subh">Tag-me watchers ({watchers.length})</h3>
      <div className="panel">
        <div className="note" style={{ marginBottom: 10 }}>🔔 Alerts are sent automatically by the Gmail emailer (Apps Script, every 15 min). No button needed.</div>
        {watchers.length ? (
          <table className="cmtable">
            <thead><tr><th>Email</th><th>Subscribed</th></tr></thead>
            <tbody>{watchers.map((w) => (<tr key={w.id}><td>{w.email}</td><td>{new Date(w.created_at).toLocaleString()}</td></tr>))}</tbody>
          </table>
        ) : <div className="empty">No guests have subscribed for alerts yet.</div>}
      </div>

      {(busy || msg) && <div className="status">{busy ? "Working…" : msg}</div>}
    </div>
  );
}
