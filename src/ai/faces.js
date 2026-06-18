// Face detection + 128/1024-d descriptors + emotion, in-browser.
//
// Two engines, switchable with ONE word below:
//   'faceapi' = @vladmandic/face-api (128-d) — fast/light, best for bulk.
//   'human'   = @vladmandic/human (1024-d ArcFace-style) — more accurate.
//
// IMPORTANT: the two engines produce INCOMPATIBLE fingerprints. After changing
// ENGINE you MUST re-process every photo (`update public.photos set processed=false;`)
// so stored faces match new scans.

export const ENGINE = "faceapi";          // "faceapi" = fast/light (bulk); "human" = more accurate

// Engine-matched thresholds (euclidean distance; lower = stricter).
const CFG = {
  faceapi: { MATCH: 0.5, CLUSTER: 0.55 },
  human:   { MATCH: 0.9, CLUSTER: 0.95 },
};
export const MATCH_THRESHOLD = CFG[ENGINE].MATCH;
export const CLUSTER_THRESHOLD = CFG[ENGINE].CLUSTER;

// ---------- shared helpers ----------
function topExpression(exp) {
  let best = "neutral", bestV = -1;
  for (const k in exp) if (exp[k] > bestV) { bestV = exp[k]; best = k; }
  return best;
}
function l2normalize(v) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

// ============ face-api engine ============
const FACEAPI_CDN =
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.esm.js";
const FACEAPI_MODELS =
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";

let _faceapi = null;
async function getFaceApi() {
  if (_faceapi) return _faceapi;
  const mod = await import(/* @vite-ignore */ FACEAPI_CDN);
  _faceapi = mod.default || mod;
  return _faceapi;
}
let _faOK = false;
async function detectFaceApi(imgEl) {
  const faceapi = await getFaceApi();
  if (!_faOK) {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(FACEAPI_MODELS);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODELS);
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODELS);
    await faceapi.nets.faceExpressionNet.loadFromUri(FACEAPI_MODELS);
    _faOK = true;
  }
  const results = await faceapi
    .detectAllFaces(imgEl).withFaceLandmarks().withFaceDescriptors().withFaceExpressions();
  return results.map((r) => ({
    descriptor: Array.from(r.descriptor),
    emotion: topExpression(r.expressions),
    score: (r.detection && r.detection.score) || 1,
    size: r.detection && r.detection.box ? Math.min(r.detection.box.width, r.detection.box.height) : 0,
  }));
}

// ============ human engine ============
const HUMAN_CDN = "https://cdn.jsdelivr.net/npm/@vladmandic/human/dist/human.esm.js";
const HUMAN_MODELS = "https://cdn.jsdelivr.net/npm/@vladmandic/human/models/";
let _human = null;
async function getHuman() {
  if (_human) return _human;
  const mod = await import(/* @vite-ignore */ HUMAN_CDN);
  const Human = mod.Human || (mod.default && mod.default.Human) || mod.default;
  _human = new Human({
    modelBasePath: HUMAN_MODELS,
    cacheModels: true,
    face: {
      enabled: true,
      detector: { maxDetected: 20, minConfidence: 0.3, rotation: false },
      mesh: { enabled: true },
      description: { enabled: true },
      emotion: { enabled: true },
      iris: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false },
    },
    body: { enabled: false }, hand: { enabled: false },
    object: { enabled: false }, gesture: { enabled: false }, filter: { enabled: false },
  });
  await _human.load();
  return _human;
}
function topEmotionHuman(arr) {
  if (!arr || !arr.length) return "neutral";
  return arr.slice().sort((a, b) => b.score - a.score)[0].emotion;
}
async function detectHuman(imgEl) {
  const human = await getHuman();
  const res = await human.detect(imgEl);
  return (res.face || [])
    .filter((f) => Array.isArray(f.embedding) && f.embedding.length)
    .map((f) => ({
      descriptor: l2normalize(f.embedding),
      emotion: topEmotionHuman(f.emotion),
      score: f.faceScore || f.score || f.boxScore || 1,
      size: f.box ? Math.min(f.box[2], f.box[3]) : 0,
    }));
}

// ---------- public API (engine-agnostic) ----------
export async function loadFaceModels() {
  if (ENGINE === "human") await getHuman();
  else await getFaceApi();
}
export async function detectFaces(imgEl) {
  return ENGINE === "human" ? detectHuman(imgEl) : detectFaceApi(imgEl);
}

function euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
export function descriptorDistance(a, b) { return euclidean(a, b); }

export function clusterDescriptors(descriptors, threshold = CLUSTER_THRESHOLD) {
  const centroids = [];
  const labels = [];
  for (const d of descriptors) {
    let assigned = -1;
    for (let c = 0; c < centroids.length; c++) {
      const mean = centroids[c].sum.map((v) => v / centroids[c].count);
      if (euclidean(d, mean) < threshold) { assigned = c; break; }
    }
    if (assigned === -1) {
      centroids.push({ sum: d.slice(), count: 1 });
      labels.push(centroids.length - 1);
    } else {
      for (let i = 0; i < d.length; i++) centroids[assigned].sum[i] += d[i];
      centroids[assigned].count++;
      labels.push(assigned);
    }
  }
  return labels;
}

export function meanDescriptor(list) {
  if (!list.length) return [];
  const out = new Array(list[0].length).fill(0);
  for (const d of list) for (let i = 0; i < d.length; i++) out[i] += d[i];
  return out.map((v) => v / list.length);
}
