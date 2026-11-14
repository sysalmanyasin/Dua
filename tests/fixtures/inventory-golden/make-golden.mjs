// Generates inventory-golden.json: the numbers the OLD app produces for a fixed set of invented products.
// The reference functions below are copied verbatim (only the names of the row fields were adapted at the edge, see
// `toOld`) from the old app, repository sysalmanyasin/BT-Sale-Data2 at commit e560086f7b0422007a1d0cf1cc86f33ad9362491:
//   js/inventory/stockledger.js   computeAll, applyExcessRecalc, daysSince, downRound, isPackValid
//   js/shared/inventory-metrics.js isNotSold, notSoldStock
//   js/lib/bt-search.js           BTSearch.score, filterAndRank
// The new code (js/modules/inventory/domain) must reproduce these numbers exactly.
// Run from the repository root: node tests/fixtures/inventory-golden/make-golden.mjs && npx prettier --write tests/fixtures/inventory-golden/inventory-golden.json
/* global URL, console */
import { writeFileSync } from 'node:fs';

const TODAY = new Date('2026-11-12T10:00:00Z');
const DAY = 86400000;
const ago = (n) => (n == null ? '' : new Date(Date.UTC(2026, 10, 12) - n * DAY).toISOString().slice(0, 10));

// ── deterministic invented products ────────────────────────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261112);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const WORDS = [
  'Para',
  'Panadol',
  'Cough',
  'Syrup',
  'Tablet',
  'Cream',
  'Gel',
  'Drops',
  'Vita',
  'Zinc',
  'Calcium',
  'Iron',
  'Amox',
  'Brufen',
  'Nasal',
  'Spray',
];
const COMPANIES = ['Acme', 'Beta Co', 'Gamma', 'Delta Pharma', 'Unassigned Manufacturer'];
const SUPPLIERS = ['Sup One', 'Sup Two', 'Sup Three', 'Unassigned Supplier'];

const base = (code, over) => ({
  code,
  name: `Item ${code}`,
  qty: 10,
  price: 10,
  company: 'Acme',
  generic: 'Gen',
  supplier: 'Sup One',
  pack: 10,
  created: ago(400),
  received: ago(100),
  sold: ago(100),
  n0: 0,
  n30: 0,
  n60: 0,
  n90: 0,
  ...over,
});

const hand = [
  // zero stock and negative stock
  base('Z-ZERO', { qty: 0 }),
  base('Z-NEG', { qty: -5, sold: '' }),
  // never sold: boundary at the window (60 and 90 are the windows used below)
  base('NS-60', { sold: '', received: ago(60) }),
  base('NS-61', { sold: '', received: ago(61) }),
  base('NS-90', { sold: '', received: ago(90) }),
  base('NS-91', { sold: '', received: ago(91) }),
  base('NS-NOREC', { sold: '', received: '' }),
  base('NS-LESSPACK', { sold: '', received: ago(200), qty: 7, pack: 10 }),
  base('NS-ONEPACK', { sold: '', received: ago(200), qty: 19, pack: 10 }),
  // dead stock: boundaries on sale and on receipt
  base('DS-60', { sold: ago(60), received: ago(300) }),
  base('DS-61', { sold: ago(61), received: ago(300) }),
  base('DS-RECENT-REC', { sold: ago(300), received: ago(30) }),
  base('DS-REC-61', { sold: ago(300), received: ago(61) }),
  base('DS-NOREC', { sold: ago(300), received: '' }),
  base('DS-120', { sold: ago(120), received: ago(120) }),
  // unusable pack sizes
  base('PK-EMPTY', { pack: '', sold: '', received: ago(200) }),
  base('PK-ZERO', { pack: 0, sold: ago(200), received: ago(200) }),
  base('PK-NULL', { pack: null, sold: ago(200), received: ago(200) }),
  base('PK-TEXT', { pack: 'abc', sold: ago(200), received: ago(200) }),
  base('PK-NEG', { pack: -3, sold: ago(200), received: ago(200) }),
  base('PK-STR', { pack: '12', sold: '', received: ago(200), qty: 30 }),
  base('PK-FRAC', { pack: 2.5, sold: '', received: ago(200), qty: 11 }),
  base('PK-ONE', { pack: 1, sold: '', received: ago(200), qty: 3 }),
  // excess thresholds
  base('EX-QTY3', { qty: 3, n90: 1, created: ago(400) }),
  base('EX-QTY4', { qty: 4, n90: 1, created: ago(400) }),
  base('EX-NOSALES', { qty: 500, n90: 0 }),
  base('EX-LOWRATE', { qty: 100, n90: 9 }),
  base('EX-COVER-199', { qty: 199, n90: 90 }),
  base('EX-COVER-200', { qty: 200, n90: 90 }), // 1 unit a day: 199 and 200 days of cover
  base('EX-NEW', { qty: 400, n90: 10, created: ago(30) }),
  base('EX-AGE-89', { qty: 400, n90: 10, created: ago(89) }),
  base('EX-AGE-90', { qty: 400, n90: 10, created: ago(90) }),
  base('EX-NOCREATED', { qty: 400, n90: 10, created: '' }),
  base('EX-EQUAL', { qty: 100, n90: 90 }),
  base('EX-JUSTOVER', { qty: 101, n90: 90 }),
  // "not sold in N days" headline definition
  base('NSD-NODATE-NOSALES', { sold: '', n90: 0 }),
  base('NSD-NODATE-SALES', { sold: '', n90: 5 }),
  base('NSD-OLD', { sold: ago(200) }),
  base('NSD-RECENT', { sold: ago(5), n90: 4 }),
  base('NSD-EXACT', { sold: ago(90) }),
  base('NSD-TEXTQTY', { qty: '1,200', price: '3.5', sold: ago(300) }),
];

const random = [];
for (let i = 1; i <= 360; i++) {
  const hasSale = rnd() > 0.15;
  const sold = hasSale ? ago(int(0, 400)) : '';
  const stockKind = rnd();
  random.push({
    code: `R${String(i).padStart(4, '0')}`,
    name: `${pick(WORDS)} ${pick(WORDS)} ${int(1, 500)}${rnd() > 0.5 ? ' mg' : ''}`,
    qty: stockKind < 0.08 ? 0 : stockKind < 0.1 ? -int(1, 5) : int(1, 800),
    price: Math.round(rnd() * 5000) / 10,
    company: pick(COMPANIES),
    generic: rnd() > 0.4 ? pick(WORDS) : '',
    supplier: pick(SUPPLIERS),
    pack: rnd() < 0.06 ? pick(['', 0, null, 'x']) : pick([1, 1, 2, 3, 6, 10, 12, 20, 24, 30, 50, 100]),
    created: rnd() > 0.05 ? ago(int(0, 900)) : '',
    received: rnd() > 0.05 ? ago(int(0, 500)) : '',
    sold,
    n0: 0,
    n30: 0,
    n60: 0,
    n90: hasSale && rnd() > 0.3 ? int(0, 400) : 0,
  });
}
const rows = [...hand, ...random];

// ── reference implementation: copied from the old app ──────────────────────────────────────────────────────────
const toOld = (r) => ({
  ...r,
  stock: r.qty,
  unitPrice: r.price,
  conversionFactor: r.pack,
  lastReceiveDate: r.received,
  lastSaleDate: r.sold,
  creationDate: r.created,
  netQty90Days: r.n90,
});

function makeOld(state) {
  function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysSince(str) {
    const d = parseDate(str);
    if (!d) return null;
    return Math.floor((state.today - d) / 86400000);
  }
  function downRound(stock, pack) {
    const p = pack && pack > 0 ? pack : 1;
    const packs = Math.floor(stock / p);
    return { packs, qty: packs * p, loose: stock - packs * p };
  }
  function isPackValid(raw) {
    const n = Number(raw);
    return raw !== '' && raw != null && Number.isFinite(n) && n > 0;
  }
  function computeAll(items) {
    const neverSold = [];
    const deadStock = [];
    const excess = [];
    const packIssues = [];
    const zeroStock = [];
    items.forEach((it, i) => {
      const _row = i + 2;
      const stock = Number(it.stock) || 0;
      const unitPrice = Number(it.unitPrice) || 0;
      const recDays = daysSince(it.lastReceiveDate);
      const saleDays = daysSince(it.lastSaleDate);
      const hasSale = !!it.lastSaleDate;
      const net100 = Number(it.netQty90Days) || 0;
      if (stock === 0) {
        zeroStock.push({ ...it, unitPrice, recDays, saleDays, net100, _row });
        return;
      }
      const packValid = isPackValid(it.conversionFactor);
      const pack = packValid ? Number(it.conversionFactor) : null;
      if (!packValid) {
        packIssues.push({ ...it, stock, unitPrice, recDays, saleDays, net100, _row, stockValue: stock * unitPrice });
      } else {
        if (!hasSale && recDays != null && recDays > state.neverSoldDays) {
          const dr = downRound(stock, pack);
          if (dr.qty > 0)
            neverSold.push({
              ...it,
              stock,
              pack,
              unitPrice,
              _row,
              recDays,
              packs: dr.packs,
              roundedQty: dr.qty,
              loose: dr.loose,
              value: dr.qty * unitPrice,
            });
        }
        const win = state.deadDays;
        if (hasSale && saleDays != null && saleDays > win && recDays != null && recDays > win) {
          const dr = downRound(stock, pack);
          if (dr.qty > 0)
            deadStock.push({
              ...it,
              stock,
              pack,
              unitPrice,
              _row,
              recDays,
              saleDays,
              packs: dr.packs,
              roundedQty: dr.qty,
              loose: dr.loose,
              value: dr.qty * unitPrice,
            });
        }
      }
      const dailyRate = net100 / 90;
      const target100 = dailyRate * 100;
      const excessQty = stock - target100;
      const daysOld = daysSince(it.creationDate);
      const stockDays = dailyRate > 0 ? stock / dailyRate : null;
      if (net100 > 0 && excessQty > 0 && stock >= 4) {
        excess.push({
          ...it,
          stock,
          unitPrice,
          net100,
          target100,
          _row,
          excessQty,
          excessValue: excessQty * unitPrice,
          daysOld,
          stockDays,
        });
      }
    });
    return { neverSold, deadStock, excess, packIssues, zeroStock };
  }
  const EXCESS_MIN_AGE_DAYS = 90;
  const EXCESS_MIN_STOCK_DAYS = 200;
  function applyExcessRecalc(list) {
    return list.filter((r) => {
      if (r.daysOld != null && r.daysOld < EXCESS_MIN_AGE_DAYS) return false;
      if (r.stockDays == null || r.stockDays < EXCESS_MIN_STOCK_DAYS) return false;
      return true;
    });
  }
  return { computeAll, applyExcessRecalc };
}

const num = (v) => {
  const x = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const qtyOf = (r) => num(r && (r.qty != null ? r.qty : r.stock));
const priceOf = (r) => num(r && (r.price != null ? r.price : r.unitPrice));
function isNotSold(row, days = 90, now = Date.now()) {
  if (!row || qtyOf(row) <= 0) return false;
  const last = row.lastSaleDate ? new Date(row.lastSaleDate).getTime() : NaN;
  if (Number.isFinite(last)) return last < now - days * 86400000;
  return num(row.netQty90Days) <= 0;
}
function notSoldStock(list, days = 90, now = Date.now()) {
  const hit = (Array.isArray(list) ? list : [])
    .filter((r) => isNotSold(r, days, now))
    .map((r) => ({ row: r, value: qtyOf(r) * priceOf(r) }))
    .sort((a, b) => b.value - a.value);
  return { count: hit.length, value: Math.round(hit.reduce((s, x) => s + x.value, 0)), rows: hit.map((x) => x.row) };
}
const BTSearch = {
  norm(s) {
    return String(s || '')
      .toLowerCase()
      .trim();
  },
  score(text, query) {
    const t = BTSearch.norm(text);
    const q = BTSearch.norm(query);
    if (!q) return 50;
    if (t === q) return 100;
    if (t.startsWith(q)) return 95;
    if (t.includes(q)) return 85;
    const qWords = q.split(/\s+/);
    if (qWords.length > 1 && qWords.every((w) => t.includes(w))) return 80;
    if (qWords.some((w) => w.length >= 2 && t.includes(w))) return 60;
    if (q.length >= 3) {
      let ti = 0;
      for (let qi = 0; qi < q.length; qi++) {
        while (ti < t.length && t[ti] !== q[qi]) ti++;
        if (ti >= t.length) return 0;
        ti++;
      }
      return 35;
    }
    return 0;
  },
  filterAndRank(items, query, fields) {
    if (!query) return items;
    const scored = (items || []).map((item) => ({
      item,
      score: (fields || ['title']).reduce((max, f) => {
        const s = BTSearch.score(item[f] || '', query);
        return s > max ? s : max;
      }, 0),
    }));
    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  },
};

// ── run it ─────────────────────────────────────────────────────────────────────────────────────────────────────
const oldRows = rows.map(toOld);
const configs = [
  [60, 60],
  [90, 60],
  [30, 120],
  [0, 0],
  [365, 365],
].map(([neverSoldDays, deadDays]) => {
  const { computeAll, applyExcessRecalc } = makeOld({ today: TODAY, neverSoldDays, deadDays });
  const r = computeAll(oldRows);
  return {
    neverSoldDays,
    deadDays,
    expected: {
      neverSold: r.neverSold.map((x) => ({
        code: x.code,
        packs: x.packs,
        roundedQty: x.roundedQty,
        loose: x.loose,
        value: x.value,
        recDays: x.recDays,
      })),
      deadStock: r.deadStock.map((x) => ({
        code: x.code,
        packs: x.packs,
        roundedQty: x.roundedQty,
        loose: x.loose,
        value: x.value,
        recDays: x.recDays,
        saleDays: x.saleDays,
      })),
      excess: r.excess.map((x) => ({
        code: x.code,
        target100: x.target100,
        excessQty: x.excessQty,
        excessValue: x.excessValue,
        daysOld: x.daysOld,
        stockDays: x.stockDays,
      })),
      excessDefault: applyExcessRecalc(r.excess).map((x) => x.code),
      packIssues: r.packIssues.map((x) => ({ code: x.code, stockValue: x.stockValue })),
      zeroStock: r.zeroStock.map((x) => ({ code: x.code, recDays: x.recDays, saleDays: x.saleDays })),
    },
  };
});

const NOW = TODAY.getTime();
const notSold = [30, 60, 90, 180].map((days) => {
  const r = notSoldStock(oldRows, days, NOW);
  return { days, count: r.count, value: r.value, codes: r.rows.map((x) => x.code) };
});

const QUERIES = [
  '',
  'para',
  'PANADOL',
  'cough syrup',
  'zinc 2',
  'pnl',
  'ab',
  'x',
  'gel drops',
  'acme',
  'sup two',
  'ITEM NS-6',
  'no such thing',
  'mg',
  'iron',
  'vit',
];
const search = QUERIES.map((query) => ({
  query,
  codes: BTSearch.filterAndRank(rows, query, ['code', 'name', 'generic', 'company', 'supplier']).map((x) => x.code),
}));

writeFileSync(
  new URL('./inventory-golden.json', import.meta.url),
  JSON.stringify({ today: TODAY.toISOString(), rows, configs, notSold, search }),
);
console.log(
  `rows=${rows.length}`,
  configs
    .map(
      (c) =>
        `[${c.neverSoldDays}/${c.deadDays}] ns=${c.expected.neverSold.length} ds=${c.expected.deadStock.length} ex=${c.expected.excess.length}/${c.expected.excessDefault.length} pk=${c.expected.packIssues.length} z=${c.expected.zeroStock.length}`,
    )
    .join(' | '),
);
console.log('notSold', notSold.map((n) => `${n.days}d:${n.count}/${n.value}`).join(' '));
console.log('search', search.map((s) => `"${s.query}":${s.codes.length}`).join(' '));
