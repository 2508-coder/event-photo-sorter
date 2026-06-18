import { useEffect, useRef, useState } from "react";
import { detectFaces } from "../ai/faces.js";

// Capture a face (live camera or uploaded selfie), get its 128-d descriptor,
// and hand it back to App which matches it against every stored photo face.
export default function FindMe({ onScan }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [mode, setMode] = useState("camera");
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState("");

  async function startCam() {
    stopCam();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      setOn(true); setStatus("");
    } catch (e) { setStatus("Camera error: " + e.message + " (needs HTTPS or localhost)"); }
  }
  function stopCam() { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setOn(false); }
  useEffect(() => () => stopCam(), []);

  async function scanElement(el) {
    setStatus("Scanning your face…");
    let faces = [];
    try { faces = await detectFaces(el); }
    catch (e) { setStatus("Face model error: " + e.message); return; }
    if (!faces.length) { setStatus("No face detected — face the camera in good light and try again."); return; }
    onScan(faces[0].descriptor);
    setStatus("✓ Face captured — matching your photos…");
  }

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    await scanElement(c);
  }

  function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => { await scanElement(img); URL.revokeObjectURL(url); };
    img.onerror = () => setStatus("Could not load that image.");
    img.src = url;
  }

  return (
    <div className="findme">
      <div className="seg">
        <button className={mode === "camera" ? "on" : ""} onClick={() => setMode("camera")}>📷 Scan with camera</button>
        <button className={mode === "upload" ? "on" : ""} onClick={() => { stopCam(); setMode("upload"); }}>🖼️ Upload a selfie</button>
      </div>
      {mode === "camera" ? (
        <div className="camera-card">
          <div className="camera-frame">
            <video ref={videoRef} autoPlay playsInline muted />
            {!on && <div className="camera-off">Camera is off</div>}
          </div>
          <div className="camera-controls">
            {!on
              ? <button onClick={startCam}>Start camera</button>
              : (<>
                  <button className="primary" onClick={capture}>🔍 Scan my face</button>
                  <button onClick={stopCam}>Stop</button>
                </>)}
          </div>
        </div>
      ) : (
        <label className="drop">
          <input type="file" accept="image/*" hidden onChange={onFile} />
          <span>🖼️ Choose a clear, front-facing selfie</span>
        </label>
      )}
      <div className="status">{status}</div>
    </div>
  );
}
