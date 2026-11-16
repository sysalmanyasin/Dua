import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeCover } from '../../js/modules/inventory/domain/cover.js';
import { csvCell, toCsv } from '../../js/modules/inventory/domain/csv.js';
import {
  applyRecalcFilters,
  computeExcessRows,
  retainKey,
  summarizeExcess,
  topExcessRows,
} from '../../js/modules/inventory/domain/excess.js';
import { computeHealth, healthCounts, supplierBreakdown, topMovers } from '../../js/modules/inventory/domain/health.js';
import { computeLedger } from '../../js/modules/inventory/domain/ledger.js';
import {
  computeReorderRows,
  lowCoverWithin,
  reorderLists,
  sortRows,
  todayFraction,
  topNByValue,
} from '../../js/modules/inventory/domain/reorder.js';

// inventory-golden-engines.json holds what the OLD app computes (make-golden-engines.mjs runs the old code verbatim).
const g = JSON.parse(readFileSync(new URL('../fixtures/inventory-golden/inventory-golden-engines.json', import.meta.url), 'utf8'));
const now = new Date(g.now);

describe('Reorder Report matches the old app', () => {
  it('the clock fraction is the Karachi time of day (15:00 = 0.625)', () => {
    expect(todayFraction(now)).toBeCloseTo(0.625, 10);
    expect(todayFraction(new Date('2026-11-12T19:00:00Z'))).toBeCloseTo(0, 10); // midnight in Karachi
  });

  for (const cfg of g.reorder) {
    it(`window ${cfg.window}, cover ${cfg.coverDays}, today ${cfg.includeToday ? 'folded in' : 'excluded'}: every number of every product`, () => {
      const opts = { window: cfg.window, coverDays: cfg.coverDays, includeToday: cfg.includeToday, now, inTransit: g.transit };
      const all = computeReorderRows(g.rows, opts);
      expect(all).toHaveLength(cfg.all.length);
      all.forEach((r, i) => {
        const e = cfg.all[i];
        for (const k of Object.keys(e)) {
          if (typeof e[k] === 'number') expect(r[k], `${r.code} ${k}`).toBeCloseTo(e[k], 9);
          else if (e[k] === null) expect(r[k], `${r.code} ${k}`).toBeNull();
          else expect(r[k], `${r.code} ${k}`).toBe(e[k]);
        }
      });
      const lists = reorderLists(g.rows, { ...opts, topN: cfg.topN });
      expect(lists.flagged.map((r) => r.code)).toEqual(cfg.flagged);
      expect(lists.topN.map((r) => r.code)).toEqual(cfg.topNFlagged);
    });
  }

  it('the threshold cases: 29 days of cover is flagged, exactly 30 is not; zero and negative stock that sells is flagged; nothing sold is never flagged', () => {
    const flagged = (code) =>
      lowCoverWithin(computeReorderRows(g.rows, { window: 60, coverDays: 30, includeToday: false, now }), 30).some((r) => r.code === code);
    expect(flagged('RO-COVER-29')).toBe(true);
    expect(flagged('RO-COVER-30')).toBe(false);
    expect(flagged('RO-ZERO-SELLS')).toBe(true);
    expect(flagged('RO-NEG-SELLS')).toBe(true);
    expect(flagged('RO-NOSALES')).toBe(false);
  });

  it('today alone makes a product sell when today is folded in, and not otherwise', () => {
    const f = (includeToday) =>
      computeReorderRows(g.rows, { window: 60, coverDays: 30, includeToday, now }).find((r) => r.code === 'RO-TODAY-ONLY');
    expect(f(true).saleQtyP).toBe(3);
    expect(f(false).saleQtyP).toBe(0);
  });

  it('the supplier falls back to the company, then to Unspecified; taxable products use the tax-inclusive value', () => {
    const rows = computeReorderRows(g.rows, { window: 60, coverDays: 30, includeToday: false, now });
    expect(rows.find((r) => r.code === 'RO-BLANKSUP').supplier).toBe('Fallback Co');
    expect(rows.find((r) => r.code === 'RO-NOSUP-NOCO').supplier).toBe('Unspecified');
    expect(rows.find((r) => r.code === 'RO-TAXED').saleValue60).toBe(351);
  });

  it('sorting: text as text, a missing days-of-cover counts as never urgent', () => {
    const rows = [
      { k: 'b', daysCover60: null },
      { k: 'a', daysCover60: 5 },
      { k: 'c', daysCover60: 1 },
    ];
    expect(sortRows(rows, 'daysCover60', 1).map((r) => r.k)).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, 'k', 1).map((r) => r.k)).toEqual(['a', 'b', 'c']);
  });

  it('topNByValue only ranks products that sold and keeps at least one slot', () => {
    const all = computeReorderRows(g.rows, { window: 60, coverDays: 30, includeToday: false, now });
    const top = topNByValue(all, 5);
    expect(top).toHaveLength(5);
    expect(top.every((r) => r.saleQtyP > 0)).toBe(true);
    expect(topNByValue(all, 0).length).toBe(50); // 0 means the default
  });
});

describe('Excess Working matches the old app', () => {
  const ledgerExcess = computeLedger(g.rows, { today: now, neverSoldDays: 60, deadDays: 60 }).excess;
  const retain = new Set(g.retainNames.map(retainKey));

  g.excess.forEach((c, i) => {
    it(`scenario ${i + 1}: filters ${c.minAgeOn ? 'age ' : ''}${c.minStockDaysOn ? 'cover ' : ''}${!c.minAgeOn && !c.minStockDaysOn ? 'off' : 'on'}, misc ${c.misc}`, () => {
      const rows = computeExcessRows(applyRecalcFilters(ledgerExcess, c), retain);
      expect(rows.map((r) => r.code)).toEqual(c.rows.map((r) => r.code));
      rows.forEach((r, j) => {
        const e = c.rows[j];
        expect(r.status, r.code).toBe(e.status);
        expect(r.packUnreliable, r.code).toBe(e.packUnreliable);
        expect(r.packQty, r.code).toBe(e.packQty);
        expect(r.factor, r.code).toBe(e.factor);
        expect(r.correctedValue, r.code).toBe(e.correctedValue);
        expect(r.excessContribution, r.code).toBe(e.excessContribution);
        expect(r.qty, r.code).toBeCloseTo(e.qty, 9);
        expect(r.value, r.code).toBeCloseTo(e.value, 6);
      });
      const s = summarizeExcess(rows, c.misc, c.hoValue);
      for (const k of ['totalRawValue', 'totalExcess', 'totalRetained', 'totalLoose', 'top10', 'correctedExcessStockValue'])
        expect(s[k], k).toBeCloseTo(c.summary[k], 4);
      if (c.summary.variance === null) expect(s.variance).toBeNull();
      else expect(s.variance).toBeCloseTo(c.summary.variance, 4);
    });
  });

  it('the scenarios exercise all three statuses', () => {
    const statuses = new Set(g.excess[1].rows.map((r) => r.status));
    expect([...statuses].sort()).toEqual(['Excess', 'Loose', 'Retained']);
  });

  it('a pack size the feed marks unusable counts as 1, so every unit is a whole pack', () => {
    const raw = { code: 'X', name: 'X', excessQty: 25, excessValue: 250, pack: 10, packValid: false, daysOld: 400, stockDays: 300 };
    const [r] = computeExcessRows([raw], new Set());
    expect(r).toMatchObject({ packUnreliable: true, factor: 1, packQty: 25, correctedValue: 250, status: 'Excess' });
    const [ok] = computeExcessRows([{ ...raw, packValid: true }], new Set());
    expect(ok).toMatchObject({ packUnreliable: false, factor: 10, packQty: 2, correctedValue: 200 });
  });

  it('top list ranks by corrected value and hides retained and loose products', () => {
    const rows = computeExcessRows(applyRecalcFilters(ledgerExcess, g.excess[1]), retain);
    const top = topExcessRows(rows, 5);
    expect(top).toHaveLength(5);
    expect(top.every((r) => r.status === 'Excess')).toBe(true);
    expect(top.map((r) => r.correctedValue)).toEqual([...top.map((r) => r.correctedValue)].sort((a, b) => b - a));
  });

  it('the head-office comparison appears only when a value is entered', () => {
    expect(summarizeExcess([], 0, '').variance).toBeNull();
    expect(summarizeExcess([], 0, null).variance).toBeNull();
    expect(summarizeExcess([{ status: 'Excess', value: 100, correctedValue: 90, excessContribution: 90 }], 10, 150)).toMatchObject({
      variance: 50,
      correctedExcessStockValue: 80,
    });
  });
});

describe('the four Home numbers match the old app (the JavaScript half of the parity test)', () => {
  it('stock value, reorder, not sold (whole packs), excess', () => {
    const c = computeCover(g.rows, now);
    expect(c.stockValue).toBeCloseTo(g.cover.stockValue, 4);
    expect(c.reorder.count).toBe(g.cover.reorder.count);
    expect(c.reorder.value).toBeCloseTo(g.cover.reorder.value, 4);
    expect(c.notSold.count).toBe(g.cover.notSold.count);
    expect(c.notSold.value).toBeCloseTo(g.cover.notSold.value, 4);
    expect(c.excess.count).toBe(g.cover.excess.count);
    expect(c.excess.value).toBeCloseTo(g.cover.excess.value, 4);
  });
});

describe('Health', () => {
  const rows = g.rows;
  const health = computeHealth(rows, { now });

  it('every product gets exactly one class and the counts add up', () => {
    const counts = healthCounts(health);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length);
    for (const k of ['reorder', 'excess', 'dead', 'neverSold', 'zeroStock', 'healthy']) expect(counts[k], k).toBeGreaterThan(0);
  });

  it('Never Sold and Dead Stock classes are exactly the Stock Ledger lists (one definition)', () => {
    const l = computeLedger(rows, { today: now, neverSoldDays: 60, deadDays: 60 });
    expect(health.filter((h) => h.flag === 'neverSold').map((h) => h.code)).toEqual(l.neverSold.map((r) => r.code));
    expect(health.filter((h) => h.flag === 'dead').map((h) => h.code)).toEqual(l.deadStock.map((r) => r.code));
  });

  it('first match wins: zero stock beats everything', () => {
    expect(health.find((h) => h.code === 'Z-ZERO').flag).toBe('zeroStock');
    expect(health.find((h) => h.code === 'RO-ZERO-SELLS').flag).toBe('zeroStock');
  });

  it('reorder and excess use the 60-day rate, falling back to 30 then 90 days', () => {
    const one = (over) =>
      computeHealth(
        [{ code: 'T', name: 'T', qty: 10, price: 1, pack: 1, received: '2026-11-01', sold: '2026-11-10', n30: 0, n60: 0, n90: 0, ...over }],
        { now },
      )[0];
    expect(one({ n60: 60 }).coverDays).toBe(10); // 1 a day
    expect(one({ n30: 30 }).coverDays).toBe(10); // 60-day empty: 30-day rate
    expect(one({ n90: 90 }).coverDays).toBe(10); // then the 90-day rate
    expect(one({ n60: 60 }).flag).toBe('reorder'); // under 30 days
    expect(one({ n60: 6, qty: 100 }).flag).toBe('excess'); // 1000 days
    expect(one({ qty: 5 }).coverDays).toBe(Infinity);
    expect(one({ n60: 60, qty: 25 }).flag).toBe('reorder'); // 25 days: under 30
    expect(one({ n60: 60, qty: 30 }).flag).toBe('healthy'); // exactly 30 days is not reorder
    expect(one({ n60: 60, qty: 89 }).flag).toBe('healthy');
    expect(one({ n60: 60, qty: 90 }).flag).toBe('excess'); // 90 days of cover
  });

  it('supplier breakdown and movers', () => {
    const s = supplierBreakdown(health, 3);
    expect(s).toHaveLength(3);
    expect(s[0][1]).toBeGreaterThanOrEqual(s[1][1]);
    const m = topMovers(health, 4);
    expect(m).toHaveLength(4);
    expect(m.every((r) => r.saleValue30 > 0)).toBe(true);
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Infinity)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });
  it('stops a spreadsheet from running a product name as a formula, but leaves negative numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5')).toBe('-5');
  });
  it('writes a header row, CRLF line ends and a byte-order mark', () => {
    expect(
      toCsv([
        ['Code', 'Name'],
        ['A1', 'Panadol, 500mg'],
      ]),
    ).toBe('\ufeffCode,Name\r\nA1,"Panadol, 500mg"\r\n');
  });
});
