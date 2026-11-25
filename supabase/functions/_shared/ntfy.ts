// Pure helpers for the owner-notification sender (Foundation F4). No network or Deno APIs here, so they are unit tested.
// The text of a push is generic on purpose: it goes through a public ntfy server, so it never carries amounts or names.
// The only payload value that may appear is a date shaped YYYY-MM-DD.
// ONE EXCEPTION, chosen by the owner (D-62): closing.submitted carries the closing's figures and staff-entered credit labels
// (see closingMessage). The audit.compiled push ("Audit Round Complete", D-64) is the second exception: it lists the round's
// differing items and their values (see auditRoundMessage). Keep NTFY_TOPIC secret, and prefer NTFY_TOKEN / a self-hosted NTFY_SERVER.

export type PushMessage = { title: string; message: string; priority: 1 | 2 | 3 | 4 | 5; tags: string[]; markdown?: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND = /^[a-z][a-z0-9_.]{0,59}$/;
const dateOf = (p: Record<string, unknown>, key = 'date'): string => {
  const v = p?.[key];
  return typeof v === 'string' && DATE.test(v) ? ` (${v})` : '';
};

const KNOWN: Record<string, (p: Record<string, unknown>) => PushMessage> = {
  'closing.submitted': (p) => ({ title: 'Dua: closing submitted', message: `A closing was submitted${dateOf(p)}.`, priority: 3, tags: ['inbox_tray'] }),
  'audit.submitted': () => ({ title: 'Dua: audit count submitted', message: 'A counter submitted an audit count.', priority: 3, tags: ['clipboard'] }),
  'audit.compiled': () => ({ title: 'Dua: audit compiled', message: 'An audit round was compiled and is ready to review.', priority: 3, tags: ['bar_chart'] }),
  'audit.conflict': () => ({ title: 'Dua: audit conflict', message: 'Two audit rounds disagree on an item. Open Audit to settle it.', priority: 4, tags: ['warning'] }),
  'audit.finalized': () => ({ title: 'Dua: audit final', message: 'An audit round was made final.', priority: 3, tags: ['white_check_mark'] }),
  'closing.corrected': (p) => ({ title: 'Dua: closing corrected', message: `A closing was corrected${dateOf(p)}.`, priority: 3, tags: ['memo'] }),
  'attendance.rejected': (p) => ({ title: 'Dua: attendance attempt refused', message: `A check-in was refused${dateOf(p)}. Open Attendance to see why.`, priority: 4, tags: ['warning'] }),
  'inventory.sync_stale': () => ({ title: 'Dua: inventory feed is late', message: 'No successful inventory sync for over 3 hours.', priority: 4, tags: ['warning'] }),
  'inventory.sync_failed': () => ({ title: 'Dua: inventory sync failed', message: 'The last inventory sync failed. See Needs attention.', priority: 4, tags: ['warning'] }),
  'backup.failed': (p) => ({ title: 'Dua: BACKUP FAILED', message: `The daily backup did not complete${dateOf(p)}. Check the Tools tab.`, priority: 5, tags: ['rotating_light'] }),
  'backup.stale': () => ({ title: 'Dua: no recent backup', message: 'No verified backup in the last 30 hours.', priority: 5, tags: ['rotating_light'] }),
  'restore_drill.failed': () => ({ title: 'Dua: restore drill failed', message: 'A backup could not be restored in the test. Check the Tools tab.', priority: 4, tags: ['warning'] }),
};

export function messageFor(kind: string, payload: Record<string, unknown>): PushMessage {
  const make = KNOWN[kind];
  if (make) return make(payload ?? {});
  const safeKind = KIND.test(kind) ? kind : 'unknown';
  return { title: 'Dua: alert', message: `Alert: ${safeKind}. Open Dua to see it.`, priority: 3, tags: ['bell'] };
}

// ---- Closing summary push -------------------------------------------------------------------------------------------
// Built from the JSON of public.closing_page_json(closing_id). Returns null when that JSON is not usable, so the caller
// can fall back to the generic text above.
type Obj = Record<string, unknown>;
const SLOT_LABEL: Record<string, string> = { night: 'Night', morning: 'Morning', evening: 'Evening', handover: 'Handover' };
const CREDIT_KIND_ORDER: Record<string, number> = { named: 0, tier: 1, free: 2 };
const MAX_CREDIT_LINES = 30;

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 32179 -> "Rs. 32,179"; -3000 -> "Rs. -3,000"; whole rupees unless the figure really has paisa.
export function rs(v: unknown): string {
  const n = Math.round(toNum(v) * 100) / 100;
  return `Rs. ${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// Staff-typed text: strip control characters, cap the length. A tier line is stored as "Evening Shift — Name"; show the name.
function cleanLabel(s: unknown, tier: boolean): string {
  let t = typeof s === 'string' ? s : '';
  if (tier && t.includes(' — ')) t = t.slice(t.lastIndexOf(' — ') + 3);
  return t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function closingMessage(page: unknown): PushMessage | null {
  const p = page as Obj | null;
  const inputs = p?.inputs as Obj | undefined;
  const res = p?.results as Obj | undefined;
  const date = p?.business_date;
  if (!p || !inputs || !res || typeof date !== 'string' || !DATE.test(date)) return null;

  const revision = toNum(inputs.revision);
  const reason = revision > 1 ? cleanLabel(inputs.correction_reason, false).slice(0, 160) : '';
  const isFinal = p.mode === 'final';
  const target = toNum(isFinal ? res.final_net_sale : res.net_sale);
  const variance = isFinal && res.final_variance != null ? toNum(res.final_variance) : toNum(res.shift_variance);
  const verdict = variance < 0 ? 'Less:' : variance > 0 ? 'Excess:' : 'Even';

  const credit = (Array.isArray(p.credit) ? (p.credit as Obj[]) : [])
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => toNum(l?.amount) !== 0)
    .sort((a, b) => (CREDIT_KIND_ORDER[String(a.l.kind)] ?? 3) - (CREDIT_KIND_ORDER[String(b.l.kind)] ?? 3) || a.i - b.i)
    .slice(0, MAX_CREDIT_LINES)
    .map(({ l }) => `${cleanLabel(l.label, l.kind === 'tier') || 'Credit'}: ${rs(l.amount)}`);
  const adj = toNum(inputs.credit_adj);
  if (adj !== 0) credit.push(`Credit adjustment: ${rs(adj)}`);

  const message = [
    ...(revision > 1 ? [`Revision ${revision}${reason ? `: ${reason}` : ''}`, ''] : []),
    `Net cash: ${rs(res.net_cash)}`,
    `Target sale: ${rs(target)}`,
    `Variance: ${rs(Math.abs(variance))} (${verdict})`,
    '',
    `Book Bills: ${rs(toNum(inputs.book_bill_1) + toNum(inputs.book_bill_2))}`,
    `Manual Returns: ${rs(toNum(inputs.ret_manual_1) + toNum(inputs.ret_manual_2) + toNum(inputs.ret_manual_3))}`,
    `Carried CC: ${rs(inputs.prev_cc)}`,
    `Total Deposits: ${rs(res.deposits_f)}`,
    '',
    `Opening Credit: ${rs(inputs.prev_credit)}`,
    ...credit,
    `Total Credit: ${rs(res.debt_e)}`,
  ].join('\n').slice(0, 3800); // ntfy's limit is 4096 bytes

  const slot = SLOT_LABEL[String(p.kind)] ?? 'Shift';
  return {
    title: `${revision > 1 ? 'Closing Corrected' : 'Closing'} - ${slot} ${date}${isFinal ? ' (Final)' : ''}`,
    message,
    priority: 3,
    tags: [revision > 1 ? 'memo' : 'white_check_mark', 'moneybag'],
  };
}

// ---- Audit round complete push --------------------------------------------------------------------------------------
// Built from the JSON of public.audit_round_alert_json(compilation_id). Markdown, like the old Audit Hub message. Returns null
// when that JSON is not usable. Long rounds drop their smallest differences until the text fits ntfy's size limit.
const MAX_BYTES = 3800; // ntfy's limit is 4096 bytes
const MINUS = '\u2212';
const byteLen = (t: string): number => new TextEncoder().encode(t).length;
const grouped = (n: number, dp: number): string => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: dp });
const signed = (n: number): string => (Math.round(n * 100) === 0 ? '0' : `${n < 0 ? MINUS : '+'}${grouped(n, 2)}`);
const signedRs = (n: number): string => (Math.round(n * 100) === 0 ? 'Rs 0' : `${n < 0 ? MINUS : '+'}Rs ${grouped(n, 2)}`);
const qty = (n: unknown): string => {
  const v = toNum(n);
  return `${v < 0 ? '-' : ''}${grouped(v, 3)}`;
};
// Names are typed by people: strip control characters and keep Markdown from reading them as formatting.
const mdText = (s: unknown, max: number): string =>
  cleanLabel(s, false).slice(0, max).replace(/([\\`*_~[\]<>#|])/g, '\\$1');

type AuditItem = { line: string; abs: number; pos: number };
type AuditGroup = { head: string; items: AuditItem[] };

export function auditRoundMessage(data: unknown): PushMessage | null {
  const p = data as Obj | null;
  if (!p || typeof p.date !== 'string' || !Array.isArray(p.companies)) return null;
  const round = `${Math.trunc(toNum(p.round))}${typeof p.suffix === 'string' ? p.suffix.replace(/[^A-Z]/g, '').slice(0, 1) : ''}`;
  const names = (Array.isArray(p.people) ? p.people : []).map((n) => mdText(n, 40)).filter(Boolean);
  const who = names.length === 0 ? '' : names.length <= 3 ? names.join(' & ') : `${names.slice(0, 2).join(' & ')} +${names.length - 2}`;
  const head = [
    `**Round ${round}${who ? ` \u00b7 ${who}` : ''} \u00b7 ${mdText(p.date, 20)}**`,
    '',
    `**${toNum(p.variance_count)} / ${toNum(p.item_count)} items differ**  `,
    `Short **${signed(toNum(p.short))}** \u00b7 Over **${signed(toNum(p.over))}**  `,
    `Net **${signed(toNum(p.net))}**`,
  ].join('\n');

  let order = 0;
  const groups: AuditGroup[] = (p.companies as Obj[]).map((c) => ({
    head: `\ud83c\udfe2 **${mdText(c.company, 80)} \u00b7 ${signedRs(toNum(c.net))}**`,
    items: (Array.isArray(c.items) ? (c.items as Obj[]) : []).map((i) => {
      const value = toNum(i.value);
      const code = mdText(i.code, 30);
      return {
        line: `- ${code ? `${code} \u00b7 ` : ''}${mdText(i.name, 80)}: ${qty(i.system)} \u2192 ${qty(i.counted)} \u00b7 ${signedRs(value)}`,
        abs: Math.abs(value),
        pos: order++,
      };
    }),
  }));

  const hidden = new Set<number>();
  const render = (): string => {
    const parts = [head];
    for (const g of groups) parts.push(['', g.head, ...g.items.filter((i) => !hidden.has(i.pos)).map((i) => i.line)].join('\n'));
    let text = parts.join('\n');
    if (hidden.size > 0) text += `\n\n_+${hidden.size} smaller difference${hidden.size === 1 ? '' : 's'} not shown. Open the Audit app._`;
    return text;
  };
  const all = groups.flatMap((g) => g.items).sort((a, b) => a.abs - b.abs || b.pos - a.pos);
  let text = render();
  for (const it of all) {
    if (byteLen(text) <= MAX_BYTES) break;
    hidden.add(it.pos);
    text = render();
  }
  while (byteLen(text) > MAX_BYTES) text = text.slice(0, Math.floor(text.length * 0.9)); // only if the headings alone are too long

  return { title: 'Audit Round Complete', message: text, priority: 5, tags: ['bar_chart'], markdown: true };
}

// Kinds the backup workflow may enqueue from outside the database. Everything else must come from inside Dua.
export const ENQUEUE_KINDS = ['backup.failed', 'restore_drill.failed'] as const;
export const canEnqueue = (kind: unknown): kind is (typeof ENQUEUE_KINDS)[number] =>
  typeof kind === 'string' && (ENQUEUE_KINDS as readonly string[]).includes(kind);

// Only a short, plain payload may come in from outside.
export function cleanExternalPayload(p: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>).slice(0, 10)) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

// ntfy accepts a JSON publish at the server root, which keeps the topic out of the URL and any error text.
export function buildPublish(server: string, topic: string, token: string | null, m: PushMessage) {
  const base = server.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return { url: `${base}/`, init: { method: 'POST', headers, body: JSON.stringify({ topic, title: m.title, message: m.message, priority: m.priority, tags: m.tags, ...(m.markdown ? { markdown: true } : {}) }) } };
}

export const validServer = (s: string): boolean => {
  try { return new URL(s).protocol === 'https:'; } catch { return false; }
};

// Error text is stored and shown to the owner, so it must never contain the topic or token.
export function scrubError(err: unknown, secrets: Array<string | null | undefined>): string {
  let text = err instanceof Error ? err.message : String(err);
  for (const s of secrets) if (s && s.length >= 4) text = text.split(s).join('***');
  return text.slice(0, 300);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// What the backup workflow may report. Everything is validated; nothing free-form is stored beyond a short error line.
export type BackupReport = {
  kind: 'daily' | 'weekly' | 'restore_drill'; status: 'ok' | 'failed'; day: string | null;
  size: number | null; sha: string | null; manifest: Record<string, { rows: string; md5: string }> | null; error: string | null;
};
export function cleanBackupReport(b: Record<string, unknown> | null): BackupReport | null {
  if (!b) return null;
  const kind = b.kind, status = b.status;
  if (kind !== 'daily' && kind !== 'weekly' && kind !== 'restore_drill') return null;
  if (status !== 'ok' && status !== 'failed') return null;
  const day = typeof b.day === 'string' && DATE.test(b.day) ? b.day : null;
  const size = typeof b.size_bytes === 'number' && Number.isInteger(b.size_bytes) && b.size_bytes >= 0 && b.size_bytes < 1e12 ? b.size_bytes : null;
  const sha = typeof b.sha256 === 'string' && /^[0-9a-f]{64}$/.test(b.sha256) ? b.sha256 : null;
  let manifest: BackupReport['manifest'] = null;
  if (b.manifest && typeof b.manifest === 'object') {
    const entries = Object.entries(b.manifest as Record<string, unknown>);
    if (entries.length > 200) return null;
    manifest = {};
    for (const [name, v] of entries) {
      const o = v as Record<string, unknown>;
      if (!/^[a-z0-9_.:]{1,80}$/.test(name) || typeof o?.rows !== 'string' || !/^\d{1,12}$/.test(o.rows) || typeof o?.md5 !== 'string' || !/^([0-9a-f]{32}|empty)$/.test(o.md5)) return null;
      manifest[name] = { rows: o.rows, md5: o.md5 };
    }
  }
  if (status === 'ok' && (!day || !size || !sha)) return null; // a success must say what it saved
  const error = typeof b.error === 'string' ? b.error.slice(0, 500) : null;
  return { kind, status, day, size, sha, manifest, error };
}
