// "Why won't it scan?": frame measurements and the guide that turns them into one short hint. Pure: no screen, no camera.
// The scanner feeds it a small grey thumbnail now and then; a normal quick scan never sees a message, because the guide stays silent
// until the camera has failed to read for a while. It never accepts or rejects a barcode: reading rules stay in barcode.js.

/** Brightness, contrast and sharpness of a grey frame (luminance 0–255, w × h). Sharpness is normalised by contrast. */
export function analyzeGray(gray, w, h) {
  const n = w * h;
  if (!n || gray.length < n) return { mean: 0, std: 0, sharp: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  const variance = varSum / n;
  let lap = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lap += l;
      lapSq += l * l;
      count++;
    }
  }
  const lapVar = count ? lapSq / count - (lap / count) * (lap / count) : 0;
  return { mean, std: Math.sqrt(variance), sharp: lapVar / (variance + 1) };
}

/** RGBA pixels (as from a canvas) to integer luminance. */
export function rgbaToGray(rgba, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 306 + rgba[j + 1] * 601 + rgba[j + 2] * 117) >> 10;
  return gray;
}

const DEFAULTS = {
  darkMean: 45,
  brightMean: 225,
  lowStd: 14,
  blurRatio: 0.45,
  minPeak: 0.02,
  quietMs: 1800,
  darkQuietMs: 800,
  darkFramesForTorch: 3,
};

/**
 * The guide. `feed(stats, msSinceLastRead)` returns { message, kind, wantTorch }: kind is 'ok' (say nothing), 'dark', 'glare', 'blur',
 * 'contrast' or 'hint'. `wantTorch` is true once the frames have stayed dark for a few checks in a row.
 */
export function createGuide(options = {}) {
  const o = { ...DEFAULTS, ...options };
  let peak = 0;
  let darkRun = 0;
  return {
    feed(stats, msSinceRead) {
      const s = stats ?? { mean: 128, std: 60, sharp: 0 };
      peak = Math.max(peak * 0.995, s.sharp); // slowly forgets, so it follows the label in front of the camera
      darkRun = s.mean < o.darkMean ? darkRun + 1 : 0;
      const out = { message: '', kind: 'ok', wantTorch: darkRun >= o.darkFramesForTorch };
      if (s.mean < o.darkMean && msSinceRead >= o.darkQuietMs) return { ...out, message: 'Too dark. Turn on the light.', kind: 'dark' };
      if (msSinceRead < o.quietMs) return out;
      if (s.mean > o.brightMean) return { ...out, message: 'Glare. Tilt the pack a little.', kind: 'glare' };
      if (peak > o.minPeak && s.sharp < peak * o.blurRatio) {
        return { ...out, message: 'Hold steady and move back a little to focus.', kind: 'blur' };
      }
      if (s.std < o.lowStd) return { ...out, message: 'Low contrast. Change the angle or the light.', kind: 'contrast' };
      return { ...out, message: 'Keep the barcode inside the frame.', kind: 'hint' };
    },
    reset() {
      peak = 0;
      darkRun = 0;
    },
  };
}

/** The zoom the camera supports as { min, max, step, value } or null. Starts at 1.5× (small labels), kept inside the range. */
export function zoomRange(caps, settings = {}) {
  const z = caps?.zoom;
  if (!z || typeof z.max !== 'number' || !(z.max > (z.min ?? 1))) return null;
  const min = z.min ?? 1;
  return { min, max: z.max, step: z.step || 0.1, value: Math.min(z.max, Math.max(min, settings.zoom ?? 1.5)) };
}

/** Keeps a requested zoom inside the range; null when it is not a number or there is no zoom. */
export function clampZoom(range, value) {
  if (!range || !Number.isFinite(value)) return null;
  return Math.min(range.max, Math.max(range.min, value));
}
