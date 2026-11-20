// Which engine reads the camera. The browser's own BarcodeDetector is used when it exists and can read retail and Code 128 labels:
// it is fast, free of any download and gentle on the battery. Otherwise the vendored ZXing (WebAssembly) is loaded from this site
// the first time a scanner opens, and the service worker keeps it afterwards. The library's built-in CDN address is never used.
// `detect(source, grab)` returns [{ text, format }]. `source` is a video element or an image; `grab()` gives ImageData for ZXing.

export const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
export const ZXING_FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'ITF', 'QRCode'];
export const ZXING_JS = 'vendor/zxing-wasm-reader-3.1.7.iife.js';
export const ZXING_WASM = 'vendor/zxing_reader-3.1.7.wasm';

let zxingLoading = null;

/** Loads the vendored ZXing once and points it at the local .wasm file. Rejects with a plain message when it cannot. */
export function loadZxing(doc = document, win = globalThis) {
  if (win.ZXingWASM) {
    zxingLoading ??= Promise.resolve(configure(win.ZXingWASM, doc));
    return zxingLoading;
  }
  zxingLoading ??= new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = new URL(ZXING_JS, doc.baseURI).href;
    s.async = true;
    s.onload = () => (win.ZXingWASM ? resolve(configure(win.ZXingWASM, doc)) : fail(reject));
    s.onerror = () => fail(reject);
    doc.head.append(s);
  });
  return zxingLoading;
}
function fail(reject) {
  zxingLoading = null; // a later try may work (the connection came back)
  const err = new Error('The scanner could not be loaded. Check your connection, or type the barcode below.');
  err.isScannerLoad = true;
  reject(err);
}
function configure(z, doc) {
  const wasm = new URL(ZXING_WASM, doc.baseURI).href;
  z.setZXingModuleOverrides({ locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm : `${prefix}${path}`) });
  return z;
}
/** Tests: forget the loaded library. */
export const resetZxing = () => (zxingLoading = null);

/** True when this browser can read barcodes itself. */
export async function nativeUsable(win = globalThis) {
  if (typeof win.BarcodeDetector !== 'function') return false;
  try {
    const supported = await win.BarcodeDetector.getSupportedFormats();
    return supported.includes('ean_13') && supported.includes('code_128');
  } catch {
    return false;
  }
}

/**
 * Picks the engine. `prefer` forces one ('zxing' is used by tests and as the automatic fallback).
 * @returns {Promise<{ name: 'native'|'zxing', detect: (source: any, grab?: () => ImageData) => Promise<{text: string, format: string}[]> }>}
 */
export async function chooseEngine({ win = globalThis, doc = globalThis.document, prefer = null } = {}) {
  const useZxing = async () => {
    const z = await loadZxing(doc, win);
    return {
      name: 'zxing',
      async detect(_source, grab) {
        const found = await z.readBarcodes(grab(), {
          formats: ZXING_FORMATS,
          tryHarder: true,
          tryInvert: true,
          tryRotate: true,
          maxNumberOfSymbols: 1,
        });
        return found.filter((r) => r.isValid !== false).map((r) => ({ text: r.text, format: r.format }));
      },
    };
  };
  if (prefer !== 'zxing' && (await nativeUsable(win))) {
    const detector = new win.BarcodeDetector({ formats: NATIVE_FORMATS });
    let backup = null;
    return {
      name: 'native',
      async detect(source, grab) {
        if (backup) return backup.detect(source, grab);
        try {
          const found = await detector.detect(source);
          return found.map((r) => ({ text: r.rawValue, format: r.format }));
        } catch {
          // the browser said it could read barcodes and then could not: switch to ZXing for the rest of the session
          backup = await useZxing();
          return backup.detect(source, grab);
        }
      },
    };
  }
  return useZxing();
}

/**
 * Warms the fallback while the person has a connection, so the first scan in a shop with weak signal does not wait for a download.
 * Does nothing on a phone that can read barcodes itself. Never throws.
 */
export async function warmEngine({ win = globalThis, doc = globalThis.document } = {}) {
  try {
    if (await nativeUsable(win)) return 'native';
    if (win.navigator?.onLine === false) return 'offline';
    await loadZxing(doc, win);
    await win.fetch?.(new URL(ZXING_WASM, doc.baseURI).href); // the service worker keeps it for offline use
    return 'zxing';
  } catch {
    return 'unavailable';
  }
}
