import { useState } from "react";
import { uploadPhoto } from "../lib/store.js";
import { showToast } from "../lib/toast.js";

// Re-encode through a canvas -> strips ALL metadata (EXIF/GPS) and normalizes to
// JPEG. Falls back to the original if the browser can't decode it (e.g. HEIC).
function stripExif(file) {
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith("image/")) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        c.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob || file); }, "image/jpeg", 0.92);
      } catch (e) { URL.revokeObjectURL(url); resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export default function Uploader({ uploader, uid }) {
  const [status, setStatus] = useState("");

  async function onFiles(e) {
    const files = [...e.target.files];
    if (!files.length) return;
    let n = 0;
    for (const f of files) {
      setStatus(`Uploading ${++n}/${files.length}…`);
      try {
        const clean = await stripExif(f); // remove GPS/EXIF before it leaves the device
        await uploadPhoto(clean, { source: "gallery", uploader, uid });
      } catch (err) {
        setStatus("Upload failed: " + err.message);
        showToast("❌ Upload failed: " + err.message, "error");
        return;
      }
    }
    setStatus(`✓ Uploaded ${files.length}. AI processing runs in the Gallery.`);
    showToast(`📤 Uploaded ${files.length} photo(s)`, "success");
    e.target.value = "";
  }

  return (
    <div className="uploader-card">
      <label className="drop">
        <input type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <span>📁 Choose photos from this device</span>
      </label>
      <div className="status">{status}</div>
    </div>
  );
}
