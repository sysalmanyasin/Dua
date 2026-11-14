// The Closing Book as the old printed register: for every saved closing, page 1 is the shift sheet (three columns of cards and the Plus / Less
// banner) and page 2 is the Final page (Part 1 net final sale, Part 2 net final cash). The sheet MODEL is plain data built from one page of
// closing_book, so it can be tested without drawing anything; drawing turns it into a PDF with ./pdf.js. Every figure printed is one the database
// stored or worked out in migrations 0208 / 0210; nothing is calculated here except labelling.
import { Pdf, fit, textWidth } from './pdf.js';
import { slotLabel } from './slots.js';

const num = (v) => Number(v) || 0;
const has = (v) => v !== null && v !== undefined && v !== '';

/** 1234567 -> "1,234,567"; a fraction keeps two decimals; negatives keep their minus. */
export function fmt(v) {
  const n = num(v);
  const a = Math.abs(n);
  const s = Number.isInteger(a)
    ? a.toLocaleString('en-US')
    : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-${s}` : s;
}
const plus = (v) => `+ ${fmt(Math.abs(num(v)))}`;
const minus = (v) => `- ${fmt(Math.abs(num(v)))}`;
const dash = (v) => (num(v) === 0 ? '–' : fmt(v));

/** "Plus" / "Less" / "Matched": the direction in words, never colour alone. */
export const direction = (v) => (num(v) > 0 ? 'Plus' : num(v) < 0 ? 'Less' : 'Matched');

const row = (l, v = '', k = '') => ({ l, v: String(v), k });
const card = (title, rows, tone = 'dark') => ({ title, rows, tone });

export const closingTitle = (p) => `Closing ${p.day_no ?? '?'} — ${slotLabel(p.kind, p.seq)}`;

/** "Generated 14-Nov-2026, 04:39 am" in Karachi time. */
export function stamp(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.day}-${parts.month}-${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod ?? '').toLowerCase()}`;
}

const cashRows = (cash, area) =>
  (cash ?? [])
    .filter((c) => c.area === area && num(c.qty) !== 0)
    .sort((a, b) => b.denomination - a.denomination)
    .map((c) =>
      c.denomination === 1
        ? row('Coins / loose change', fmt(c.qty))
        : row(`Rs. ${Number(c.denomination).toLocaleString('en-US')} notes`, String(Math.round(num(c.qty)))),
    );

/** Page 1: the shift sheet as { header, cols: [[card]], banner }. */
export function shiftSheet(p) {
  const i = p.inputs ?? {};
  const r = p.results ?? {};
  const isFinal = p.mode === 'final';
  const till = [...cashRows(p.cash, 'till'), row('TOTAL TILL CASH', fmt(r.till_c), 'total')];
  const vault = [...cashRows(p.cash, 'vault'), row('TOTAL DRAW CASH', fmt(r.vault_d), 'total')];
  const deposits = [
    row('Carried from Previous', fmt(i.prev_deposits)),
    ...(p.deposits ?? []).map((d) => row(d.label || 'Deposit', fmt(d.amount))),
    row('TOTAL DEPOSITS', fmt(r.deposits_f), 'total'),
  ];
  const mediq = [
    ...(num(i.prev_mediq) !== 0 ? [row('Carried from Previous', fmt(i.prev_mediq))] : []),
    ...((p.mediq ?? []).length
      ? p.mediq.map((m) => row(`Bill ${m.bill_no || '-'} (pharmacy ${fmt(m.pharmacy_bill)})`, fmt(m.collected)))
      : [row('— no orders —', '', 'muted')]),
    row('EXTRA MEDIQ COLLECTED', fmt(r.mediq_extra), 'total'),
  ];
  const grand = [
    row('HS + Strips', fmt(p.hs_plus_strips)),
    row('Misc', fmt(r.misc_g)),
    row('CC (Card Sales)', fmt(r.cc_total)),
    row('Till Cash', fmt(r.till_c)),
    row('Draw Cash', fmt(r.vault_d)),
    row('Credit', fmt(r.debt_e)),
    row('Deposits', fmt(r.deposits_f)),
    row('GRAND TOTAL', fmt(r.grand), 'total'),
    row('Less: Cash Reserve (float)', minus(r.till_float)),
    row('Liquid Cash', fmt(r.liquid)),
    row('Less: Previous Cash Position', minus(r.prev_cash)),
    ...(num(i.extra_cash) !== 0 ? [row('Less: Extra Cash Added to Pharmacy', minus(i.extra_cash))] : []),
    row('NET CASH AVAILABLE', fmt(r.net_cash), 'net'),
  ];
  const hsStrips = [
    ...(p.strips ?? []).map((s) => row(`${s.label} ×${Math.round(num(s.qty))}`, fmt(s.amount ?? num(s.price) * num(s.qty)))),
    ...(p.hs ?? []).map((h) => row(h.label || 'HS', fmt(h.amount))),
    row('TOTAL HS + STRIPS', fmt(p.hs_plus_strips), 'total'),
  ];
  const misc = [...(p.misc ?? []).map((m) => row(m.label || 'Charge', fmt(m.amount))), row('TOTAL MISC', fmt(r.misc_g), 'total')];
  const sale = [
    row('Computer Cash Sale', fmt(i.sys_cash)),
    row('Shift Sale (POS delta)', fmt(r.shift_sale)),
    row('Sale Book 1', fmt(i.book_bill_1)),
    row('Sale Book 2', fmt(i.book_bill_2)),
    row('Customers', fmt(r.customers)),
    row('Last Bill #', String(Math.round(num(i.last_bill_no)))),
  ];
  const cc = [
    row('Bank Alfalah', fmt(i.alfalah)),
    row('Keenu Machine', fmt(i.keenu)),
    row('Computer Card Sale (–)', fmt(i.comp_sale)),
    row('Current CC', fmt(r.cc_curr)),
    row('Previous Day CC (carried)', fmt(i.prev_cc)),
    row('TOTAL CC', fmt(r.cc_total), 'total'),
  ];
  const returns = [
    row('Return 1', dash(i.ret_manual_1)),
    row('Return 2', dash(i.ret_manual_2)),
    row('Return 3', dash(i.ret_manual_3)),
    row('System Return', dash(i.ret_system)),
    row('TOTAL RETURNS', fmt(r.total_returns), 'total'),
    row('Extra MEDIQ Collected', fmt(r.mediq_extra)),
    row('NET SHIFT SALE', fmt(r.net_sale), 'net'),
  ];
  const credit = [
    row('Carried from Previous', fmt(i.prev_credit)),
    ...(p.credit ?? []).map((c) => row(c.label || 'Credit', fmt(c.amount))),
    ...(num(i.credit_adj) !== 0 ? [row('Credit adjustment', fmt(i.credit_adj))] : []),
    row('TOTAL CREDIT', fmt(r.debt_e), 'total'),
  ];
  const v = num(r.shift_variance);
  return {
    header: header(p, isFinal ? 'FINAL CLOSING' : 'SHIFT CLOSING', isFinal ? 'amber' : 'green'),
    cols: [
      [
        card('TILL CASH', till),
        card('DRAW / VAULT CASH', vault),
        card('DEPOSIT DETAILS', deposits),
        card('MEDIQ COD ORDERS', mediq),
        card('GRAND SUMMARY', grand, 'teal'),
      ],
      [card('HS DETAILS & STRIPS', hsStrips), card('MISCELLANEOUS CREDITS', misc)],
      [
        card('SALE INFO', sale),
        card('CREDIT CARD SALES (CC)', cc),
        card('RETURNS & NET SALE', returns, 'teal'),
        card('CREDIT DETAIL', credit),
      ],
    ],
    banner: {
      tone: v < 0 ? 'less' : v > 0 ? 'plus' : 'ok',
      title: `${direction(v).toUpperCase()} — NET CASH VS NET SALE`,
      amount: `Rs. ${fmt(Math.abs(v))}`,
      note: 'Net Cash Available minus Net Shift Sale. Zero means the till matches exactly.',
    },
    stripe: `${closingTitle(p).toUpperCase()} · ${p.business_date}`,
    stripeTone: isFinal ? 'amber' : 'green',
  };
}

function header(p, badge, tone) {
  const bits = [p.business_date, closingTitle(p), 'CLOSED'];
  if (Number(p.revision) > 1) bits.push(`Revision ${p.revision}`);
  return { title: p.shop?.title || 'Closing sheet', branch: (p.shop?.branch || '').toUpperCase(), badge, tone, line: bits.join(' · ') };
}

const chip = (s) =>
  `${new Date(`${s.business_date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })} · ${slotLabel(s.kind, s.seq)}`;

/** Page 2: the Final page. */
export function finalSheet(p) {
  const f = p.final_part;
  const r = p.results ?? {};
  const isFinal = p.mode === 'final';
  const p1 = f?.part1 ?? {};
  const p2 = f?.part2 ?? {};
  const cash = num(p2.net_final_cash);
  const sale = [
    row('POS Sale', plus(p1.pos_sale)),
    row('Book Bills', plus(p1.book_bills)),
    row('Customers', plus(p1.customers)),
    ...(num(p1.mediq_extra) !== 0 ? [row('MEDIQ Extra', plus(p1.mediq_extra))] : []),
    row('Manual Returns', minus(p1.manual_returns), 'neg'),
    row('System Returns', minus(p1.system_returns), 'neg'),
    row('Additional System Returns', num(p1.additional_system_returns) === 0 ? '- –' : minus(p1.additional_system_returns), 'neg'),
    row('NET FINAL SALE', fmt(p1.net_final_sale), 'net'),
  ];
  const cashRowsP2 = [
    row('Net Cash Available (after float)', fmt(p2.net_cash_available)),
    row('Pre-date POS Sales', plus(p2.pre_date_pos)),
    row('Pre-date Customers', plus(p2.pre_date_customers)),
    row('Pre-date System Returns', minus(p2.pre_date_system_returns), 'neg'),
    row('Pre-date Total (subtracted from Net Cash Available)', minus(p2.pre_date_total), 'neg'),
    row('Extra Cash Added to Pharmacy', minus(p2.extra_cash), 'neg'),
    row('Target Net Sale (Part 1 result)', minus(p2.target_net_sale), 'neg'),
    row('NET FINAL CASH AVAILABLE', fmt(p2.net_final_cash), 'net'),
  ];
  const own = isFinal ? r.final_variance : r.shift_variance;
  const agg = [
    row('Net Final Sale', fmt(p1.net_final_sale)),
    row(`Net Final Cash Available (${direction(cash)})`, fmt(p2.net_final_cash)),
    row(`${isFinal ? 'Final variance' : "This shift's variance"} (${direction(own)})`, fmt(Math.abs(num(own)))),
  ];
  const period = (f?.period ?? []).map(chip);
  return {
    header: header(p, 'FINAL CLOSING', 'amber'),
    infos: [
      ['DATE', p.business_date],
      ['CLOSING', closingTitle(p)],
      ['MODE', isFinal ? 'FINAL' : 'SHIFT'],
      ['STATUS', 'CLOSED'],
    ],
    period: {
      chips: period,
      note: f?.last_final
        ? `Since the last Final closing on ${f.last_final.business_date}.`
        : 'No earlier Final closing: the period starts at the first closing.',
    },
    part1: card('PART 1 — NET FINAL SALE', sale, 'amber'),
    part2: card('PART 2 — NET FINAL CASH AVAILABLE', cashRowsP2, 'amber'),
    aggregated: card('AGGREGATED FINAL CLOSING', agg),
    banner: {
      tone: cash < 0 ? 'less' : cash > 0 ? 'plus' : 'ok',
      title: `${direction(cash).toUpperCase()} — PERIOD RECONCILIATION`,
      amount: `Rs. ${fmt(Math.abs(cash))}`,
      note: 'Net Final Cash Available compared to Net Final Sale across the full period since the last Final Closing.',
    },
    warning:
      f && (f.ties?.sale === false || f.ties?.cash === false)
        ? 'An earlier closing in this period was corrected after this one was submitted, so the lines above no longer add up to the totals stored with this closing. The totals shown are the stored ones.'
        : '',
    missing: !has(f?.part1?.net_final_sale),
    stripe: `FINAL PAGE · ${closingTitle(p).toUpperCase()} · ${p.business_date}`,
  };
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────────────────────────
const C = {
  ink: '#10241f',
  teal: '#0f8a74',
  amber: '#8a5a14',
  bg: '#F5F6F3',
  white: '#FFFFFF',
  line: '#D5D9D3',
  total: '#ECEFEB',
  mint: '#E9F6F1',
  muted: '#6B756F',
  negbg: '#F8E2DC',
  negtx: '#B3342B',
  less: '#8F2D27',
  plus: '#1D7A4D',
  ok: '#10241F',
};
const TONE = { dark: C.ink, teal: C.teal, amber: C.amber, green: C.teal };
const BANNER = { less: C.less, plus: C.plus, ok: C.ok };
const X0 = 14;
const X1 = 198;
const BOTTOM = 281;

const rowH = (k, s) => (k === 'total' || k === 'net' ? 5.2 : 4.3) * s;
const cardH = (c, s) => 5.4 * s + c.rows.reduce((a, r) => a + rowH(r.k, s), 0) + 0.6;

function drawCard(pg, x, y, w, c, s) {
  const h = cardH(c, s);
  pg.rect(x, y, w, h, { fill: C.white, stroke: C.line, lw: 0.2, r: 1 });
  pg.rect(x, y, w, 5.4 * s, { fill: TONE[c.tone] ?? C.ink, r: 1 });
  pg.rect(x, y + 3 * s, w, 2.4 * s, { fill: TONE[c.tone] ?? C.ink });
  pg.text(c.title, x + 2.2, y + 3.75 * s, { font: 'helvB', size: 6.6 * s, color: '#FFFFFF' });
  let cy = y + 5.4 * s;
  for (const r of c.rows) {
    const h2 = rowH(r.k, s);
    const strong = r.k === 'total' || r.k === 'net';
    const fill = r.k === 'total' ? C.total : r.k === 'net' ? C.mint : r.k === 'neg' ? C.negbg : null;
    const ink = r.k === 'net' ? C.teal : r.k === 'neg' ? C.negtx : C.ink;
    if (fill) pg.rect(x + 0.1, cy, w - 0.2, h2, { fill });
    if (strong) pg.line(x + 0.1, cy, x + w - 0.1, cy, { stroke: r.k === 'net' ? C.teal : C.ink, lw: 0.45 });
    else pg.line(x + 1.5, cy + h2, x + w - 1.5, cy + h2, { stroke: '#E6E9E4', lw: 0.15 });
    const base = cy + h2 * 0.68;
    const vsize = (strong ? 7.8 : 7.4) * s;
    const vw = r.v ? textWidth(r.v, 'monoB', vsize) : 0;
    const quiet = r.k === 'muted' || r.k === 'more';
    const lfont = strong ? 'helvB' : quiet ? 'helvI' : 'helv';
    const lsize = (strong ? 6.6 : 7) * s;
    pg.text(fit(r.l, lfont, lsize, w - 4.4 - vw - 1.5), x + 2.2, base, {
      font: lfont,
      size: lsize,
      color: quiet ? C.muted : ink,
    });
    if (r.v) pg.text(r.v, x + w - 2.2, base, { font: 'monoB', size: vsize, color: ink, align: 'right' });
    cy += h2;
  }
  return h;
}

function wrap(text, font, size, maxMm) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(' ')) {
    const t = cur ? `${cur} ${word}` : word;
    if (textWidth(t, font, size) <= maxMm || !cur) cur = t;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function frame(pg, m, tone, stripeText, pageNo, pageCount, generated, shop) {
  pg.rect(0, 0, 210, 297, { fill: C.bg });
  pg.rect(0, 0, 7, 297, { fill: tone === 'amber' ? C.amber : C.ink });
  pg.text(stripeText, 4.5, 148 + textWidth(stripeText, 'mono', 5.6) / 2, { font: 'mono', size: 5.6, color: '#9FBDB3', up: true });
  const h = m.header;
  pg.text(fit(h.title, 'helvB', 15, 100), X0, 18.5, { font: 'helvB', size: 15, color: C.ink });
  if (h.branch) pg.text(h.branch, X0, 22.6, { font: 'helv', size: 6.3, color: C.muted });
  const bw = textWidth(h.badge, 'monoB', 6.6) + 7;
  pg.rect(X1 - bw, 12.2, bw, 5.2, { fill: h.tone === 'amber' ? C.amber : C.teal, r: 1.2 });
  pg.text(h.badge, X1 - bw / 2, 15.8, { font: 'monoB', size: 6.6, color: '#FFFFFF', align: 'center' });
  pg.text(fit(`${h.line} · Generated ${generated}`, 'helvB', 7.2, 120), X1, 21.6, {
    font: 'helvB',
    size: 7.2,
    color: C.ink,
    align: 'right',
  });
  pg.line(X0, 26, X1, 26, { stroke: C.ink, lw: 0.35 });
  pg.line(X0, 285.4, X1, 285.4, { stroke: C.line, lw: 0.2 });
  pg.text(`${shop || 'Closing sheet'} — Shift Register`, X0, 289.4, { size: 6.3, color: C.muted });
  pg.text(`Page ${pageNo} of ${pageCount} · Generated ${generated}`, X1, 289.4, { size: 6.3, color: C.muted, align: 'right' });
}

function drawBanner(pg, y, b, note = b.note) {
  pg.rect(X0, y, X1 - X0, 17, { fill: BANNER[b.tone], r: 1.5 });
  pg.text(b.title, X0 + 4, y + 6, { font: 'mono', size: 6.4, color: '#F2D4CF' });
  pg.text(b.amount, X0 + 4, y + 13.6, { font: 'monoB', size: 15, color: '#FFFFFF' });
  const lines = wrap(note, 'helvI', 6.3, 74);
  lines.forEach((l, k) => pg.text(l, X1 - 4, y + 7 + k * 3.2, { font: 'helvI', size: 6.3, color: '#F2D4CF', align: 'right' }));
}

/** Draws the shift sheet on a page. */
export function drawShiftPage(pg, p, pageNo, pageCount, generated) {
  const m = shiftSheet(p);
  const gap = 3.5;
  const colW = (X1 - X0 - 2 * gap) / 3;
  const y0 = 30;
  const heights = (sc) => m.cols.map((col) => col.reduce((a, c) => a + cardH(c, sc) + 2.4, 0));
  const fits = (sc) => y0 + Math.max(...heights(sc)) + 17 <= BOTTOM;
  // shrink a little while the text stays readable, then show the first rows of the longest card and say how many were left out
  let s = 1;
  for (const sc of [1, 0.94, 0.88, 0.82]) {
    s = sc;
    if (fits(sc)) break;
  }
  let guard = 0;
  while (!fits(s) && guard++ < 500) {
    const col = m.cols[heights(s).indexOf(Math.max(...heights(s)))];
    const big = col.reduce((a, c) => (c.rows.length > a.rows.length ? c : a), col[0]);
    const body = big.rows.filter((r) => !['total', 'net', 'more'].includes(r.k));
    if (body.length <= 3) break;
    big.hidden = (big.hidden ?? 0) + 1;
    body.pop();
    big.rows = [
      ...body,
      row(`… ${big.hidden} more rows not shown`, '', 'more'),
      ...big.rows.filter((r) => r.k === 'total' || r.k === 'net'),
    ];
  }
  frame(pg, m, m.stripeTone, m.stripe, pageNo, pageCount, generated, m.header.title);
  let bottom = y0;
  m.cols.forEach((col, ci) => {
    let y = y0;
    for (const c of col) y += drawCard(pg, X0 + ci * (colW + gap), y, colW, c, s) + 2.4 * s + (2.4 - 2.4 * s);
    bottom = Math.max(bottom, y);
  });
  drawBanner(pg, Math.min(bottom + 1.5, BOTTOM - 17), m.banner);
}

/** Draws the Final page. */
export function drawFinalPage(pg, p, pageNo, pageCount, generated) {
  const m = finalSheet(p);
  frame(pg, m, 'amber', m.stripe, pageNo, pageCount, generated, m.header.title);
  let y = 30;
  const bw = (X1 - X0 - 3 * 3) / 4;
  m.infos.forEach(([k, v], i) => {
    const x = X0 + i * (bw + 3);
    pg.rect(x, y, bw, 10, { fill: C.white, stroke: C.line, r: 1 });
    pg.text(k, x + 2.2, y + 3.6, { font: 'helvB', size: 5.4, color: C.muted });
    pg.text(fit(v, 'helvB', 8, bw - 4.4), x + 2.2, y + 8, { font: 'helvB', size: 8, color: C.ink });
  });
  y += 13;
  // shifts since the last Final
  pg.rect(X0, y, X1 - X0, 5.4, { fill: C.ink, r: 1 });
  pg.rect(X0, y + 3, X1 - X0, 2.4, { fill: C.ink });
  pg.text('SHIFTS SINCE LAST FINAL', X0 + 2.2, y + 3.75, { font: 'helvB', size: 6.6, color: '#FFFFFF' });
  let cx = X0 + 2.2;
  let cy = y + 6.4;
  let lineH = 6.6;
  for (const label of m.period.chips) {
    const w = textWidth(label, 'mono', 7) + 5;
    if (cx + w > X1 - 2) {
      cx = X0 + 2.2;
      cy += 6.6;
      lineH += 6.6;
    }
    pg.rect(cx, cy, w, 5, { fill: C.white, stroke: C.line, r: 2.5 });
    pg.text(label, cx + 2.5, cy + 3.5, { font: 'mono', size: 7, color: C.ink });
    cx += w + 2;
  }
  const noteY = y + 6.4 + lineH + 1.2;
  pg.text(m.period.note, X0 + 2.2, noteY + 1.8, { font: 'helvI', size: 6.4, color: C.muted });
  const periodH = 6.4 + lineH + 5;
  pg.rect(X0, y, X1 - X0, periodH, { stroke: C.line, r: 1 });
  y += periodH + 3;
  // part 1 and part 2
  const half = (X1 - X0 - 4) / 2;
  const h1 = cardH(m.part1, 1.1);
  const h2 = cardH(m.part2, 1.1);
  drawCard(pg, X0, y, half, m.part1, 1.1);
  drawCard(pg, X0 + half + 4, y, half, m.part2, 1.1);
  y += Math.max(h1, h2) + 3;
  const ha = drawCard(pg, X0, y, X1 - X0, m.aggregated, 1.1);
  y += ha + 3;
  drawBanner(pg, y, m.banner);
  y += 20;
  if (m.warning) {
    const lines = wrap(m.warning, 'helv', 7, X1 - X0 - 7);
    const h = 4 + lines.length * 3.6;
    pg.rect(X0, y, X1 - X0, h, { fill: '#FFF4DC', stroke: C.amber, lw: 0.3, r: 1 });
    lines.forEach((l, k) => pg.text(l, X0 + 3.5, y + 5 + k * 3.6, { size: 7, color: '#5C3B09' }));
  }
}

/** The whole Closing Book as a PDF: two pages for every closing, oldest first. `pages` come from closing_book (any order). */
export function buildClosingBookPdf(pages, { now = new Date(), title = 'Closing sheets' } = {}) {
  const sorted = [...pages].sort((a, b) =>
    (a.business_date + String(a.seq).padStart(5, '0')).localeCompare(b.business_date + String(b.seq).padStart(5, '0')),
  );
  const pdf = new Pdf({ title });
  const generated = stamp(now);
  const total = sorted.length * 2;
  sorted.forEach((p, i) => {
    drawShiftPage(pdf.addPage(), p, i * 2 + 1, total, generated);
    drawFinalPage(pdf.addPage(), p, i * 2 + 2, total, generated);
  });
  return pdf;
}

/** closing-pdf-2026-11-13_Evening.pdf for one closing; closing-pdf-FROM_to_TO.pdf for several. */
export function pdfFileName(pages) {
  if (!pages.length) return 'closing-pdf.pdf';
  const dates = pages.map((p) => p.business_date).sort();
  if (pages.length === 1) return `closing-pdf-${pages[0].business_date}_${slotLabel(pages[0].kind, pages[0].seq).replace(/\s+/g, '')}.pdf`;
  return `closing-pdf-${dates[0]}_to_${dates.at(-1)}.pdf`;
}
