import { useEffect, useRef, useState } from "react";
import { detectFaces, descriptorDistance, meanDescriptor, MATCH_THRESHOLD } from "./ai/faces.js";
import { fetchAllFacePhotos, logGuestScan, addWatcher } from "./lib/guest.js";
import { showToast } from "./lib/toast.js";
import { downloadPhoto, downloadAllZip } from "./lib/admin.js";

// Match cutoff comes from faces.js (auto-matches the active engine).
const THRESHOLD = MATCH_THRESHOLD;
// Quality gate: reject weak detections that cause false matches.
const MIN_SCORE = 0.6;   // detection confidence
const MIN_SIZE = 90;     // face box min side, px
// Pick the best (largest, confident) face from a detection list.
function bestFace(faces) {
  return (faces || [])
    .filter((f) => f.score >= MIN_SCORE && f.size >= MIN_SIZE)
    .sort((a, b) => b.size - a.size)[0] || null;
}

export default function GuestApp() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [mode, setMode] = useState("camera");
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState("");
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastDesc, setLastDesc] = useState(null);
  const [email, setEmail] = useState("");
  const [notifyMsg, setNotifyMsg] = useState("");

  async function startCam() {
    stopCam();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      setOn(true); setStatus("");
    } catch (e) { setStatus("Camera error: " + e.message + " (allow camera; needs HTTPS)"); }
  }
  function stopCam() { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setOn(false); }
  useEffect(() => () => stopCam(), []);

  async function notifyMe() {
    if (!email.trim() || !lastDesc) return;
    setNotifyMsg("Saving…");
    try { await addWatcher(email.trim(), lastDesc); setNotifyMsg("✓ Done! We\u2019ll email you when new photos of you are posted."); setEmail(""); }
    catch (e) { setNotifyMsg("Failed: " + e.message); }
  }

  async function runMatch(descriptor) {
    setLastDesc(descriptor);
    setBusy(true); setStatus("Searching all event photos…");
    try {
      const all = await fetchAllFacePhotos();
      const out = [];
      for (const p of all) {
        let best = Infinity;
        for (const f of (p.faces || [])) { const d = descriptorDistance(descriptor, f.v); if (d < best) best = d; }
        if (best < THRESHOLD) out.push({ ...p, score: 1 - best });
      }
      out.sort((a, b) => b.score - a.score);
      logGuestScan(out.length);
      setMatches(out);
      setStatus(out.length ? `🎉 Found you in ${out.length} photo(s)!` : "No photos of you found yet — try a clearer scan or check back later.");
    } catch (e) { setStatus("Error: " + e.message); }
    finally { setBusy(false); }
  }

  // Single image (file upload): require one clear, front-facing face.
  async function scanEl(el) {
    setStatus("Scanning your face…");
    let faces = [];
    try { faces = await detectFaces(el); } catch (e) { setStatus("Face model error: " + e.message); return; }
    const good = bestFace(faces);
    if (!good) { setStatus("No clear face detected — use a sharp, front-facing close-up in good light."); return; }
    await runMatch(good.descriptor);
  }

  // Camera: capture several frames, keep the good ones, average them into a
  // stable reference. Multi-scan + quality gating is what removes false matches.
  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    const samples = [];
    for (let i = 0; i < 6 && samples.length < 4; i++) {
      setStatus(`Hold still — scanning ${samples.length}/4…`);
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      let faces = [];
      try { faces = await detectFaces(c); } catch (e) {}
      const good = bestFace(faces);
      if (good) samples.push(good.descriptor);
      await new Promise((r) => setTimeout(r, 350));
    }
    stopCam();
    if (!samples.length) {
      setBusy(false);
      setStatus("Couldn't get a clear face — face the camera straight on in good light and try again.");
      return;
    }
    await runMatch(meanDescriptor(samples));
  }
  function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => { await scanEl(img); URL.revokeObjectURL(url); };
    img.onerror = () => setStatus("Could not load that image.");
    img.src = url;
  }

  async function downloadAll() {
    if (!matches || !matches.length) return;
    setStatus("Zipping your photos…");
    try {
      await downloadAllZip(matches, (n, t) => setStatus(`Zipping ${n}/${t}…`));
      setStatus(`✓ Downloaded ${matches.length} photo(s).`);
    } catch (e) { setStatus("ZIP failed: " + e.message); }
  }

  const showScanner = matches === null || busy || matches.length === 0;

  return (
    <div className="guest">
      <div className="guest-hero">
        <img src="/logo.png" className="brand-logo" alt="Karnavati University SGC" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <h1>📸 Find Your Photos</h1>
        <p>Scan your face to instantly get every photo of you from the event.</p>
      </div>

      {showScanner && (
        <div className="guest-scan">
          <div className="seg">
            <button className={mode === "camera" ? "on" : ""} onClick={() => setMode("camera")}>📷 Camera</button>
            <button className={mode === "upload" ? "on" : ""} onClick={() => { stopCam(); setMode("upload"); }}>🖼️ Selfie</button>
          </div>
          {mode === "camera" ? (
            <div className="camera-card">
              <div className="camera-frame">
                <video ref={videoRef} autoPlay playsInline muted />
                {!on && <div className="camera-off">Camera off</div>}
              </div>
              <div className="camera-controls">
                {!on
                  ? <button className="primary" onClick={startCam}>Start camera</button>
                  : (<>
                      <button className="primary" onClick={capture} disabled={busy}>🔍 Find my photos</button>
                      <button onClick={stopCam}>Stop</button>
                    </>)}
              </div>
            </div>
          ) : (
            <label className="drop">
              <input type="file" accept="image/*" hidden onChange={onFile} />
              <span>🖼️ Upload a clear, front-facing selfie</span>
            </label>
          )}
          <div className="status">{status}</div>
        </div>
      )}

      {matches && matches.length > 0 && (
        <div className="guest-results">
          <div className="guest-resbar">
            <b>{status}</b>
            <span className="gr-btns">
              <button className="gr-zip" onClick={downloadAll}>⬇️ Download all</button>
              <button onClick={() => { setMatches(null); setStatus(""); }}>↺ Scan again</button>
            </span>
          </div>
          <div className="grid">
            {matches.map((p) => (
              <div className="card" key={p.id}>
                <img src={p.url} loading="lazy" alt="" />
                <div className="actions">
                  <button title="Download" onClick={() => downloadPhoto(p)}>⬇️</button>
                </div>
                {p.caption ? <div className="cap"><span>{p.caption}</span></div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {lastDesc && (
        <div className="guest-scan notify">
          <b>🔔 Get notified</b>
          <p className="gn-p">Leave your email and we\u2019ll alert you when new photos of you are posted.</p>
          <div className="gn-row">
            <input type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="primary" onClick={notifyMe}>Notify me</button>
          </div>
          <div className="status">{notifyMsg}</div>
        </div>
      )}
    </div>
  );
}
