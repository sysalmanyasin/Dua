// Which audit or round the person opened, kept for the tab (the router has no query string). Pure storage helpers.
// The last audit or round is also kept on the device (not only the tab) so the Overview can offer to pick up where the person left off.
const KEY = 'dua.audit.view';
const LAST = 'dua.audit.last';
const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};
export const setView = (target) => {
  const done = safe(() => sessionStorage.setItem(KEY, JSON.stringify(target)));
  // only ids are kept; what the person may open is still decided by the database when the page loads
  if (target?.engagement || target?.round) {
    safe(() => localStorage.setItem(LAST, JSON.stringify({ engagement: target.engagement ?? null, round: target.round ?? null })));
  }
  return done;
};
export const getView = () => safe(() => JSON.parse(sessionStorage.getItem(KEY) || 'null'));
/** The last audit (and round) opened on this device, or null. */
export const getLastView = () => {
  const last = safe(() => JSON.parse(localStorage.getItem(LAST) || 'null'));
  return last && typeof last.engagement === 'string'
    ? { engagement: last.engagement, round: typeof last.round === 'string' ? last.round : null }
    : null;
};
export const newKey = () => crypto.randomUUID();
