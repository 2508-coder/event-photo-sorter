// Blur, brightness (lighting) + near-duplicate hashing — plain canvas math.

export const BLUR_THRESHOLD = 120;
export const DUP_HAMMING = 8;

export function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function analyzeQuality(imgEl) {
  const W = 256, H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const gray = new Float64Array(W * H);
  let sum = 0;
  for (let i = 0; i < W * H; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = v;
    sum += v;
  }
  const brightness = sum / (W * H);          // 0 (dark) .. 255 (bright)
  const blurScore = laplacianVariance(gray, W, H);
  return {
    blurScore,
    isBlurry: blurScore < BLUR_THRESHOLD,
    brightness,
    phash: dHash(imgEl),
  };
}

function laplacianVariance(gray, W, H) {
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const v = -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - W] + gray[i + W];
      n++;
      const delta = v - mean;
      mean += delta / n;
      m2 += delta * (v - mean);
    }
  }
  return n ? m2 / n : 0;
}

function dHash(imgEl) {
  const canvas = document.createElement("canvas");
  canvas.width = 9; canvas.height = 8;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * 9 + x) * 4;
      const j = (y * 9 + x + 1) * 4;
      const left = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const right = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      bits += left < right ? "1" : "0";
    }
  }
  let hex = "";
  for (let k = 0; k < 64; k += 4) hex += parseInt(bits.slice(k, k + 4), 2).toString(16);
  return hex;
}

export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}
