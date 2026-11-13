// Browser-side memory for the closing screens: which closing the ledger should open (the router passes no parameters),
// and a local copy of the draft being typed so nothing is lost on a dropped connection. Storage can be blocked or full,
// so every read and write is wrapped and the screens work without it.
const OPEN_KEY = 'dua.closing.open';
const draftKey = (key) => `dua.closing.draft.${key}`;

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** What the ledger should open: { key, date, kind, mode, handoverSeq?, opening? } */
export const setOpen = (target) => safe(() => sessionStorage.setItem(OPEN_KEY, JSON.stringify(target)));
export const getOpen = () => safe(() => JSON.parse(sessionStorage.getItem(OPEN_KEY) || 'null'));
export const clearOpen = () => safe(() => sessionStorage.removeItem(OPEN_KEY));

export const newKey = () => crypto.randomUUID();

/** The local copy: { form, version, savedAt, dirty } where dirty means typed but not yet saved on the server. */
export const saveLocal = (key, state) =>
  safe(() => localStorage.setItem(draftKey(key), JSON.stringify({ ...state, savedAt: new Date().toISOString() })));
export const loadLocal = (key) => safe(() => JSON.parse(localStorage.getItem(draftKey(key)) || 'null'));
export const clearLocal = (key) => safe(() => localStorage.removeItem(draftKey(key)));
