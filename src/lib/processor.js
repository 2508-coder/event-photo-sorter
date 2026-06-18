// Full in-browser AI pipeline for one photo.
import { embedImage, categorize } from "../ai/clip.js";
import { detectFaces } from "../ai/faces.js";
import { analyzeQuality, loadImageEl } from "../ai/quality.js";
import { extractText } from "../ai/ocr.js";
import { makeCaption } from "../ai/caption.js";

const OCR_CATEGORIES = new Set(["Documents", "Screenshots"]);
const EXIFR_CDN = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs";

async function extractGps(url) {
  try {
    const mod = await import(/* @vite-ignore */ EXIFR_CDN);
    const exifr = mod.default || mod;
    const res = await fetch(url);
    const blob = await res.blob();
    const gps = await exifr.gps(blob);
    if (gps && isFinite(gps.latitude) && isFinite(gps.longitude)) return { lat: gps.latitude, lng: gps.longitude };
  } catch (e) {}
  return { lat: null, lng: null };
}

function dominantEmotion(list) {
  if (!list.length) return null;
  const c = {};
  for (const e of list) c[e] = (c[e] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}

export async function processPhoto(photo, onStatus) {
  onStatus?.("Embedding with CLIP…");
  const embedding = await embedImage(photo.url);
  const { category } = await categorize(embedding);

  onStatus?.("Quality + lighting…");
  const imgEl = await loadImageEl(photo.url);
  const { blurScore, isBlurry, brightness, phash } = analyzeQuality(imgEl);

  onStatus?.("Faces + emotion…");
  let faceResults = [];
  try { faceResults = await detectFaces(imgEl); } catch { faceResults = []; }
  const descriptors = faceResults.map((f) => f.descriptor);
  const emotion = dominantEmotion(faceResults.map((f) => f.emotion));

  let ocrText = "";
  if (OCR_CATEGORIES.has(category)) {
    onStatus?.("Reading text (OCR)…");
    try { ocrText = await extractText(imgEl); } catch { ocrText = ""; }
  }

  const sensitive =
    OCR_CATEGORIES.has(category) ||
    (!!ocrText && ocrText.replace(/\s/g, "").length > 12);
  const caption = makeCaption({ category, faceCount: descriptors.length, emotion });
  const { lat, lng } = await extractGps(photo.url);

  return {
    processed: true,
    embedding,
    category,
    blurScore: Math.round(blurScore * 10) / 10,
    isBlurry,
    brightness: Math.round(brightness),
    phash,
    ocrText,
    emotion,
    sensitive,
    caption,
    lat,
    lng,
    faces: descriptors.map((d) => ({ v: d })),
    faceCount: descriptors.length,
  };
}
