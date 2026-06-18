import { useEffect, useRef, useState } from "react";
import { uploadPhoto } from "../lib/store.js";
import { showToast } from "../lib/toast.js";

// Live camera capture for the cameraman's phone. Opens the device camera,
// captures a frame, and uploads it straight to Firebase.
export default function CameraCapture({ uploader, uid }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [on, setOn] = useState(false);
  const [facing, setFacing] = useState("environment"); // rear camera by default
  const [status, setStatus] = useState("");

  async function start(facingMode = facing) {
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      setOn(true);
      setStatus("");
    } catch (e) {
      setStatus("Camera error: " + e.message + " (needs HTTPS or localhost)");
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }

  function flip() {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    if (on) start(next);
  }

  useEffect(() => () => stop(), []); // stop camera when leaving

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    setStatus("Uploading…");
    canvas.toBlob(
      async (blob) => {
        try {
          await uploadPhoto(blob, { source: "camera", uploader, uid });
          setStatus("✓ Uploaded! Appears in the gallery instantly.");
          showToast("📸 Photo uploaded", "success");
        } catch (e) {
          setStatus("Upload failed: " + e.message);
          showToast("❌ Upload failed: " + e.message, "error");
        }
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <div className="camera-card">
      <div className="camera-frame">
        <video ref={videoRef} autoPlay playsInline muted />
        {!on && <div className="camera-off">Camera is off</div>}
      </div>
      <div className="camera-controls">
        {!on ? (
          <button onClick={() => start()}>📷 Start camera</button>
        ) : (
          <>
            <button className="primary" onClick={capture}>⚪ Capture &amp; upload</button>
            <button onClick={flip}>🔄 Flip</button>
            <button onClick={stop}>⏹ Stop</button>
          </>
        )}
      </div>
      <div className="status">{status}</div>
    </div>
  );
}
