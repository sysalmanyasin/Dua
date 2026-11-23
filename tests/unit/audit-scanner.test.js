// @vitest-environment jsdom
// The scanning engine choice and the camera dialog, with the camera and the detector replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_FORMATS,
  ZXING_FORMATS,
  chooseEngine,
  loadZxing,
  nativeUsable,
  resetZxing,
  warmEngine,
} from '../../js/modules/audit/ui/scanEngine.js';
import { IDLE_MS, cameraMessage, openScanner } from '../../js/modules/audit/ui/scanner.js';

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('choosing the engine', () => {
  beforeEach(() => resetZxing());
  const native = (formats = ['ean_13', 'code_128', 'qr_code'], detect = async () => []) => {
    class D {
      static getSupportedFormats = async () => formats;
      constructor(opts) {
        this.opts = opts;
      }
      detect = detect;
    }
    return D;
  };

  it("uses the browser's own detector when it reads retail and Code 128 labels", async () => {
    const win = { BarcodeDetector: native(undefined, async () => [{ rawValue: '5901234123457', format: 'ean_13' }]) };
    expect(await nativeUsable(win)).toBe(true);
    const e = await chooseEngine({ win, doc: document });
    expect(e.name).toBe('native');
    expect(await e.detect({})).toEqual([{ text: '5901234123457', format: 'ean_13' }]);
  });
  it('does not use a detector that cannot read the labels pharmacies have', async () => {
    expect(await nativeUsable({ BarcodeDetector: native(['qr_code']) })).toBe(false);
    expect(await nativeUsable({})).toBe(false);
    const broken = native();
    broken.getSupportedFormats = async () => {
      throw new Error('no');
    };
    expect(await nativeUsable({ BarcodeDetector: broken })).toBe(false);
  });
  it('asks the detector only for formats it names', () => {
    expect(NATIVE_FORMATS).toContain('ean_13');
    expect(ZXING_FORMATS).toEqual(['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF', 'QRCode']);
  });
  it('falls back to ZXing for the rest of the session when the native detector fails at run time', async () => {
    const readBarcodes = vi.fn(async () => [{ text: 'ABC12345', format: 'Code128', isValid: true }]);
    const win = {
      ZXingWASM: { setZXingModuleOverrides: vi.fn(), readBarcodes },
      BarcodeDetector: native(undefined, async () => {
        throw new Error('detector broke');
      }),
    };
    const e = await chooseEngine({ win, doc: document });
    expect(await e.detect({}, () => 'IMAGEDATA')).toEqual([{ text: 'ABC12345', format: 'Code128' }]);
    expect(readBarcodes).toHaveBeenCalledWith('IMAGEDATA', expect.objectContaining({ formats: ZXING_FORMATS, maxNumberOfSymbols: 1 }));
    await e.detect({}, () => 'IMAGEDATA');
    expect(readBarcodes).toHaveBeenCalledTimes(2);
  });
  it('drops reads ZXing marks invalid', async () => {
    const win = {
      ZXingWASM: { setZXingModuleOverrides: vi.fn(), readBarcodes: async () => [{ text: 'X', format: 'QRCode', isValid: false }] },
    };
    const e = await chooseEngine({ win, doc: document, prefer: 'zxing' });
    expect(await e.detect({}, () => 1)).toEqual([]);
  });

  describe('the vendored library', () => {
    it('points ZXing at the .wasm file on this site, never at a CDN', async () => {
      const set = vi.fn();
      const win = { ZXingWASM: { setZXingModuleOverrides: set } };
      await loadZxing(document, win);
      const { locateFile } = set.mock.calls[0][0];
      const wasm = locateFile('zxing_reader.wasm', 'https://cdn.jsdelivr.net/npm/zxing-wasm/dist/reader/');
      expect(wasm).toMatch(/vendor\/zxing_reader-3\.1\.7\.wasm$/);
      expect(wasm).not.toMatch(/jsdelivr|cdn/i);
      expect(locateFile('other.bin', 'prefix/')).toBe('prefix/other.bin');
    });
    it('loads the script from this site once, and only once', async () => {
      const win = {};
      const p1 = loadZxing(document, win);
      const p2 = loadZxing(document, win);
      const tags = [...document.head.querySelectorAll('script')].filter((s) => s.src.includes('zxing-wasm-reader'));
      expect(tags).toHaveLength(1);
      expect(tags[0].getAttribute('src')).toMatch(
        /^vendor\/zxing-wasm-reader-3\.1\.7\.iife\.js$|vendor\/zxing-wasm-reader-3\.1\.7\.iife\.js$/,
      );
      win.ZXingWASM = { setZXingModuleOverrides: vi.fn() };
      tags[0].onload();
      expect(await p1).toBe(win.ZXingWASM);
      expect(await p2).toBe(win.ZXingWASM);
      tags[0].remove();
    });
    it('says what to do when the script cannot load, and allows a later try', async () => {
      const win = {};
      const p = loadZxing(document, win);
      const tag = [...document.head.querySelectorAll('script')].at(-1);
      tag.onerror();
      await expect(p).rejects.toMatchObject({ isScannerLoad: true, message: expect.stringMatching(/type the barcode/) });
      tag.remove();
      const again = loadZxing(document, win);
      const tag2 = [...document.head.querySelectorAll('script')].at(-1);
      win.ZXingWASM = { setZXingModuleOverrides: vi.fn() };
      tag2.onload();
      await again;
      tag2.remove();
    });
  });

  describe('warming', () => {
    it('does nothing where the detector exists, nothing offline, and never throws', async () => {
      expect(await warmEngine({ win: { BarcodeDetector: native() }, doc: document })).toBe('native');
      expect(await warmEngine({ win: { navigator: { onLine: false } }, doc: document })).toBe('offline');
      const win = { ZXingWASM: { setZXingModuleOverrides: vi.fn() }, navigator: { onLine: true }, fetch: vi.fn(async () => ({})) };
      expect(await warmEngine({ win, doc: document })).toBe('zxing');
      expect(win.fetch.mock.calls[0][0]).toMatch(/vendor\/zxing_reader-3\.1\.7\.wasm$/);
      resetZxing();
      expect(
        await warmEngine({
          win: {
            ZXingWASM: {
              setZXingModuleOverrides: () => {
                throw new Error('x');
              },
            },
            navigator: {},
          },
          doc: document,
        }),
      ).toBe('unavailable');
    });
  });
});

describe('the scanner dialog', () => {
  let tracks;
  let reads;
  let hidden;
  const stream = (torch = false) => {
    const track = { stop: vi.fn(), getCapabilities: () => ({ torch }), applyConstraints: vi.fn(async () => {}) };
    tracks.push(track);
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  const make = (over = {}) => {
    const onCode = vi.fn();
    const onClose = vi.fn();
    const mediaDevices = over.mediaDevices ?? { getUserMedia: vi.fn(async () => stream(over.torch)) };
    const handle = openScanner({
      onCode,
      onClose,
      continuous: over.continuous,
      deps: {
        mediaDevices,
        chooseEngine: async () => ({ name: 'native', detect: async () => reads.shift() ?? [] }),
        win: { navigator: { vibrate: vi.fn() } },
      },
    });
    return { handle, onCode, onClose, mediaDevices };
  };
  const dialog = () => document.querySelector('.aud-scan');
  const status = () => dialog().querySelector('.aud-scan-status').textContent;

  beforeEach(() => {
    vi.useFakeTimers();
    tracks = [];
    reads = [];
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    HTMLMediaElement.prototype.play = vi.fn(async () => {});
    HTMLCanvasElement.prototype.getContext = () => null; // jsdom has no canvas; the frame check then skips itself
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    document.body.innerHTML = '<button id="opener">Scan</button>';
    document.getElementById('opener').focus();
  });
  afterEach(() => {
    document.querySelector('.aud-scan')?.remove();
    vi.useRealTimers();
  });

  it('is a labelled, modal dialog with focus inside, a typed-entry field and no inline script', async () => {
    make();
    await flush();
    const d = dialog();
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector(`#${d.getAttribute('aria-labelledby')}`).textContent).toBe('Scan a barcode');
    expect(d.contains(document.activeElement)).toBe(true);
    expect(d.querySelector('input[data-s="typed-input"]')).toBeTruthy();
    expect(d.querySelector('.aud-scan-status').getAttribute('aria-live')).toBe('polite');
    expect(d.querySelector('video').getAttribute('aria-hidden')).toBe('true');
  });

  it('accepts a valid retail number on the first read, stops the camera, closes and returns focus', async () => {
    const { onCode, onClose, mediaDevices } = make();
    await flush();
    reads.push([{ text: '5901234123457', format: 'ean_13' }]);
    await vi.advanceTimersByTimeAsync(400);
    expect(onCode).toHaveBeenCalledWith({ code: '5901234123457', format: 'ean13', type: 'ean13' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(document.activeElement.id).toBe('opener');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  });

  it('needs the same Code 128 value twice', async () => {
    const { onCode } = make();
    await flush();
    reads.push([{ text: 'ABC12345', format: 'code_128' }]);
    await vi.advanceTimersByTimeAsync(400);
    expect(onCode).not.toHaveBeenCalled();
    reads.push([{ text: 'ABC12345', format: 'code_128' }]);
    await vi.advanceTimersByTimeAsync(400);
    expect(onCode).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning in continuous mode until closed', async () => {
    const { onCode, handle } = make({ continuous: true });
    await flush();
    reads.push([{ text: '5901234123457', format: 'ean_13' }]);
    await vi.advanceTimersByTimeAsync(400);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    handle.close();
    expect(dialog()).toBeNull();
  });

  it('takes a typed barcode, cleaned, and refuses one that is not valid', async () => {
    const { onCode } = make();
    await flush();
    const input = dialog().querySelector('input[data-s="typed-input"]');
    input.value = 'ab';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onCode).not.toHaveBeenCalled();
    expect(status()).toMatch(/4 to 48 letters or digits/);
    const input2 = dialog().querySelector('input[data-s="typed-input"]');
    input2.value = ' 5901234 123457 ';
    input2.dispatchEvent(new Event('input', { bubbles: true }));
    dialog()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(onCode).toHaveBeenCalledWith({ code: '5901234123457', format: 'manual', type: 'ean13' });
  });

  it('says plainly what to do when the camera is refused, and typing still works', async () => {
    const mediaDevices = { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))) };
    const { onCode } = make({ mediaDevices });
    await flush();
    expect(status()).toMatch(/Camera access was refused/);
    expect(dialog().querySelector('video')).toBeNull();
    const input = dialog().querySelector('input[data-s="typed-input"]');
    input.value = 'CODE1234';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(onCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'CODE1234' }));
  });

  it('has a sentence for each camera failure, and for a browser with no camera support', async () => {
    expect(cameraMessage({ name: 'NotFoundError' })).toMatch(/No camera was found/);
    expect(cameraMessage({ name: 'AbortError' })).toMatch(/could not start/);
    make({ mediaDevices: {} });
    await flush();
    expect(status()).toMatch(/cannot open the camera/);
  });

  it('closes on Escape and releases the camera', async () => {
    const { onClose } = make();
    await flush();
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalled();
    expect(tracks.every((t) => t.stop.mock.calls.length >= 1)).toBe(true);
  });

  it('keeps Tab inside the dialog', async () => {
    make();
    await flush();
    const focusable = [...dialog().querySelectorAll('button:not([disabled]), input')];
    focusable.at(-1).focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('pauses to save the battery when nothing is read, and resumes on request', async () => {
    const { mediaDevices } = make();
    await flush();
    await vi.advanceTimersByTimeAsync(IDLE_MS + 100);
    expect(status()).toMatch(/paused to save battery/);
    expect(tracks[0].stop).toHaveBeenCalled();
    const resume = dialog().querySelector('[data-s="resume"]');
    expect(resume).toBeTruthy();
    resume.click();
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('releases the camera when the page is hidden and restarts when it is back', async () => {
    const { mediaDevices } = make();
    await flush();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(tracks[0].stop).toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('offers a light only on a phone that has one', async () => {
    make({ torch: true });
    await flush();
    const light = dialog().querySelector('[data-s="torch"]');
    expect(light.getAttribute('aria-pressed')).toBe('false');
    light.click();
    await flush();
    expect(tracks[0].applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(dialog().querySelector('[data-s="torch"]').getAttribute('aria-pressed')).toBe('true');
    dialog().remove();
    make({ torch: false });
    await flush();
    expect(dialog().querySelector('[data-s="torch"]')).toBeNull();
  });

  it('survives a frame the detector cannot read', async () => {
    const { onCode } = make();
    await flush();
    reads.push(null); // makes the stub throw on spread
    reads.push([{ text: '5901234123457', format: 'ean_13' }]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(onCode).toHaveBeenCalledTimes(1);
  });
});
