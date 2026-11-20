// The camera scanner: a full-screen dialog that reads one barcode and hands it to the caller.
// Typing a barcode is always possible (a refused camera, a damaged label, a keyboard scanner). The camera stops the moment the
// dialog closes, the page is hidden, or nothing was read for a while, so it never drains a phone left on a counter.
import { html, render } from '../../../shared/html.js';
import { cleanBarcode, createReadGate, guessType, isValidBarcode } from '../domain/barcode.js';
import { chooseEngine } from './scanEngine.js';

export const IDLE_MS = 45000;
const FRAME_WIDTH = 720; // frames are shrunk before reading: the same accuracy on a labelled box, a lot less work on a weak phone

export function cameraMessage(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was refused. Allow the camera for this site in your browser settings, or type the barcode below.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Type the barcode below.';
  if (name === 'unsupported') return 'This browser cannot open the camera here. Type the barcode below.';
  return 'The camera could not start. Type the barcode below.';
}

/**
 * Opens the scanner. `onCode({ code, format, type })` is called once per accepted barcode; the dialog then closes unless
 * `continuous` is set. Returns { close }.
 * `deps` lets tests replace the camera, the engine and the clock.
 */
export function openScanner({
  title = 'Scan a barcode',
  hint = 'Hold the barcode inside the frame.',
  onCode,
  onClose,
  continuous = false,
  deps = {},
} = {}) {
  const doc = deps.doc ?? document;
  const win = deps.win ?? globalThis;
  const opener = doc.activeElement;
  const state = { phase: 'starting', message: '', torch: false, canTorch: false, typed: '' };
  const gate = createReadGate();
  let stream = null;
  let engine = null;
  let timer = null;
  let idleTimer = null;
  let closed = false;
  let canvas = null;

  const host = doc.createElement('div');
  host.className = 'aud-scan';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'aud-scan-title');
  doc.body.append(host);

  const video = doc.createElement('video');
  video.className = 'aud-scan-video';
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.setAttribute('aria-hidden', 'true');

  function draw() {
    const keep = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement.dataset?.s : null;
    render(
      host,
      html`<div class="aud-scan-box">
        <div class="aud-scan-head">
          <h2 id="aud-scan-title">${title}</h2>
          <button type="button" class="btn btn-ghost btn-sm" data-s="close">Close</button>
        </div>
        <div class="aud-scan-view" data-view></div>
        <p class="aud-scan-status" role="status" aria-live="polite">${state.message || hint}</p>
        <div class="aud-actions">
          ${state.phase === 'paused' ? html`<button type="button" class="btn btn-primary btn-sm" data-s="resume">Keep scanning</button>` : ''}
          ${state.canTorch ? html`<button type="button" class="btn btn-ghost btn-sm" data-s="torch" aria-pressed="${state.torch ? 'true' : 'false'}">${state.torch ? 'Light off' : 'Light on'}</button>` : ''}
        </div>
        <form class="aud-scan-type" data-s="typed">
          <label class="field"
            ><span>Or type the barcode</span
            ><input
              type="text"
              inputmode="text"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              maxlength="60"
              data-s="typed-input"
              value="${state.typed}"
          /></label>
          <button type="submit" class="btn btn-sm">Use this barcode</button>
        </form>
      </div>`,
    );
    const slot = host.querySelector('[data-view]');
    if (slot && state.phase !== 'denied' && state.phase !== 'unavailable') slot.append(video);
    if (keep) host.querySelector(`[data-s="${keep}"]`)?.focus();
  }

  const say = (message) => {
    state.message = message;
    const el = host.querySelector('.aud-scan-status');
    if (el) el.textContent = message || hint;
  };

  function grab() {
    const w = Math.min(video.videoWidth || FRAME_WIDTH, FRAME_WIDTH);
    const h = Math.round(w * ((video.videoHeight || 1) / (video.videoWidth || 1)));
    canvas ??= doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  async function accept(hit) {
    win.navigator?.vibrate?.(60);
    const result = { code: hit.code, format: hit.format, type: guessType(hit.code, hit.format) };
    if (!continuous) close();
    try {
      await onCode?.(result);
    } catch {
      // the caller shows its own message; the scanner has nothing to add
    }
  }

  const schedule = (ms) => {
    clearTimeout(timer);
    timer = (deps.setTimeout ?? setTimeout)(tick, ms);
  };
  async function tick() {
    if (closed || state.phase !== 'scanning') return;
    const started = Date.now();
    try {
      if (video.readyState >= 2) {
        const found = await engine.detect(video, grab);
        for (const r of found) {
          const hit = gate.push(r.text, r.format);
          if (hit) return void accept(hit);
        }
      }
    } catch {
      // one bad frame is not a reason to stop
    }
    // a slow phone reads less often instead of falling behind
    schedule(Math.max(engine.name === 'native' ? 150 : 300, (Date.now() - started) * 1.5));
  }

  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = (deps.setTimeout ?? setTimeout)(() => {
      stopCamera();
      state.phase = 'paused';
      state.message = 'Scanning paused to save battery.';
      draw();
    }, IDLE_MS);
  };

  function stopCamera() {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    for (const t of stream?.getTracks?.() ?? []) t.stop();
    stream = null;
    video.srcObject = null;
    state.canTorch = false;
    state.torch = false;
  }

  async function startCamera() {
    const md = deps.mediaDevices ?? win.navigator?.mediaDevices;
    if (!md?.getUserMedia) {
      state.phase = 'unavailable';
      state.message = cameraMessage({ name: 'unsupported' });
      return draw();
    }
    try {
      state.phase = 'starting';
      state.message = 'Starting the camera…';
      draw();
      stream = await md.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (closed) return stopCamera();
      video.srcObject = stream;
      await video.play?.().catch(() => {});
      const caps = stream.getVideoTracks?.()[0]?.getCapabilities?.() ?? {};
      state.canTorch = !!caps.torch;
      state.message = 'Loading the scanner…';
      draw();
      engine ??= await (deps.chooseEngine ?? chooseEngine)({ win, doc });
      if (closed) return stopCamera();
      state.phase = 'scanning';
      state.message = hint;
      draw();
      armIdle();
      schedule(150);
    } catch (err) {
      stopCamera();
      state.phase = ['NotAllowedError', 'SecurityError', 'NotFoundError', 'OverconstrainedError'].includes(err?.name)
        ? 'denied'
        : 'unavailable';
      state.message = err?.isScannerLoad ? err.message : cameraMessage(err);
      draw();
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    stopCamera();
    doc.removeEventListener('visibilitychange', onVisibility);
    host.remove();
    opener?.focus?.();
    onClose?.();
  }

  const onVisibility = () => {
    if (closed) return;
    if (doc.hidden) {
      stopCamera();
      state.phase = 'paused';
      state.message = 'Scanning paused. Come back to continue.';
      draw();
    } else if (state.phase === 'paused') void startCamera();
  };
  doc.addEventListener('visibilitychange', onVisibility);

  host.onclick = (e) => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    if (b.dataset.s === 'close') return close();
    if (b.dataset.s === 'resume') return void startCamera();
    if (b.dataset.s === 'torch') {
      const track = stream?.getVideoTracks?.()[0];
      const next = !state.torch;
      track
        ?.applyConstraints?.({ advanced: [{ torch: next }] })
        .then(() => {
          state.torch = next;
          draw();
        })
        .catch(() => say('The light could not be switched on.'));
    }
  };
  host.oninput = (e) => {
    if (e.target.dataset?.s === 'typed-input') state.typed = e.target.value;
  };
  host.onsubmit = (e) => {
    e.preventDefault();
    const code = cleanBarcode(state.typed);
    if (!isValidBarcode(code)) {
      state.message = 'Enter 4 to 48 letters or digits, with no spaces.';
      return draw();
    }
    void accept({ code, format: 'manual' });
  };
  host.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key !== 'Tab') return;
    const focusable = [...host.querySelectorAll('button:not([disabled]), input')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  draw();
  host.querySelector('[data-s="close"]')?.focus();
  void startCamera();
  return {
    close,
    get phase() {
      return state.phase;
    },
  };
}
