// Admin utilities: ZIP download, CSV/JSON export. JSZip is loaded from the CDN.
async function jszip() {
  const m = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  return m.default || m;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Download every photo, foldered by category, as one ZIP.
export async function downloadAllZip(photos, onProgress) {
  const JSZip = await jszip();
  const zip = new JSZip();
  let n = 0;
  for (const p of photos) {
    try {
      const res = await fetch(p.url);
      const blob = await res.blob();
      const ext = (blob.type && blob.type.split("/")[1]) || "jpg";
      const cat = (p.category || "Uncategorized").replace(/[^a-z0-9]/gi, "_");
      zip.file(`${cat}/${p.id}.${ext}`, blob);
    } catch { /* skip unreachable */ }
    onProgress && onProgress(++n, photos.length);
  }
  const out = await zip.generateAsync({ type: "blob" });
  triggerDownload(out, "ai-photo-sorter-export.zip");
}

export function exportJson(photos) {
  // drop the big numeric arrays so the file stays readable
  const clean = photos.map(({ embedding, faces, ...rest }) => rest);
  triggerDownload(
    new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }),
    "metadata.json"
  );
}

export function exportCsv(photos) {
  const cols = ["id", "category", "emotion", "caption", "faceCount", "blurScore",
    "brightness", "isBlurry", "sensitive", "uploader", "source", "ocrText", "createdAt", "url"];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const rows = [cols.join(",")];
  for (const p of photos) rows.push(cols.map((c) => esc(p[c])).join(","));
  triggerDownload(new Blob([rows.join("\n")], { type: "text/csv" }), "metadata.csv");
}

// Download one photo (original file).
export async function downloadPhoto(p) {
  const res = await fetch(p.url);
  const blob = await res.blob();
  const ext = (blob.type && blob.type.split("/")[1]) || "jpg";
  const cat = (p.category || "photo").replace(/[^a-z0-9]/gi, "_");
  triggerDownload(blob, `${cat}-${p.id}.${ext}`);
}

// ---- Watermark + Best-of PDF (CDN-loaded jsPDF) ----
const JSPDF_CDN = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";

function loadImg(url) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
}

async function watermarkBlob(url, text) {
  const img = await loadImg(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const fs = Math.max(18, Math.round(canvas.width * 0.03));
  ctx.font = `bold ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  const t = text || "AI Photo Sorter";
  const w = ctx.measureText(t).width;
  const pad = fs * 0.5;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(canvas.width - w - pad * 3, canvas.height - fs - pad * 2, w + pad * 2, fs + pad * 1.5);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(t, canvas.width - w - pad * 2, canvas.height - pad);
  return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
}

export async function downloadWatermarked(p, text) {
  const blob = await watermarkBlob(p.url, text);
  triggerDownload(blob, `wm-${p.id}.jpg`);
}

export async function downloadAllZipWatermarked(photos, text, onProgress) {
  const JSZip = await jszip();
  const zip = new JSZip();
  let n = 0;
  for (const p of photos) {
    try {
      const blob = await watermarkBlob(p.url, text);
      const cat = (p.category || "Uncategorized").replace(/[^a-z0-9]/gi, "_");
      zip.file(`${cat}/${p.id}.jpg`, blob);
    } catch (e) {}
    onProgress && onProgress(++n, photos.length);
  }
  triggerDownload(await zip.generateAsync({ type: "blob" }), "event-watermarked.zip");
}

export async function bestOfPdf(photos, title, onProgress) {
  const mod = await import(/* @vite-ignore */ JSPDF_CDN);
  const JsPDF = mod.jsPDF || mod.default;
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFontSize(28);
  doc.text(title || "Best of the Event", W / 2, H / 2 - 10, { align: "center" });
  doc.setFontSize(13);
  doc.text(`${photos.length} highlights`, W / 2, H / 2 + 18, { align: "center" });

  const margin = 28, gap = 12, cols = 2;
  const cw = (W - margin * 2 - gap * (cols - 1)) / cols;
  const ch = cw * 0.72;
  let placed = 0;
  for (const p of photos) {
    if (placed % 6 === 0) doc.addPage();
    const idx = placed % 6;
    const x = margin + (idx % cols) * (cw + gap);
    const y = margin + Math.floor(idx / cols) * (ch + gap);
    try {
      const img = await loadImg(p.url);
      const c = document.createElement("canvas");
      c.width = 900; c.height = Math.round(900 * img.naturalHeight / img.naturalWidth);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      doc.addImage(c.toDataURL("image/jpeg", 0.8), "JPEG", x, y, cw, ch, undefined, "FAST");
    } catch (e) {}
    placed++;
    onProgress && onProgress(placed, photos.length);
  }
  doc.save("best-of-event.pdf");
}
