// The daily Sale Report. One row list feeds the screen view, print, e-mail HTML and plain text,
// so they can never disagree. Layout, wording and rules are carried over from the original app.
import { escapeHtml as esc } from '../../../shared/html.js';

const n = (v) => Number(v) || 0;
const round = (x) => Math.floor(x + 0.5);

// Same format as the original: whole rupees, a plain minus, and "0" for nothing.
export function fv(v) {
  const r = round(n(v));
  if (r === 0) return '0';
  const s = Math.abs(r).toLocaleString('en-US');
  return r < 0 ? `-${s}` : s;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const reportDate = (iso) => `${iso.slice(8, 10)}/${MON[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

// Built-in row id -> payment method code.
export const ROW_CODES = {
  cashSale: 'cash_sale',
  meezan: 'meezan_bank',
  alfalah: 'bank_alfalah',
  alHabib: 'bank_al_habib',
  hbl: 'hbl',
  mcb: 'mcb',
  cashRet: 'cash_returns',
  pso: 'pso',
  nespak: 'nespak',
  parco: 'parco',
  askari: 'askari_bank',
  lda: 'lda',
  tepa: 'tepa',
  fissue: 'f_issue',
  gourmet: 'gourmet',
  wapda: 'wapda_hospital',
  bth: 'bth',
  berger: 'berger_paints',
  ecolean: 'ecolean_pk',
  style_t: 'style_textile',
  babar: 'syed_babar_ali',
  rahnuma: 'rahnuma_ngo',
  healthP: 'health_pass',
  nisar: 'nisar_spinning',
  foodP: 'food_panda',
  psoRet: 'pso_returns',
  nespakRet: 'nespak_returns',
  parcoRet: 'parco_returns',
  tepaRet: 'tepa_returns',
  ldaRet: 'lda_returns',
  askariRet: 'askari_returns',
};
const BUILTIN = new Set(Object.values(ROW_CODES));
const RETURN_IDS = new Set(['cashRet', 'psoRet', 'nespakRet', 'parcoRet', 'tepaRet', 'ldaRet', 'askariRet']);

// Rows people can switch off in "Customize Rows".
export const ROW_CATALOG = {
  'Cash Sale': [
    ['cashSale', 'Cash Sale'],
    ['meezan', 'Meezan Bank'],
    ['alfalah', 'Bank Alfalah'],
    ['alHabib', 'Bank Al Habib'],
    ['hbl', 'HBL'],
    ['mcb', 'MCB'],
    ['cashRet', 'Cash Returns'],
  ],
  'Credit Sale': [
    ['pso', 'PSO'],
    ['nespak', 'Nespak'],
    ['parco', 'Parco'],
    ['askari', 'Askari'],
    ['lda', 'LDA'],
    ['tepa', 'Tepa'],
    ['fissue', 'Free Issue'],
    ['gourmet', 'Gourmet'],
    ['wapda', 'Wapda Hospital'],
    ['bth', 'BTH'],
    ['berger', 'Berger Paints'],
    ['ecolean', 'Ecolean PK'],
    ['style_t', 'Style Textile'],
    ['babar', 'Syed Babar Ali Foundation'],
    ['rahnuma', 'Rahnuma NGO'],
    ['healthP', 'Health Pass'],
    ['nisar', 'Nisar Spinning Mills'],
    ['foodP', 'Food Panda'],
    ['psoRet', 'Credit Return PSO'],
    ['nespakRet', 'Credit Return Nespak'],
    ['parcoRet', 'Credit Return Parco'],
    ['tepaRet', 'Credit Return Tepa'],
    ['ldaRet', 'Credit Return LDA'],
    ['askariRet', 'Askari Returns'],
  ],
  Other: [
    ['compSale', 'COMP SALE'],
    ['diff', 'Difference (Total − COMP)'],
    ['fdpp', 'FDPP POS Sale'],
    ['fdppCon', 'FDPP Consumer POS Sale'],
    ['customers', 'Customers'],
    ['amtRec', 'Amount Received'],
    ['cashDepo', 'Cash to be Deposited'],
    ['loadSale', 'Load Sale'],
    ['till', 'Till Short'],
    ['patty', 'Patty Cash'],
  ],
};

// Figures for one day. `lines` are { method_code, amount }, `methods` the payment method list, `day` the saved header.
// Returns are always taken as deductions, whatever sign was typed; client columns keep their sign.
export function dayFigures(day, lines, methods) {
  const by = new Map(lines.map((l) => [l.method_code, n(l.amount)]));
  const v = {};
  for (const [id, code] of Object.entries(ROW_CODES)) {
    const x = by.get(code) ?? 0;
    v[id] = RETURN_IDS.has(id) ? -Math.abs(x) : x;
  }
  const custom = [];
  for (const m of methods) {
    if (BUILTIN.has(m.code) || m.sign === 'none') continue;
    const raw = by.get(m.code) ?? 0;
    custom.push({ id: m.code, label: m.label, value: m.sign === 'sub' ? -Math.abs(raw) : raw, cash: m.section !== 'Credit Clients' });
  }
  const cashIds = ['cashSale', 'meezan', 'alfalah', 'alHabib', 'hbl', 'mcb', 'cashRet'];
  const creditIds = Object.keys(ROW_CODES).filter((id) => !cashIds.includes(id));
  const netCash = cashIds.reduce((s, id) => s + v[id], 0) + custom.filter((c) => c.cash).reduce((s, c) => s + c.value, 0);
  const netCredit = creditIds.reduce((s, id) => s + v[id], 0) + custom.filter((c) => !c.cash).reduce((s, c) => s + c.value, 0);
  const total = n(day.total);
  return {
    ...v,
    custom,
    netCash,
    netCredit,
    grand: netCash + netCredit,
    compSale: n(day.comp_sale),
    diff: round(total - n(day.comp_sale)),
    fdpp: n(day.fdpp_pos),
    fdppCon: n(day.fdpp_consumer),
    customers: n(day.customers),
    amtRec: n(day.amount_received),
    loadSale: n(day.load_sale),
    cashDepo: n(day.cash_to_deposit),
  };
}

const SALES = 'Sales Only';
const RETS = 'Returns Only';
// kind: 'always' (shown unless hidden) | 'opt' (shown only when not zero)
const A = (id, label, note) => ({ id, label, note, kind: 'always' });
const O = (id, label) => ({ id, label, kind: 'opt' });

// The ordered report. `hidden` is a Set of row ids the person switched off.
export function buildReport(fig, { till = 0, patty = 0, hidden = new Set() } = {}) {
  const vis = (id) => !hidden.has(id);
  const pick = (defs) =>
    defs
      .filter((d) => vis(d.id) && (d.kind === 'always' || fig[d.id] !== 0))
      .map((d) => ({ id: d.id, label: d.label, note: d.note, value: fig[d.id] }));
  const cust = (cash) =>
    fig.custom.filter((c) => c.cash === cash && vis(c.id) && c.value !== 0).map((c) => ({ id: c.id, label: c.label, value: c.value }));
  const cashRows = [
    ...pick([
      A('cashSale', 'Cash Sale', SALES),
      A('meezan', 'Meezan Bank'),
      A('alfalah', 'Bank Alfalah'),
      A('alHabib', 'Bank Al Habib'),
      O('hbl', 'HBL'),
      O('mcb', 'MCB'),
      A('cashRet', 'Cash Returns', RETS),
    ]),
    ...cust(true),
  ];
  const creditRows = [
    ...pick([
      A('pso', 'PSO', SALES),
      A('nespak', 'Nespak', SALES),
      A('parco', 'Parco', SALES),
      A('askari', 'Askari'),
      A('lda', 'LDA', SALES),
      A('tepa', 'Tepa'),
      A('fissue', 'Free Issue'),
      O('gourmet', 'Gourmet'),
      O('wapda', 'Wapda Hospital'),
      O('bth', 'BTH'),
      O('berger', 'Berger Paints'),
      O('ecolean', 'Ecolean PK'),
      O('style_t', 'Style Textile'),
      O('babar', 'Syed Babar Ali Foundation'),
      O('rahnuma', 'Rahnuma NGO'),
      O('healthP', 'Health Pass'),
      O('nisar', 'Nisar Spinning Mills'),
      O('foodP', 'Food Panda'),
      A('psoRet', 'Credit Return PSO', RETS),
      A('nespakRet', 'Credit Return Nespak', RETS),
      A('parcoRet', 'Credit Return Parco', RETS),
      A('tepaRet', 'Credit Return Tepa', RETS),
      A('ldaRet', 'Credit Return LDA', RETS),
      O('askariRet', 'Askari Returns'),
    ]),
    ...cust(false),
  ];
  // A comparison only makes sense when there is a COMP SALE figure (the original showed the whole total as the difference when it was missing).
  const hasComp = Boolean(fig.compSale);
  const misc = [];
  if (vis('compSale') && hasComp) misc.push({ id: 'compSale', label: 'COMP SALE', value: fig.compSale });
  if (vis('diff') && hasComp)
    misc.push({
      id: 'diff',
      label: 'Difference (Total − COMP)',
      value: fig.diff,
      tone: fig.diff > 0 ? 'pos' : fig.diff < 0 ? 'neg' : 'zero',
      strong: true,
    });
  if (vis('fdpp')) misc.push({ id: 'fdpp', label: 'FDPP POS Sale:', value: fig.fdpp, red: true });
  if (vis('fdppCon')) misc.push({ id: 'fdppCon', label: 'FDPP Consumer POS Sale:', value: fig.fdppCon, red: true });
  if (vis('customers')) misc.push({ id: 'customers', label: 'Customers', value: fig.customers, strong: true });
  if (vis('till')) misc.push({ id: 'till', label: 'Till Short', value: n(till) });
  if (vis('patty')) misc.push({ id: 'patty', label: 'Patty Cash', value: n(patty) });
  return { cashRows, creditRows, netCash: fig.netCash, netCredit: fig.netCredit, grand: fig.grand, misc };
}

export const reportTitle = (branch) => `${String(branch).toUpperCase()} SALE REPORT`;
export const reportSubject = (branch, iso) => `${branch} Sale Report — ${reportDate(iso)}`;

// ── plain text ──
export function buildPlainText(rep, { branch, date }) {
  const line = (l, v) => l.padEnd(35) + fv(v);
  const lbl = (r) => r.label;
  const out = [
    reportTitle(branch),
    `Date: ${reportDate(date)}`,
    '',
    'Cash Sale:',
    ...rep.cashRows.map((r) => line(lbl(r), r.value)),
    `Net Cash Sale: ${fv(rep.netCash)}`,
    '',
    'Credit Sale:',
    ...rep.creditRows.map((r) => line(lbl(r), r.value)),
    `Net Credit Sale: ${fv(rep.netCredit)}`,
    '',
    `Grand Total: ₨${fv(rep.grand)}`,
  ];
  for (const m of rep.misc) out.push(m.id === 'diff' ? `${m.label}: ${fv(m.value)}` : line(m.label.replace(/:$/, ''), m.value));
  return out.join('\n');
}

// ── e-mail / clipboard HTML (inline styles on purpose: mail programs ignore stylesheets) ──
export function buildEmailHtml(rep, { branch, date }) {
  const td = (x, extra = '') => `padding:8px 14px;border:1px solid #ccc;${extra}${x}`;
  const row = (r) =>
    `<tr><td style="${td('font-size:13px;')}">${esc(r.label)}${r.note ? ` (${esc(r.note)})` : ''}</td><td style="${td('font-size:14px;text-align:right;font-family:monospace;')}">${fv(r.value)}</td></tr>`;
  const head = (t) =>
    `<tr><td colspan="2" style="text-align:center;font-size:14px;font-weight:800;padding:8px;background:#f8fafc;border:1px solid #ccc;text-decoration:underline;text-decoration-style:double;letter-spacing:.03em">${t}</td></tr>`;
  const net = (t, v) =>
    `<tr><td style="padding:9px 14px;font-size:13px;font-weight:700;color:#c00;background:#fff5f5;border:1px solid #fecaca">${t}</td><td style="padding:9px 14px;font-size:14px;font-weight:700;color:#c00;text-align:right;font-family:monospace;background:#fff5f5;border:1px solid #fecaca">${fv(v)}</td></tr>`;
  const tone = { pos: '#15803d', neg: '#c00', zero: '#64748b' };
  const misc = (m) =>
    m.id === 'diff'
      ? `<tr><td style="padding:8px 14px;font-size:13px;font-weight:700;border:2px solid #000;color:${tone[m.tone]}">${esc(m.label)}</td><td style="padding:8px 14px;font-size:14px;font-weight:700;text-align:right;font-family:monospace;border:2px solid #000;color:${tone[m.tone]}">${fv(m.value)}</td></tr>`
      : `<tr><td style="${td(`font-size:12px;${m.red ? 'color:#c00;' : ''}${m.red || m.strong ? 'font-weight:600;' : ''}`)}">${esc(m.label)}</td><td style="${td('font-size:13px;text-align:right;font-family:monospace;')}">${fv(m.value)}</td></tr>`;
  return `<div style="max-width:520px;margin:0;font-family:Arial,sans-serif"><table style="width:100%;border-collapse:collapse;border:1px solid #000">
    <tr><td colspan="2" style="background:#000;color:#fff;text-align:center;font-size:14px;font-weight:700;padding:10px;letter-spacing:.04em;border:1px solid #000">${esc(reportTitle(branch))}</td></tr>
    <tr><td style="${td('font-size:13px;font-weight:600;')}">Date:</td><td style="${td('font-size:13px;text-align:right;color:#c00;font-weight:700;')}">${esc(reportDate(date))}</td></tr>
    ${head('Cash Sale:')}${rep.cashRows.map(row).join('')}${net('Net Cash Sale:', rep.netCash)}
    ${head('Credit Sale:')}${rep.creditRows.map(row).join('')}${net('Net Credit Sale:', rep.netCredit)}
    <tr><td style="padding:13px 14px;font-size:17px;font-weight:800;color:#fff;background:#1e3a8a;border:2px solid #fbbf24;letter-spacing:.02em">Grand Total:</td><td style="padding:13px 14px;font-size:18px;font-weight:800;color:#fff;text-align:right;font-family:monospace;background:#1e3a8a;border:2px solid #fbbf24">₨${fv(rep.grand)}</td></tr>
    ${rep.misc.map(misc).join('')}</table></div>`;
}

// ── monthly target card ──
export function targetProgress(target, actual) {
  if (!target) return null;
  const pct = Math.min(100, Math.round((actual / target) * 100));
  return { pct, tone: pct >= 100 ? 'g' : pct >= 75 ? 'a' : 'r', remaining: Math.max(0, target - actual) };
}
