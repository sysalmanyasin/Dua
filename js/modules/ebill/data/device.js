// The installation id. Made once when Emergency Billing is first used on this device, kept in localStorage, and registered with
// the server when online. It identifies an installation for the owner's device list; it is NOT a security boundary, and never
// replaces the per-invoice id. Browser storage can be cleared by the user, in which case the device simply registers again.
const KEY = 'dua.ebill.device';
let memory = null; // used only if storage is unavailable (private mode), so the id is at least stable while the page is open

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export function getDeviceId() {
  try {
    const have = localStorage.getItem(KEY);
    if (have) return have;
    const id = uuid();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    memory ||= uuid();
    return memory;
  }
}

/** A readable default name, e.g. "Android device 3f9a". The owner can see it in Settings. */
export function deviceLabel(id = getDeviceId()) {
  const ua = globalThis.navigator?.userAgent || '';
  const kind = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac/i.test(ua)
          ? 'Mac'
          : 'Browser';
  return `${kind} device ${id.slice(0, 4)}`;
}
