// Phase 6: Emergency Billing must stay quick with big shops. The limits are generous (slow machines, busy CI); they exist to catch
// a real slowdown such as a search that rescans everything per keystroke, or a report that is quadratic in its rows.
import { describe, expect, it } from 'vitest';
import { emptyState, filterRows, setCode, setGlobal, setSort, view } from '../../js/modules/ebill/domain/productFilter.js';
import { buildReceipt } from '../../js/modules/ebill/domain/receipt.js';
import { csvOf, dailyTable, invoiceTable, pdfOf, xlsxOf } from '../../js/modules/ebill/domain/reportFile.js';
import { billTotals } from '../../js/modules/ebill/domain/calc.js';

const timed = (fn) => {
  const t = performance.now();
  const out = fn();
  return { ms: performance.now() - t, out };
};

const WORDS = ['Panadol', 'Brufen', 'Augmentin', 'Calpol', 'Disprin', 'Flagyl', 'Zantac', 'Surbex', 'Ventolin', 'Amoxil'];
const FORMS = ['Tablet', 'Syrup', 'Capsule', 'Cream', 'Injection', 'Drops'];
const catalogue = (n) =>
  Array.from({ length: n }, (_, i) => ({
    code: `P${String(i).padStart(6, '0')}`,
    name: `${WORDS[i % WORDS.length]} ${FORMS[i % FORMS.length]} ${100 + (i % 900)}mg`,
    generic: `Generic ${i % 700}`,
    company: `Company ${i % 120}`,
    supplier: `Supplier ${i % 60}`,
    unit: 'unit',
    pack: 10,
    stock: i % 5 === 0 ? 0 : (i * 7) % 500,
    rate: 1 + (i % 900) / 10,
    lastSale: '2026-11-0' + (1 + (i % 9)),
  }));

describe('a very large product list (30,000 products)', () => {
  const rows = catalogue(30000);
  it('finds a product by its exact code at once', () => {
    const { ms, out } = timed(() => filterRows(rows, setCode(emptyState(), 'P012345')));
    expect(out.map((r) => r.code)).toContain('P012345');
    expect(ms).toBeLessThan(1500);
  });
  it('searches every word in every field, repeatedly as someone types', () => {
    let state = emptyState();
    const typed = ['p', 'pa', 'pan', 'pana', 'panad', 'panadol t', 'panadol tablet 5'];
    const { ms } = timed(() => {
      for (const t of typed) state = setGlobal(state, t) && filterRows(rows, setGlobal(emptyState(), t));
    });
    expect(ms).toBeLessThan(6000); // seven keystrokes
    const hit = filterRows(rows, setGlobal(emptyState(), 'panadol tablet 5'));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((r) => /panadol/i.test(r.name) && /tablet/i.test(r.name))).toBe(true);
  });
  it('sorts and pages the whole list, and a page is only 50 rows', () => {
    const { ms, out } = timed(() => view(rows, setSort(emptyState(), 'name')));
    expect(out.rows.length).toBe(50);
    expect(out.total).toBe(30000);
    expect(ms).toBeLessThan(3000);
  });
});

describe('a very long bill', () => {
  const lines = Array.from({ length: 300 }, (_, i) => ({
    code: 'L' + i,
    name: `Item number ${i} with a fairly long product name 500mg`,
    generic: 'Generic',
    unit: 'unit',
    qty: 1 + (i % 4),
    rate: 10 + i,
    total: (1 + (i % 4)) * (10 + i),
  }));
  const gross = lines.reduce((s, l) => s + l.total, 0);
  const data = {
    no: 'EB-1',
    time: '2026-11-19T17:26:19Z',
    staff: 'J',
    customer: '',
    mode: 'Cash',
    local: false,
    lines,
    gross,
    customerDiscount: 0,
    receiptDiscount: 0,
    tax: 0,
    adjustment: 0,
    net: gross,
    cash: gross + 100,
    refunded: 0,
  };
  it('totals 300 lines quickly and exactly', () => {
    const { ms, out } = timed(() =>
      billTotals({ lines: lines.map((l) => ({ rate: l.rate, qty: l.qty, discount: { mode: 'pct', value: 0 } })), customerDiscountPct: 0 }),
    );
    expect(out.grossTotal).toBe(gross);
    expect(ms).toBeLessThan(500);
  });
  it('builds a receipt with every line and the right totals', () => {
    const { ms, out } = timed(() => buildReceipt(data, { shop_name: 'S' }));
    expect(out.rows).toHaveLength(300);
    expect(out.itemsLine).toBe('Total No. of Items : 300');
    expect(out.totals.find((t) => t.label === 'Net Payable').value).toMatch(/^[\d,]+\.\d\d$/);
    expect(out.totals.find((t) => t.label === 'Change').value).toBe('100.00');
    expect(ms).toBeLessThan(500);
  });
});

describe('a report with 5,000 invoices', () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ({
    invoice_no: `EB-261119-${String(i).padStart(5, '0')}`,
    business_date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`,
    client_created_at: '2026-11-19T10:00:00Z',
    staff_name: 'J One',
    customer: i % 3 ? '' : 'Mr Khan',
    payment_mode: ['Cash', 'Card', 'Credit'][i % 3],
    items: 1 + (i % 6),
    gross_total: String(100 + i),
    discounts: '5',
    net_total: String(95 + i),
    refunded_amount: i % 50 ? '0' : '20',
    status: i % 50 ? 'posted' : 'partially_refunded',
    device_label: 'Counter 1',
    pin_check: 'server',
  }));
  const days = Array.from({ length: 28 }, (_, d) => ({
    date: `2026-11-${String(d + 1).padStart(2, '0')}`,
    count: 178,
    gross: 20000,
    discounts: 890,
    net: 19110,
    refunded: 100,
    net_after_refunds: 19010,
    by_mode: { Cash: 7000, Card: 6000, Credit: 6010 },
  }));
  const report = {
    days,
    rows,
    totals: { count: 5000, gross: 560000, discounts: 25000, net: 535000, refunded: 2800, net_after_refunds: 532200 },
    total_invoices: 5000,
    truncated: false,
  };
  it('builds the tables, CSV and Excel in a few seconds', async () => {
    const t = timed(() => [dailyTable(report), invoiceTable(report)]);
    expect(t.out[1]).toHaveLength(5001);
    expect(t.ms).toBeLessThan(2000);
    const c = timed(() => csvOf(invoiceTable(report)));
    expect(c.ms).toBeLessThan(3000);
    const x = timed(() => xlsxOf(report));
    expect(x.ms).toBeLessThan(6000);
    expect((await x.out.arrayBuffer()).byteLength).toBeGreaterThan(10000);
  });
  it('builds a multi-page PDF without running off the pages', async () => {
    const { ms, out } = timed(() => pdfOf(report, { from: '2026-11-01', to: '2026-11-28' }));
    expect(ms).toBeLessThan(8000);
    const s = new TextDecoder('latin1').decode(new Uint8Array(await out.arrayBuffer()));
    expect(s.startsWith('%PDF-')).toBe(true);
    expect((s.match(/\/Type \/Page /g) || []).length).toBeGreaterThan(30); // 5,000 rows at about 35 a page
    expect(s).toContain('EB-261119-04999'); // the last invoice made it onto a page
  });
});
