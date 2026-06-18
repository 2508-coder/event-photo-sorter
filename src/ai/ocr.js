// OCR with Tesseract.js — runs in the browser. A single worker is reused.
import { createWorker } from "tesseract.js";

let _worker, _loading;

async function getWorker() {
  if (_worker) return _worker;
  if (_loading) return _loading;
  _loading = createWorker("eng").then((w) => {
    _worker = w;
    return w;
  });
  return _loading;
}

// Accepts an HTMLImageElement, canvas, or image URL. Returns trimmed text.
export async function extractText(image) {
  const worker = await getWorker();
  const {
    data: { text },
  } = await worker.recognize(image);
  // Cap length so the Firestore doc stays small.
  return (text || "").trim().slice(0, 5000);
}
