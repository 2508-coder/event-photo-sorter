// CLIP via transformers.js, loaded from the CDN at runtime. This bypasses Vite's
// bundling of onnxruntime-web (the cause of the "registerBackend" crash): the CDN
// build ships a self-contained, working onnxruntime and loads its wasm from the CDN.
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const MODEL = "Xenova/clip-vit-base-patch32";

let _mod, _tokenizer, _textModel, _processor, _visionModel, _loading;

async function lib() {
  if (!_mod) {
    _mod = await import(/* @vite-ignore */ TRANSFORMERS_CDN);
    _mod.env.allowLocalModels = false;
  }
  return _mod;
}

export function loadClip(onStatus) {
  if (_visionModel) return Promise.resolve();
  if (_loading) return _loading;
  _loading = (async () => {
    const t = await lib();
    onStatus?.("Loading CLIP (one-time ~250MB download)…");
    _tokenizer = await t.AutoTokenizer.from_pretrained(MODEL);
    _textModel = await t.CLIPTextModelWithProjection.from_pretrained(MODEL);
    _processor = await t.AutoProcessor.from_pretrained(MODEL);
    _visionModel = await t.CLIPVisionModelWithProjection.from_pretrained(MODEL);
    onStatus?.("AI ready");
  })();
  return _loading;
}

function l2(arr) {
  let s = 0;
  for (const v of arr) s += v * v;
  s = Math.sqrt(s) || 1;
  return arr.map((v) => v / s);
}

export async function embedImage(url) {
  await loadClip();
  const t = await lib();
  const image = await t.RawImage.read(url);
  const inputs = await _processor(image);
  const { image_embeds } = await _visionModel(inputs);
  return l2(Array.from(image_embeds.data));
}

export async function embedText(text) {
  await loadClip();
  const inputs = _tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await _textModel(inputs);
  return l2(Array.from(text_embeds.data));
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export const CATEGORIES = {
  Lecture: "a photo of a classroom lecture or students in class",
  "Lab Work": "a photo of a science or computer laboratory",
  Graduation: "a photo of a graduation ceremony with gowns and caps",
  Campus: "a photo of a university campus or college building",
  Sports: "a photo of a sports event, game or athletics",
  Fest: "a photo of a college festival, concert or celebration",
  People: "a photo of one or more people",
  Food: "a photo of food or a meal",
  Documents: "a scan or photo of a document, text or receipt",
  Screenshots: "a screenshot of a phone or computer screen",
  Other: "a random uncategorized photo",
};

let _catEmbeds = null;
async function categoryEmbeds() {
  if (_catEmbeds) return _catEmbeds;
  const names = Object.keys(CATEGORIES);
  const embeds = [];
  for (const n of names) embeds.push(await embedText(CATEGORIES[n]));
  _catEmbeds = { names, embeds };
  return _catEmbeds;
}

export async function categorize(imageEmbedding) {
  const { names, embeds } = await categoryEmbeds();
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < names.length; i++) {
    const sc = cosine(imageEmbedding, embeds[i]);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return { category: names[best], score: bestScore };
}
