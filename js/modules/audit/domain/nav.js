// Which audit or round the person opened, kept for the tab (the router has no query string). Pure storage helpers.
const KEY = 'dua.audit.view';
const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};
export const setView = (target) => safe(() => sessionStorage.setItem(KEY, JSON.stringify(target)));
export const getView = () => safe(() => JSON.parse(sessionStorage.getItem(KEY) || 'null'));
export const newKey = () => crypto.randomUUID();
