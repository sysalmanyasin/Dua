/* global URL, console, process */
// Generates inventory-golden-engines.json: what the OLD app computes for the Reorder Report, Excess Working and the
// four Home numbers, on the same 401 invented products as inventory-golden.json plus deterministic sales-window fields.
// The reference functions are copied verbatim from the old app, repository sysalmanyasin/BT-Sale-Data2 at commit
// e560086f7b0422007a1d0cf1cc86f33ad9362491 (only the row field names are adapted at the edge, see `toOld`, and the clock
// and the in-transit map are injected instead of read from the page):
//   js/inventory/reorder-data.js     computeAllRows, lowCoverWithin, topNByValue
//   js/inventory/excess-working.js   computeRows, summarize, applyRecalcFilters
//   js/inventory/stockledger.js      computeAll, applyExcessRecalc (as in make-golden.mjs)
// The new JavaScript (domain/) and the new SQL (inventory_cover_summary) must both reproduce these numbers exactly.
// Run from the repository root:
//   node tests/fixtures/inventory-golden/make-golden-engines.mjs && npx prettier --write tests/fixtures/inventory-golden/inventory-golden-engines.json
import { readFileSync, writeFileSync } from 'node:fs';

process.env.TZ = 'Asia/Karachi'; // the old Reorder Report read the browser's local clock; the pharmacy is in Karachi

const golden = JSON.parse(readFileSync(new URL('./inventory-golden.json', import.meta.url), 'utf8'));
const NOW = new Date(golden.today); // 2026-11-12T10:00:00Z = 15:00 in Karachi
const TODAY = NOW;

// ── deterministic sales windows: n30 <= n60 <= n90, values from price, tax on some products ───────────────────────
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (x) => Math.round(x * 100) / 100;
const rows = golden.rows.map((row, i) => {
  const rnd = mulberry32(777000 + i);
  const n90 = Number(row.n90) || 0;
  const n60 = Math.floor(n90 * rnd());
  const n30 = Math.floor(n60 * rnd());
  const n0 = rnd() < 0.25 ? Math.floor(rnd() * 6) : 0;
  const taxable = rnd() < 0.4;
  const tax = taxable ? 17 : 0;
  const price = Number(row.price) || 0;
  const ve = (n) => r2(n * price);
  const vi = (n) => r2(n * price * (taxable ? 1.17 : 1));
  return {
    ...row,
    n0,
    n30,
    n60,
    n90,
    taxable,
    tax,
    ve0: ve(n0),
    ve30: ve(n30),
    ve60: ve(n60),
    ve90: ve(n90),
    vi0: vi(n0),
    vi30: vi(n30),
    vi60: vi(n60),
    vi90: vi(n90),
  };
});
// a few hand-made cases around the thresholds (appended; codes start with RO-)
const hand = (code, over) => ({
  code,
  name: `Item ${code}`,
  qty: 10,
  price: 10,
  company: 'Acme',
  generic: '',
  supplier: 'Sup One',
  pack: 10,
  created: '2025-01-01',
  received: '2026-10-01',
  sold: '2026-11-01',
  n0: 0,
  n30: 0,
  n60: 0,
  n90: 0,
  taxable: false,
  tax: 0,
  ve0: 0,
  ve30: 0,
  ve60: 0,
  ve90: 0,
  vi0: 0,
  vi30: 0,
  vi60: 0,
  vi90: 0,
  ...over,
});
rows.push(
  hand('RO-ZERO-SELLS', { qty: 0, n60: 60, n90: 90, ve60: 600, vi60: 600 }),
  hand('RO-NEG-SELLS', { qty: -4, n60: 30, n90: 45 }),
  hand('RO-COVER-29', { qty: 29, n60: 60, n90: 90 }), // 1 a day: 29 days of cover
  hand('RO-COVER-30', { qty: 30, n60: 60, n90: 90 }), // exactly 30 days: not below 30
  hand('RO-TODAY-ONLY', { qty: 5, n0: 3 }),
  hand('RO-NOSALES', { qty: 5 }),
  hand('RO-BLANKSUP', { qty: 2, n60: 30, n90: 30, supplier: '', company: 'Fallback Co' }),
  hand('RO-NOSUP-NOCO', { qty: 2, n60: 30, n90: 30, supplier: '', company: '' }),
  hand('RO-TAXED', { qty: 1, n60: 30, n90: 30, taxable: true, tax: 17, ve60: 300, vi60: 351 }),
);

// the parts of the old pipeline that came from the STR screens: units already moving to this branch
const transit = {};
rows.forEach((r, i) => {
  if (i % 17 === 0) transit[r.code] = (i % 5) + 1;
});

// ── reference: copied from the old app ─────────────────────────────────────────────────────────────────────────────
const toOld = (r) => ({
  ...r,
  stock: r.qty,
  unitPrice: r.price,
  conversionFactor: r.pack,
  lastReceiveDate: r.received,
  lastSaleDate: r.sold,
  creationDate: r.created,
  netQtyToday: r.n0,
  netQty30Days: r.n30,
  netQty60Days: r.n60,
  netQty90Days: r.n90,
  saleValueInclTaxToday: r.vi0,
  saleValueInclTax30Days: r.vi30,
  saleValueInclTax60Days: r.vi60,
  saleValueInclTax90Days: r.vi90,
  saleValueExclTaxToday: r.ve0,
  saleValueExclTax30Days: r.ve30,
  saleValueExclTax60Days: r.ve60,
  saleValueExclTax90Days: r.ve90,
  taxPercent: r.tax,
  isTaxable: r.taxable,
});
const WINDOWS = [30, 60, 90];
const inTransitByCode = transit;

function computeAllRows(rawRows, primaryWindow, coverDays, includeToday) {
  const now = NOW; // injected (the old code read new Date())
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayFraction = Math.min(1, Math.max(0, (now - startOfToday) / 86400000));
  const foldToday = includeToday !== false;
  const rows = rawRows.map((r) => {
    const stock = Number(r.stock) || 0;
    const unitPrice = Number(r.unitPrice) || 0;
    const isTaxable = !!r.isTaxable;
    const valueField = isTaxable ? 'saleValueInclTax' : 'saleValueExclTax';
    const todayQty = Number(r.netQtyToday) || 0;
    const rawTodayValue = r[valueField + 'Today'];
    const todayValue = rawTodayValue !== undefined && rawTodayValue !== null ? Number(rawTodayValue) : todayQty * unitPrice;
    const foldQty = foldToday ? todayQty : 0;
    const foldValue = foldToday ? todayValue : 0;
    const out = {
      code: r.code || '',
      name: r.name || '',
      supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unspecified',
      company: r.company || '',
      stock,
      unitPrice,
      inTransitQty: inTransitByCode[r.code] || 0,
      saleQtyToday: todayQty,
      saleValueToday: todayValue,
      isTaxable,
      taxPercent: Number(r.taxPercent) || 0,
    };
    WINDOWS.forEach((w) => {
      const historicalQty = Number(r['netQty' + w + 'Days']) || 0;
      const rawSaleValue = r[valueField + w + 'Days'];
      const historicalValue = rawSaleValue !== undefined && rawSaleValue !== null ? Number(rawSaleValue) : historicalQty * unitPrice;
      const saleQty = historicalQty + foldQty;
      const saleValue = historicalValue + foldValue;
      const windowEffectiveDays = w + (foldToday ? todayFraction : 0);
      const dailyRate = saleQty / windowEffectiveDays;
      const daysCover = dailyRate > 0 ? stock / dailyRate : null;
      const demandQty = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * coverDays - stock)) : 0;
      out['saleQty' + w] = saleQty;
      out['saleQty' + w + 'Historical'] = historicalQty;
      out['saleValue' + w] = saleValue;
      out['saleValue' + w + 'Historical'] = historicalValue;
      out['daysCover' + w] = daysCover;
      out['demandQty' + w] = demandQty;
    });
    out.saleQtyP = out['saleQty' + primaryWindow];
    out.saleValueP = out['saleValue' + primaryWindow];
    out.daysCoverP = out['daysCover' + primaryWindow];
    out.demandQtyP = out['demandQty' + primaryWindow];
    out.demandValueP = out.demandQtyP * unitPrice;
    return out;
  });
  return rows;
}
function lowCoverWithin(rows, coverDays) {
  return rows.filter((r) => r.saleQtyP > 0 && r.daysCoverP != null && r.daysCoverP < coverDays);
}
function topNByValue(rows, n) {
  return rows
    .filter((r) => r.saleQtyP > 0)
    .sort((a, b) => b.saleValueP - a.saleValueP)
    .slice(0, Math.max(1, n || 50));
}

function makeLedger(state) {
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
    items.forEach((it) => {
      const stock = Number(it.stock) || 0;
      const unitPrice = Number(it.unitPrice) || 0;
      const recDays = daysSince(it.lastReceiveDate);
      const saleDays = daysSince(it.lastSaleDate);
      const hasSale = !!it.lastSaleDate;
      const net100 = Number(it.netQty90Days) || 0;
      if (stock === 0) return;
      const packValid = isPackValid(it.conversionFactor);
      const pack = packValid ? Number(it.conversionFactor) : null;
      if (packValid) {
        if (!hasSale && recDays != null && recDays > state.neverSoldDays) {
          const dr = downRound(stock, pack);
          if (dr.qty > 0) neverSold.push({ ...it, value: dr.qty * unitPrice });
        }
        const win = state.deadDays;
        if (hasSale && saleDays != null && saleDays > win && recDays != null && recDays > win) {
          const dr = downRound(stock, pack);
          if (dr.qty > 0) deadStock.push({ ...it, value: dr.qty * unitPrice });
        }
      }
      const dailyRate = net100 / 90;
      const target100 = dailyRate * 100;
      const excessQty = stock - target100;
      const daysOld = daysSince(it.creationDate);
      const stockDays = dailyRate > 0 ? stock / dailyRate : null;
      if (net100 > 0 && excessQty > 0 && stock >= 4)
        excess.push({ ...it, stock, unitPrice, net100, target100, excessQty, excessValue: excessQty * unitPrice, daysOld, stockDays });
    });
    return { neverSold, deadStock, excess };
  }
  function applyExcessRecalc(list) {
    return list.filter((r) => {
      if (r.daysOld != null && r.daysOld < 90) return false;
      if (r.stockDays == null || r.stockDays < 200) return false;
      return true;
    });
  }
  return { computeAll, applyExcessRecalc };
}

// excess-working.js
function excessComputeRows(rawExcess, retainSet) {
  return rawExcess.map((r) => {
    const qty = Number(r.excessQty) || 0;
    const value = Number(r.excessValue) || 0;
    let factor = Number(r.conversionFactor);
    const packUnreliable = !(factor && factor > 0 && Number.isFinite(factor));
    if (packUnreliable) factor = 1;
    const packQty = Math.floor(qty / factor);
    let correctedValue = 0;
    if (qty > 0) correctedValue = Math.floor((value / qty) * (packQty * factor));
    let status;
    const nameKey = String(r.name || '')
      .trim()
      .toLowerCase();
    if (retainSet.has(nameKey)) status = 'Retained';
    else if (packQty === 0) status = 'Loose';
    else status = 'Excess';
    const excessContribution = status === 'Excess' ? correctedValue : 0;
    return {
      code: r.code,
      qty,
      value,
      factor,
      packUnreliable,
      packQty,
      correctedValue,
      status,
      excessContribution,
      daysOld: r.daysOld,
      stockDays: r.stockDays,
    };
  });
}
function excessSummarize(computed, misc, hoValue) {
  const totalRawValue = computed.reduce((s, r) => s + (r.value || 0), 0);
  const totalExcess = computed.filter((r) => r.status === 'Excess').reduce((s, r) => s + r.excessContribution, 0);
  const totalRetained = computed.filter((r) => r.status === 'Retained').reduce((s, r) => s + r.correctedValue, 0);
  const totalLoose = totalRawValue - totalRetained - totalExcess;
  const top10 = computed
    .filter((r) => r.status === 'Excess')
    .map((r) => r.excessContribution)
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((s, v) => s + v, 0);
  const correctedExcessStockValue = totalExcess - (misc || 0);
  let variance = null;
  if (hoValue !== null && hoValue !== '' && !isNaN(hoValue)) variance = Number(hoValue) - totalRawValue;
  return { totalRawValue, totalExcess, totalRetained, totalLoose, top10, correctedExcessStockValue, variance };
}
function applyRecalcFilters(rawExcess, st) {
  return rawExcess.filter((r) => {
    if (st.minAgeOn) {
      if (r.daysOld != null && r.daysOld < st.minAgeDays) return false;
    }
    if (st.minStockDaysOn) {
      if (r.stockDays == null || r.stockDays < st.minStockDays) return false;
    }
    return true;
  });
}

// ── run it ─────────────────────────────────────────────────────────────────────────────────────────────────────
const oldRows = rows.map(toOld);
const pickRow = (r) => ({
  code: r.code,
  supplier: r.supplier,
  stock: r.stock,
  inTransitQty: r.inTransitQty,
  saleQtyToday: r.saleQtyToday,
  saleValueToday: r.saleValueToday,
  saleQty30: r.saleQty30,
  saleQty60: r.saleQty60,
  saleQty90: r.saleQty90,
  daysCover30: r.daysCover30,
  daysCover60: r.daysCover60,
  daysCover90: r.daysCover90,
  demandQty30: r.demandQty30,
  demandQty60: r.demandQty60,
  demandQty90: r.demandQty90,
  saleValue30: r.saleValue30,
  saleValue60: r.saleValue60,
  saleValue90: r.saleValue90,
  saleValueP: r.saleValueP,
  saleQtyP: r.saleQtyP,
  daysCoverP: r.daysCoverP,
  demandQtyP: r.demandQtyP,
  demandValueP: r.demandValueP,
});
const reorder = [
  { window: 60, coverDays: 30, includeToday: false, topN: 50 },
  { window: 90, coverDays: 30, includeToday: false, topN: 20 },
  { window: 30, coverDays: 15, includeToday: false, topN: 10 },
  { window: 60, coverDays: 30, includeToday: true, topN: 50 },
  { window: 90, coverDays: 45, includeToday: true, topN: 100 },
].map((cfg) => {
  const all = computeAllRows(oldRows, cfg.window, cfg.coverDays, cfg.includeToday);
  const flagged = lowCoverWithin(all, cfg.coverDays);
  const top = lowCoverWithin(topNByValue(all, cfg.topN), cfg.coverDays);
  return { ...cfg, all: all.map(pickRow), flagged: flagged.map((r) => r.code), topNFlagged: top.map((r) => r.code) };
});

const ledger = makeLedger({ today: TODAY, neverSoldDays: 60, deadDays: 60 });
const L = ledger.computeAll(oldRows);
const retainNames = [rows[3].name, rows[40].name, rows[77].name, rows[120].name, rows[200].name, rows[300].name];
const retainSet = new Set(retainNames.map((x) => x.toLowerCase()));
const excessCases = [
  { minAgeOn: true, minAgeDays: 90, minStockDaysOn: true, minStockDays: 200, misc: 5000, hoValue: 12000000 },
  { minAgeOn: false, minAgeDays: 90, minStockDaysOn: false, minStockDays: 200, misc: 0, hoValue: '' },
  { minAgeOn: true, minAgeDays: 90, minStockDaysOn: false, minStockDays: 200, misc: 123.5, hoValue: 0 },
].map((st) => {
  const computed = excessComputeRows(applyRecalcFilters(L.excess, st), retainSet);
  return { ...st, rows: computed, summary: excessSummarize(computed, st.misc, st.hoValue) };
});

// the four Home numbers, from the old code: window 60 / cover 30 / today excluded for the reorder figure (stable all day)
const allR = computeAllRows(oldRows, 60, 30, false);
const reorderFlag = lowCoverWithin(allR, 30);
const excessDefault = ledger.applyExcessRecalc(L.excess);
const stockValue = rows.reduce((s, r) => s + (r.qty > 0 ? r.qty * r.price : 0), 0);
const cover = {
  stockValue,
  reorder: { count: reorderFlag.length, value: reorderFlag.reduce((s, r) => s + r.demandValueP, 0) },
  notSold: { count: L.neverSold.length + L.deadStock.length, value: [...L.neverSold, ...L.deadStock].reduce((s, r) => s + r.value, 0) },
  excess: { count: excessDefault.length, value: excessDefault.reduce((s, r) => s + r.excessValue, 0) },
};

writeFileSync(
  new URL('./inventory-golden-engines.json', import.meta.url),
  JSON.stringify({ now: NOW.toISOString(), rows, transit, reorder, retainNames, excess: excessCases, cover }),
);
// a slim copy for the SQL parity test (products and the four numbers only)
writeFileSync(new URL('./inventory-cover-fixture.json', import.meta.url), JSON.stringify({ now: NOW.toISOString(), rows, cover }));
console.log(`rows=${rows.length} transit=${Object.keys(transit).length}`);
console.log(
  'reorder',
  reorder
    .map(
      (c) => `[${c.window}/${c.coverDays}/${c.includeToday ? 'today' : 'hist'}] flagged=${c.flagged.length} topN=${c.topNFlagged.length}`,
    )
    .join(' | '),
);
console.log('excess', excessCases.map((c) => `rows=${c.rows.length} excess=${c.summary.totalExcess}`).join(' | '));
console.log('cover', JSON.stringify(cover));
