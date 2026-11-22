// The "why won't it scan?" guide and the zoom helpers (js/modules/audit/domain/scanQuality.js).
import { describe, expect, it } from 'vitest';
import { analyzeGray, clampZoom, createGuide, rgbaToGray, zoomRange } from '../../js/modules/audit/domain/scanQuality.js';

const bars = (w, h, period, blur) => {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.floor(x / period) % 2 ? 30 : 220;
  if (!blur) return g;
  let cur = g;
  for (let k = 0; k < 3; k++) {
    const next = new Uint8Array(g.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let count = 0;
        for (let d = -2; d <= 2; d++) {
          if (x + d >= 0 && x + d < w) {
            sum += cur[y * w + x + d];
            count++;
          }
        }
        next[y * w + x] = sum / count;
      }
    }
    cur = next;
  }
  return cur;
};

describe('measuring a frame', () => {
  it('sharp bars score higher than the same bars blurred', () => {
    const sharp = analyzeGray(bars(96, 32, 3, false), 96, 32).sharp;
    const soft = analyzeGray(bars(96, 32, 3, true), 96, 32).sharp;
    expect(sharp).toBeGreaterThan(soft * 2);
  });

  it('measures brightness and contrast, and copes with an empty or short frame', () => {
    const dark = analyzeGray(new Uint8Array(100).fill(20), 10, 10);
    expect(dark.mean).toBeLessThan(25);
    expect(dark.std).toBe(0);
    expect(analyzeGray(new Uint8Array(0), 0, 0)).toEqual({ mean: 0, std: 0, sharp: 0 });
    expect(analyzeGray(new Uint8Array(5), 10, 10)).toEqual({ mean: 0, std: 0, sharp: 0 });
  });

  it('turns RGBA into luminance', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const [white, black] = rgbaToGray(rgba, 2, 1);
    expect(white).toBeGreaterThan(250);
    expect(black).toBe(0);
  });
});

describe('the guide', () => {
  const ok = { mean: 120, std: 60, sharp: 1 };

  it('is silent during a normal quick scan, then speaks after the quiet period', () => {
    const g = createGuide();
    expect(g.feed(ok, 300)).toMatchObject({ message: '', kind: 'ok' });
    expect(g.feed(ok, 2500)).toMatchObject({ kind: 'hint', message: expect.stringMatching(/inside the frame/i) });
  });

  it('dark frames say so quickly and ask for the light after a few checks in a row', () => {
    const g = createGuide();
    const dark = { mean: 20, std: 10, sharp: 0.5 };
    expect(g.feed(dark, 900)).toMatchObject({ kind: 'dark', wantTorch: false });
    g.feed(dark, 900);
    expect(g.feed(dark, 900).wantTorch).toBe(true);
    expect(g.feed(ok, 900).wantTorch).toBe(false); // a bright frame breaks the run
    expect(createGuide().feed(ok, 5000).wantTorch).toBe(false);
  });

  it('says hold steady for a frame much blurrier than the recent best, and reports glare and flat contrast', () => {
    const g = createGuide();
    g.feed(ok, 0);
    expect(g.feed({ ...ok, sharp: 0.2 }, 2500).kind).toBe('blur');
    expect(createGuide().feed({ mean: 240, std: 30, sharp: 1 }, 2500).kind).toBe('glare');
    expect(createGuide().feed({ mean: 120, std: 5, sharp: 0 }, 2500).kind).toBe('contrast');
  });

  it('a missing measurement is treated as a normal frame, and reset forgets the best sharpness', () => {
    const g = createGuide();
    expect(g.feed(null, 0).message).toBe('');
    g.feed(ok, 0);
    g.reset();
    expect(g.feed({ ...ok, sharp: 0.2 }, 2500).kind).toBe('hint');
  });
});

describe('zoom', () => {
  it('is offered only where the camera has a range, starting at 1.5× inside it', () => {
    expect(zoomRange(null)).toBeNull();
    expect(zoomRange({})).toBeNull();
    expect(zoomRange({ zoom: { min: 1, max: 1 } })).toBeNull();
    expect(zoomRange({ zoom: { min: 1, max: 4, step: 0.5 } })).toEqual({ min: 1, max: 4, step: 0.5, value: 1.5 });
    expect(zoomRange({ zoom: { min: 2, max: 4 } })).toEqual({ min: 2, max: 4, step: 0.1, value: 2 });
    expect(zoomRange({ zoom: { min: 1, max: 1.2 } }).value).toBe(1.2);
  });

  it('keeps a chosen zoom inside the range', () => {
    const r = zoomRange({ zoom: { min: 1, max: 4 } });
    expect(clampZoom(r, 9)).toBe(4);
    expect(clampZoom(r, 0.2)).toBe(1);
    expect(clampZoom(r, 2.5)).toBe(2.5);
    expect(clampZoom(r, Number.NaN)).toBeNull();
    expect(clampZoom(null, 2)).toBeNull();
  });
});
