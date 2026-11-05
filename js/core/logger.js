// Small structured logger. Keeps recent entries in memory; a reporter (e.g. Sentry) can be attached later.
const MAX = 200;
const buffer = [];
let reporter = null;

function write(level, message, data) {
  const entry = { at: new Date().toISOString(), level, message: String(message), data: scrub(data) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  if (level === 'error' || level === 'warn') console[level](`[dua] ${entry.message}`, entry.data ?? '');
  if (reporter && level === 'error') {
    try {
      reporter(entry);
    } catch {
      /* a broken reporter must never break the app */
    }
  }
}

// Never log credentials or tokens.
const SECRET_KEY = /pin|pass|token|secret|code|key/i;
export function scrub(data) {
  if (data === null || data === undefined || typeof data !== 'object') return data;
  const out = Array.isArray(data) ? [] : {};
  for (const [k, v] of Object.entries(data)) out[k] = SECRET_KEY.test(k) ? '[hidden]' : scrub(v);
  return out;
}

export const log = {
  info: (m, d) => write('info', m, d),
  warn: (m, d) => write('warn', m, d),
  error: (m, d) => write('error', m, d),
  recent: () => buffer.slice(),
  setReporter: (fn) => {
    reporter = fn;
  },
};

export function installGlobalHandlers(target = globalThis) {
  target.addEventListener?.('error', (e) => log.error('uncaught', { message: e.message }));
  target.addEventListener?.('unhandledrejection', (e) => log.error('unhandled rejection', { reason: String(e.reason) }));
}
