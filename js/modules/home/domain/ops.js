// Pure helpers for the Owner's Action Centre and Recent Activity on Home. No Supabase, no DOM.
// The database decides what an issue is and how serious it is (ops_rules); this file only checks, filters and words things.

export const PRIORITIES = {
  critical: { label: 'Critical', rank: 0, mark: '!' },
  warning: { label: 'Needs attention', rank: 1, mark: '▲' },
  info: { label: 'For information', rank: 2, mark: 'i' },
};
export const CATEGORY_LABELS = { closing: 'Closing', sales: 'Sales', inventory: 'Stock', cash: 'Cash', system: 'System' };

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Links come from the database but are only ever followed inside the app: a plain "/page" path, never a web address.
const safeHref = (v) => (typeof v === 'string' && /^\/[a-z0-9\-/]*$/i.test(v) ? `#${v}` : null);

// Accepts the raw ops_action_items() result. Malformed rows are dropped; an unknown priority is treated as "needs attention"
// (never quietly downgraded to information).
export function normaliseItems(result) {
  const rows = Array.isArray(result?.items) ? result.items : [];
  return rows
    .map((r) => ({
      ruleKey: text(r?.rule_key, 40),
      category: Object.hasOwn(CATEGORY_LABELS, r?.category) ? r.category : 'system',
      severity: Object.hasOwn(PRIORITIES, r?.severity) ? r.severity : 'warning',
      title: text(r?.title, 80),
      detail: text(r?.detail, 240),
      responsible: text(r?.responsible, 80) || 'Owner',
      deadline: typeof r?.deadline === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.deadline) ? r.deadline.slice(0, 10) : null,
      href: safeHref(r?.href),
      ref: text(r?.ref, 80),
    }))
    .filter((r) => r.title)
    .sort(
      (a, b) => PRIORITIES[a.severity].rank - PRIORITIES[b.severity].rank || a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref),
    );
}

export function filterItems(items, { priority = 'all', category = 'all' } = {}) {
  return items.filter((i) => (priority === 'all' || i.severity === priority) && (category === 'all' || i.category === category));
}

export const countBySeverity = (items) => ({
  critical: items.filter((i) => i.severity === 'critical').length,
  warning: items.filter((i) => i.severity === 'warning').length,
  info: items.filter((i) => i.severity === 'info').length,
});

// Only categories that have at least one issue are offered as filters.
export const categoriesIn = (items) => Object.keys(CATEGORY_LABELS).filter((c) => items.some((i) => i.category === c));

export function normaliseEvents(result) {
  const rows = Array.isArray(result?.events) ? result.events : [];
  return rows
    .map((e) => ({
      at: typeof e?.at === 'string' && !Number.isNaN(Date.parse(e.at)) ? e.at : null,
      category: text(e?.category, 40),
      title: text(e?.title, 80),
      detail: text(e?.detail, 160),
      href: safeHref(e?.href),
      ref: text(e?.ref, 80),
    }))
    .filter((e) => e.at && e.title)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 10);
}

const KARACHI = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', ...opts });
export const clockTime = (ms) => KARACHI({ hour: 'numeric', minute: '2-digit', hour12: true }).format(ms).toLowerCase();

// "5 min ago", "3 h ago", or the date for anything older than a day (Pakistan time).
export function timeAgo(iso, nowMs) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((nowMs - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return KARACHI({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(t);
}

// The line under the section titles. Wording is for ordinary users: what they are looking at and whether to trust it.
export function freshness(state) {
  if (state.status === 'loading' || (state.lastSuccess === null && state.status !== 'error')) return { tone: 'info', text: 'Loading…' };
  if (state.lastSuccess === null) return { tone: 'bad', text: 'Could not load. Check your connection and press Refresh.' };
  const when = `Updated ${clockTime(state.lastSuccess)}`;
  if (state.status === 'refreshing') return { tone: 'info', text: `${when} · refreshing…` };
  if (state.status === 'error') return { tone: 'bad', text: `${when}. Could not refresh, so this may be out of date.` };
  if (state.stale) return { tone: 'warn', text: `${when}. This may be out of date. Press Refresh.` };
  return { tone: 'ok', text: when };
}
