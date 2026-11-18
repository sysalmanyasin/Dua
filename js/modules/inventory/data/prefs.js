// A person's own report settings (window, cover days, filters), kept in the database like every other personal setting.
import { getPref, setPref } from '../../../core/prefs.js';

/** Saved settings for one screen merged over its defaults; falls back to the defaults on any problem. */
export async function loadSettings(key, defaults) {
  try {
    const saved = await getPref(`inventory.${key}`);
    return saved && typeof saved === 'object' ? { ...defaults, ...saved } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

/** Fire and forget: losing a preference is never worth interrupting the screen. */
export function saveSettings(key, value) {
  Promise.resolve(setPref(`inventory.${key}`, value)).catch(() => {});
}
