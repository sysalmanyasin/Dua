import { describe, expect, it } from 'vitest';
import { computeTotal } from '../../js/modules/sales/domain/totals.js';
import {
  buildEmailHtml,
  buildPlainText,
  buildReport,
  dayFigures,
  fv,
  reportDate,
  reportSubject,
  targetProgress,
  ROW_CATALOG,
  ROW_CODES,
} from '../../js/modules/sales/domain/saleReport.js';

const methods = [
  ...Object.entries(ROW_CODES).map(([id, code]) => ({ code, label: id, sign: /Ret$|cashRet/.test(id) ? 'sub' : 'add', section: 'x' })),
  { code: 'c_bank_alfalah_2', label: 'Bank Alfalah 2', sign: 'add', section: 'Banks' },
  { code: 'c_mediq', label: 'MEDIQ', sign: 'add', section: 'Credit Clients' },
  { code: 'c_state_life', label: 'State Life Insurance', sign: 'add', section: 'Credit Clients' },
];
// The figures printed on the original app's report for 04/Nov/2026 (owner's screenshot).
const lines = [
  ['cash_sale', 352788],
  ['bank_alfalah', 108539],
  ['cash_returns', -30197],
  ['c_bank_alfalah_2', 158403],
  ['askari_bank', 14212],
  ['c_state_life', 11013],
].map(([method_code, amount]) => ({ method_code, amount }));
const day = { total: 614758, comp_sale: 589781, fdpp_pos: 477, fdpp_consumer: 162, customers: 639 };

describe('figures match the original report (4 Nov 2026)', () => {
  const fig = dayFigures(day, lines, methods);
  it('net cash, net credit and grand total', () => {
    expect(fig.netCash).toBe(589533);
    expect(fig.netCredit).toBe(25225);
    expect(fig.grand).toBe(614758);
    expect(fig.diff).toBe(24977);
  });
  it('the grand total equals the database TOTAL rule for any mix of lines', () => {
    const asLines = lines.map((l) => ({ method: l.method_code, amount: l.amount }));
    const dbMethods = methods.map((m) => ({ code: m.code, sign: m.sign }));
    expect(computeTotal(asLines, dbMethods)).toBe(fig.grand);
    const odd = [
      { method_code: 'pso', amount: -5000 },
      { method_code: 'pso_returns', amount: 700 },
      { method_code: 'cash_sale', amount: 10000.5 },
      { method_code: 'lda_returns', amount: -300 },
    ];
    const f2 = dayFigures({ total: 0 }, odd, methods);
    const expected = computeTotal(
      odd.map((l) => ({ method: l.method_code, amount: l.amount })),
      methods.map((m) => ({ code: m.code, sign: m.sign })),
    );
    expect(Math.floor(f2.grand + 0.5)).toBe(expected);
  });
});

describe('the report rows', () => {
  const fig = dayFigures(day, lines, methods);
  const rep = buildReport(fig, { till: 0, patty: 0 });
  it('shows the always-rows and only the non-zero optional ones, in the original order', () => {
    expect(rep.cashRows.map((r) => r.label)).toEqual([
      'Cash Sale',
      'Meezan Bank',
      'Bank Alfalah',
      'Bank Al Habib',
      'Cash Returns',
      'Bank Alfalah 2',
    ]);
    expect(rep.creditRows.map((r) => r.label)).toContain('Askari');
    expect(rep.creditRows.map((r) => r.label)).not.toContain('HBL');
    expect(rep.creditRows.at(-1).label).toBe('State Life Insurance');
    expect(rep.creditRows.find((r) => r.id === 'psoRet').note).toBe('Returns Only');
    expect(rep.cashRows[0].note).toBe('Sales Only');
  });
  it('Customers, FDPP, till and patty rows follow, COMP and Difference appear when there is a comparison figure', () => {
    expect(rep.misc.map((m) => m.id)).toEqual(['compSale', 'diff', 'fdpp', 'fdppCon', 'customers', 'till', 'patty']);
    expect(rep.misc.find((m) => m.id === 'diff').tone).toBe('pos');
  });
  it('hiding a row hides it everywhere but never changes the totals', () => {
    const hidden = new Set(['cashSale', 'psoRet', 'customers', 'diff']);
    const r2 = buildReport(fig, { hidden });
    expect(r2.cashRows.some((r) => r.id === 'cashSale')).toBe(false);
    expect(r2.misc.some((m) => m.id === 'customers' || m.id === 'diff')).toBe(false);
    expect(r2.netCash).toBe(589533);
    expect(r2.grand).toBe(614758);
  });
  it('without a comparison figure, COMP and Difference are left out', () => {
    const f = dayFigures({ total: 614758, comp_sale: null }, lines, methods);
    const r3 = buildReport(f);
    expect(r3.misc.some((m) => m.id === 'compSale' || m.id === 'diff')).toBe(false);
  });
  it('every built-in row is in the Customize Rows list exactly once', () => {
    const ids = Object.values(ROW_CATALOG)
      .flat()
      .map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.keys(ROW_CODES)) expect(ids).toContain(id);
  });
});

describe('number and date formats', () => {
  it('fv prints plain minus, zero, and thousands separators like the original', () => {
    expect(fv(-30197)).toBe('-30,197');
    expect(fv(0)).toBe('0');
    expect(fv(-0.2)).toBe('0');
    expect(fv(1234.5)).toBe('1,235');
    expect(reportDate('2026-11-04')).toBe('04/Nov/2026');
  });
});

describe('copy / email outputs', () => {
  const fig = dayFigures(day, lines, methods);
  const rep = buildReport(fig, { till: 0, patty: 0 });
  const ctx = { branch: 'Bahria Town', date: '2026-11-04' };
  it('plain text starts as the original and carries the figures', () => {
    const t = buildPlainText(rep, ctx);
    expect(t.startsWith('BAHRIA TOWN SALE REPORT\nDate: 04/Nov/2026')).toBe(true);
    expect(t).toContain('Net Cash Sale: 589,533');
    expect(t).toContain('Grand Total: ₨614,758');
    expect(t).toContain('Difference (Total − COMP): 24,977');
  });
  it('e-mail HTML is inline-styled and escapes labels', () => {
    const evil = { ...rep, cashRows: [{ id: 'x', label: '<img src=x onerror=1>', value: 5 }] };
    const h = buildEmailHtml(evil, ctx);
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
    expect(buildEmailHtml(rep, ctx)).toContain('₨614,758');
    expect(buildEmailHtml(rep, ctx)).not.toContain('<style');
  });
  it('subject line', () => expect(reportSubject('Bahria Town', '2026-11-04')).toBe('Bahria Town Sale Report — 04/Nov/2026'));
});

describe('monthly target', () => {
  it('shows percent, colour band and remaining', () => {
    expect(targetProgress(16500000, 3171201)).toEqual({ pct: 19, tone: 'r', remaining: 13328799 });
    expect(targetProgress(100, 80).tone).toBe('a');
    expect(targetProgress(100, 150)).toEqual({ pct: 100, tone: 'g', remaining: 0 });
    expect(targetProgress(null, 5)).toBeNull();
  });
});
