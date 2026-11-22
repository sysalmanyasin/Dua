// @vitest-environment jsdom
// What the camera does to help a label scan: the hint line, the light, zoom, tap to focus and the full-resolution photo.
// The camera, the engine and the canvas are replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openScanner } from '../../js/modules/audit/ui/scanner.js';

const flush = () => vi.advanceTimersByTimeAsync(0);
const EAN = '5901234123457';

describe('scanner help', () => {
  let track;
  let frame; // the grey level of every pixel the canvas hands back
  let reads;
  let win;

  const setup = (caps = {}, over = {}) => {
    track = {
      stop: vi.fn(),
      getCapabilities: () => caps,
      applyConstraints: vi.fn(async () => {}),
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const onCode = vi.fn();
    const detect = vi.fn(async (source) => (source?.isStill ? (over.still ?? []) : (reads.shift() ?? [])));
    openScanner({
      onCode,
      continuous: true,
      deps: {
        mediaDevices: { getUserMedia: vi.fn(async () => stream) },
        chooseEngine: async () => ({ name: 'native', detect }),
        win,
      },
    });
    return { onCode, detect };
  };
  const dialog = () => document.querySelector('.aud-scan');
  const status = () => dialog().querySelector('.aud-scan-status').textContent;

  beforeEach(() => {
    vi.useFakeTimers();
    reads = [];
    frame = 120;
    win = { navigator: { vibrate: vi.fn() } };
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    HTMLCanvasElement.prototype.getContext = () => ({
      drawImage: () => {},
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(frame), width: w, height: h }),
    });
    document.body.innerHTML = '<button id="opener">Scan</button>';
  });
  afterEach(() => {
    document.querySelector('.aud-scan')?.remove();
    vi.useRealTimers();
  });

  describe('the hint line', () => {
    it('stays on the plain hint while a quick scan is under way', async () => {
      setup();
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      expect(status()).toBe('Hold the barcode inside the frame.');
    });

    it('says the picture is too dark, and goes back to the plain hint once a barcode is read', async () => {
      frame = 10;
      setup();
      await flush();
      await vi.advanceTimersByTimeAsync(2500);
      expect(status()).toMatch(/Too dark/);
      expect(dialog().querySelector('.aud-scan-status').getAttribute('aria-live')).toBe('polite');
      reads.push([{ text: EAN, format: 'ean_13' }]);
      await vi.advanceTimersByTimeAsync(600);
      expect(status()).toBe('Hold the barcode inside the frame.');
    });

    it('reports glare', async () => {
      frame = 250;
      setup();
      await flush();
      await vi.advanceTimersByTimeAsync(4500);
      expect(status()).toMatch(/Glare/);
    });
  });

  describe('the light', () => {
    it('turns on by itself once when the picture stays dark, and is not fought when the person turns it off', async () => {
      frame = 10;
      setup({ torch: true });
      await flush();
      await vi.advanceTimersByTimeAsync(6000);
      const torchCalls = () => track.applyConstraints.mock.calls.filter(([c]) => 'torch' in c.advanced[0]);
      expect(torchCalls()).toEqual([[{ advanced: [{ torch: true }] }]]);
      expect(dialog().querySelector('[data-s="torch"]').getAttribute('aria-pressed')).toBe('true');
      dialog().querySelector('[data-s="torch"]').click();
      await vi.advanceTimersByTimeAsync(8000);
      expect(torchCalls()).toHaveLength(2);
      expect(torchCalls()[1][0]).toEqual({ advanced: [{ torch: false }] });
    });

    it('does nothing on a phone with no light, and does not touch it when the picture is bright', async () => {
      frame = 10;
      setup({});
      await flush();
      await vi.advanceTimersByTimeAsync(6000);
      expect(track.applyConstraints).not.toHaveBeenCalled();
    });
  });

  describe('focus and zoom', () => {
    it('asks for continuous focus and a 1.5× zoom where the phone has them, and shows a zoom slider', async () => {
      setup({ focusMode: ['single-shot', 'continuous'], zoom: { min: 1, max: 5, step: 0.1 } });
      await flush();
      expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] });
      expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1.5 }] });
      const slider = dialog().querySelector('input[data-s="zoom"]');
      expect(slider.value).toBe('1.5');
      expect(slider.max).toBe('5');
    });

    it('moving the slider changes the zoom, kept inside the range', async () => {
      setup({ zoom: { min: 1, max: 4, step: 0.5 } });
      await flush();
      const slider = dialog().querySelector('input[data-s="zoom"]');
      slider.value = '3';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3 }] });
    });

    it('has no zoom slider and asks for nothing on a phone without them', async () => {
      setup({});
      await flush();
      expect(dialog().querySelector('input[data-s="zoom"]')).toBeNull();
      expect(track.applyConstraints).not.toHaveBeenCalled();
    });

    it('a zoom the phone refuses leaves no slider', async () => {
      setup({ zoom: { min: 1, max: 4 } });
      track.applyConstraints = vi.fn(async () => Promise.reject(new Error('no')));
      await flush();
      await vi.advanceTimersByTimeAsync(0);
      expect(dialog().querySelector('input[data-s="zoom"]')).toBeNull();
    });

    it('a tap on the picture focuses once and then returns to continuous focus', async () => {
      setup({ focusMode: ['single-shot', 'continuous'] });
      await flush();
      track.applyConstraints.mockClear();
      dialog().querySelector('[data-view]').click();
      await flush();
      expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'single-shot' }] });
      await vi.advanceTimersByTimeAsync(1300);
      expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ focusMode: 'continuous' }] });
    });

    it('a tap does nothing where single-shot focus is not offered', async () => {
      setup({ focusMode: ['continuous'] });
      await flush();
      track.applyConstraints.mockClear();
      dialog().querySelector('[data-view]').click();
      await flush();
      expect(track.applyConstraints).not.toHaveBeenCalled();
    });
  });

  describe('the full-resolution photo', () => {
    const still = (blob = {}) => {
      const takePhoto = vi.fn(async () => blob);
      win.ImageCapture = class {
        takePhoto = takePhoto;
      };
      win.createImageBitmap = vi.fn(async () => ({ isStill: true, width: 4000, height: 3000, close: vi.fn() }));
      return takePhoto;
    };

    it('is tried after about 2.5 seconds without a read, and at most every 5 seconds', async () => {
      const takePhoto = still();
      setup();
      await flush();
      await vi.advanceTimersByTimeAsync(2000);
      expect(takePhoto).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1500);
      expect(takePhoto).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4000);
      expect(takePhoto).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(takePhoto).toHaveBeenCalledTimes(2);
    });

    it('a barcode found in the photo goes through the same acceptance rules as any other read', async () => {
      still();
      const { onCode } = setup({}, { still: [{ text: EAN, format: 'ean_13' }] });
      await flush();
      await vi.advanceTimersByTimeAsync(3500);
      expect(onCode).toHaveBeenCalledWith(expect.objectContaining({ code: EAN }));
    });

    it('a photo that reads a short Code 128 on its own is not enough: it still needs a second matching read', async () => {
      still();
      const { onCode } = setup({}, { still: [{ text: 'ABC12345', format: 'code_128' }] });
      await flush();
      await vi.advanceTimersByTimeAsync(3500);
      expect(onCode).not.toHaveBeenCalled();
    });

    it('is never attempted where the browser cannot take photos, and a failed photo is harmless', async () => {
      const { detect } = setup();
      await flush();
      await vi.advanceTimersByTimeAsync(4000);
      expect(detect).toHaveBeenCalled();
      win.ImageCapture = class {
        takePhoto = async () => Promise.reject(new Error('busy'));
      };
      win.createImageBitmap = vi.fn();
      await vi.advanceTimersByTimeAsync(7000);
      expect(dialog()).not.toBeNull();
    });
  });
});
