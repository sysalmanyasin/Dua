import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeLedger, DEFAULT_WINDOW_DAYS, sumValue } from '../../js/modules/inventory/domain/ledger.js';
import { joinProducts } from '../../js/modules/inventory/domain/join.js';
import { notSoldStock } from '../../js/modules/inventory/domain/metrics.js';
import { filterAndRank, score, SEARCH_FIELDS } from '../../js/modules/inventory/domain/search.js';
import { daysSince, downRound, isPackValid } from '../../js/modules/inventory/domain/stockMath.js';

// inventory-golden.json holds what the OLD app computes for 401 invented products (tests/fixtures/inventory-golden/make-golden.mjs
// runs the old code verbatim). The new code must give the same lists, in the same order, with the same numbers.
const golden = JSON.parse(readFileSync(new URL('../fixtures/inventory-golden/inventory-golden.json', import.meta.url), 'utf8'));
const today = new Date(golden.today);
const pick = (list, keys) => list.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));

describe('Stock Ledger lists match the old app', () => {
  for (const cfg of golden.configs) {
    it(`never sold ${cfg.neverSoldDays} days, dead stock ${cfg.deadDays} days`, () => {
      const r = computeLedger(golden.rows, { today, neverSoldDays: cfg.neverSoldDays, deadDays: cfg.deadDays });
      const e = cfg.expected;
      expect(pick(r.neverSold, ['code', 'packs', 'roundedQty', 'loose', 'value', 'recDays'])).toEqual(e.neverSold);
      expect(pick(r.deadStock, ['code', 'packs', 'roundedQty', 'loose', 'value', 'recDays', 'saleDays'])).toEqual(e.deadStock);
      expect(pick(r.excess, ['code', 'target100', 'excessQty', 'excessValue', 'daysOld', 'stockDays'])).toEqual(e.excess);
      expect(r.excessDefault.map((x) => x.code)).toEqual(e.excessDefault);
      expect(pick(r.packIssues, ['code', 'stockValue'])).toEqual(e.packIssues);
      expect(pick(r.zeroStock, ['code', 'recDays', 'saleDays'])).toEqual(e.zeroStock);
    });
  }

  it('the golden file really exercises every list (so a silent empty list cannot pass)', () => {
    const e = golden.configs[0].expected;
    for (const k of ['neverSold', 'deadStock', 'excess', 'excessDefault', 'packIssues', 'zeroStock'])
      expect(e[k].length).toBeGreaterThan(5);
  });
});

describe('ranked search matches the old app', () => {
  for (const s of golden.search) {
    it(`"${s.query}" finds ${s.codes.length}`, () => {
      expect(filterAndRank(golden.rows, s.query, SEARCH_FIELDS).map((x) => x.code)).toEqual(s.codes);
    });
  }
});

describe('boundaries, one product at a time', () => {
  const run = (cfg = {}) => computeLedger(golden.rows, { today, ...cfg });
  const codes = (list) => list.map((x) => x.code);

  it('the default window is 60 days for both lists (decision INV-10)', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(60);
    const r = run();
    expect(codes(r.neverSold)).toContain('NS-61');
    expect(codes(r.neverSold)).not.toContain('NS-60'); // exactly 60 days is not "more than 60"
  });

  it('never sold needs a receipt date and at least one whole pack', () => {
    const r = run();
    expect(codes(r.neverSold)).not.toContain('NS-NOREC');
    expect(codes(r.neverSold)).not.toContain('NS-LESSPACK'); // 7 units, pack of 10
    const one = r.neverSold.find((x) => x.code === 'NS-ONEPACK');
    expect(one).toMatchObject({ packs: 1, roundedQty: 10, loose: 9, value: 100 }); // 19 units, price 10: only the whole pack counts
  });

  it('dead stock needs BOTH the last sale and the last receipt older than the window', () => {
    const r = run();
    expect(codes(r.deadStock)).toContain('DS-61');
    expect(codes(r.deadStock)).not.toContain('DS-60');
    expect(codes(r.deadStock)).not.toContain('DS-RECENT-REC');
    expect(codes(r.deadStock)).toContain('DS-REC-61');
    expect(codes(r.deadStock)).not.toContain('DS-NOREC');
  });

  it('never sold and dead stock never overlap', () => {
    const r = run();
    const dead = new Set(codes(r.deadStock));
    expect(codes(r.neverSold).filter((c) => dead.has(c))).toEqual([]);
  });

  it('an unusable pack size keeps the product out of both lists and into pack issues', () => {
    const r = run();
    for (const c of ['PK-EMPTY', 'PK-ZERO', 'PK-NULL', 'PK-TEXT', 'PK-NEG']) {
      expect(codes(r.packIssues)).toContain(c);
      expect(codes(r.neverSold)).not.toContain(c);
      expect(codes(r.deadStock)).not.toContain(c);
    }
    expect(codes(r.neverSold)).toContain('PK-STR'); // "12" as text is a usable pack
    expect(codes(r.packIssues)).not.toContain('PK-STR');
  });

  it('a pack size the feed marks unusable (packValid false) is a pack issue even when the number looks fine', () => {
    const base = { code: 'PV', name: 'PV', qty: 30, price: 10, pack: 1, created: '', received: '2026-05-01', sold: '', n90: 0 };
    const r = computeLedger([base, { ...base, code: 'PV-OK', packValid: true }, { ...base, code: 'PV-BAD', packValid: false }], { today });
    expect(codes(r.packIssues)).toEqual(['PV-BAD']);
    expect(codes(r.neverSold)).toEqual(['PV', 'PV-OK']); // no flag at all (older rows) counts as usable
  });

  it('zero stock is listed apart; negative stock is not zero stock and never counts as a whole pack', () => {
    const r = run();
    expect(codes(r.zeroStock)).toContain('Z-ZERO');
    expect(codes(r.zeroStock)).not.toContain('Z-NEG');
    expect(codes(r.neverSold)).not.toContain('Z-NEG');
  });

  it('excess: 4 units minimum, 200 days of cover, 90 days old (a missing creation date counts as old enough)', () => {
    const r = run();
    expect(codes(r.excess)).not.toContain('EX-QTY3');
    expect(codes(r.excess)).toContain('EX-QTY4');
    expect(codes(r.excess)).not.toContain('EX-NOSALES');
    expect(codes(r.excess)).not.toContain('EX-EQUAL'); // stock equal to the 100-day target is not excess
    expect(codes(r.excess)).toContain('EX-JUSTOVER');
    expect(codes(r.excessDefault)).not.toContain('EX-COVER-199');
    expect(codes(r.excessDefault)).toContain('EX-COVER-200');
    expect(codes(r.excessDefault)).not.toContain('EX-AGE-89');
    expect(codes(r.excessDefault)).toContain('EX-AGE-90');
    expect(codes(r.excessDefault)).toContain('EX-NOCREATED');
  });

  it('values: pack-rounded for never sold and dead stock, every unit above target for excess', () => {
    const r = run();
    const ex = r.excess.find((x) => x.code === 'EX-QTY4');
    expect(ex.target100).toBeCloseTo((1 / 90) * 100, 10);
    expect(ex.excessValue).toBeCloseTo((4 - (1 / 90) * 100) * 10, 10);
    expect(sumValue(r.neverSold)).toBe(Math.round(r.neverSold.reduce((s, x) => s + x.roundedQty * x.unitPrice, 0)));
  });

  it('a wider window removes products, a narrower one adds them', () => {
    expect(run({ neverSoldDays: 90 }).neverSold.length).toBeLessThan(run({ neverSoldDays: 30 }).neverSold.length);
    expect(run({ deadDays: 365 }).deadStock.length).toBeLessThan(run({ deadDays: 30 }).deadStock.length);
  });
});

describe('"Stock not sold in N days" is one number, whole packs only (decision INV-17)', () => {
  const ago = (n) => new Date(Date.UTC(2026, 10, 12) - n * 86400000).toISOString().slice(0, 10);
  const row = (over) => ({
    code: 'T',
    name: 'T',
    qty: 10,
    price: 10,
    pack: 10,
    created: '',
    received: ago(200),
    sold: '',
    n90: 0,
    ...over,
  });

  it('equals the Never Sold list plus the Dead Stock list of the same window, for every window', () => {
    for (const days of [0, 30, 60, 90, 365]) {
      const h = notSoldStock(golden.rows, days, today);
      const l = computeLedger(golden.rows, { today, neverSoldDays: days, deadDays: days });
      expect(h.count).toBe(l.neverSold.length + l.deadStock.length);
      expect(h.value).toBe(sumValue([...l.neverSold, ...l.deadStock]));
      expect(h.neverSold.map((r) => r.code)).toEqual(l.neverSold.map((r) => r.code));
      expect(h.deadStock.map((r) => r.code)).toEqual(l.deadStock.map((r) => r.code));
    }
  });

  it('defaults to a 60-day window', () => {
    expect(notSoldStock(golden.rows, undefined, today).count).toBe(notSoldStock(golden.rows, 60, today).count);
  });

  it('counts whole packs only: seven loose units of a pack of ten are worth nothing, nineteen are worth one pack', () => {
    expect(notSoldStock([row({ qty: 7 })], 60, today)).toMatchObject({ count: 0, value: 0 });
    expect(notSoldStock([row({ qty: 19 })], 60, today)).toMatchObject({ count: 1, value: 100 });
  });

  it('does not count a product received recently, even when its last sale is old', () => {
    expect(notSoldStock([row({ sold: ago(300), received: ago(30) })], 60, today).count).toBe(0);
  });

  it('does not count a product whose pack size cannot be trusted', () => {
    expect(notSoldStock([row({ pack: 0 })], 60, today).count).toBe(0);
    expect(notSoldStock([row({ packValid: false })], 60, today).count).toBe(0);
  });

  it('does not count zero stock, and an empty list gives zero', () => {
    expect(notSoldStock([row({ qty: 0 })], 60, today).count).toBe(0);
    expect(notSoldStock([], 60, today)).toMatchObject({ count: 0, value: 0 });
  });
});

describe('small helpers', () => {
  it('daysSince counts whole days including the time of day, and null for no date', () => {
    expect(daysSince('2026-11-02', new Date('2026-11-12T10:00:00Z'))).toBe(10);
    expect(daysSince('', new Date())).toBeNull();
    expect(daysSince('not a date', new Date())).toBeNull();
  });
  it('downRound keeps whole packs only', () => {
    expect(downRound(19, 10)).toEqual({ packs: 1, qty: 10, loose: 9 });
    expect(downRound(5, 0)).toEqual({ packs: 5, qty: 5, loose: 0 });
  });
  it('isPackValid accepts numbers above zero (also as text) and nothing else', () => {
    for (const v of [1, 2.5, '12']) expect(isPackValid(v)).toBe(true);
    for (const v of ['', null, undefined, 0, -1, 'abc', NaN, Infinity]) expect(isPackValid(v)).toBe(false);
  });
  it('search score ladder', () => {
    expect(score('Panadol', 'panadol')).toBe(100);
    expect(score('Panadol Extra', 'pana')).toBe(95);
    expect(score('Extra Panadol', 'nad')).toBe(85);
    expect(score('Panadol Extra Strong', 'strong panadol')).toBe(80);
    expect(score('Panadol', 'pnl')).toBe(35);
    expect(score('Panadol', 'zz')).toBe(0);
  });
  it('joinProducts adds the sales half, or zeros when a product has none, or nothing without permission', () => {
    const stock = [
      { code: 'A', qty: 1 },
      { code: 'B', qty: 2 },
    ];
    const sales = new Map([['A', { code: 'A', n90: 7 }]]);
    expect(joinProducts(stock, sales)).toEqual([{ code: 'A', qty: 1, n90: 7 }, expect.objectContaining({ code: 'B', n90: 0, n30: 0 })]);
    expect(joinProducts(stock, null)).toEqual(stock);
  });
});
