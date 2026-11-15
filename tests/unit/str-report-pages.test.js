// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = (o) => ({
  str_id: 1,
  str_number: 'T-1',
  master_str_id: 'M',
  ref_no: '',
  media: '',
  str_status: 'Open',
  str_date: '2026-11-12',
  issued_by: '',
  dispatched_date: null,
  dispatch_status: '',
  dispatched_by: '',
  receive_date: null,
  receive_status: '',
  received_by: '',
  comments: '',
  dispatch_branch: 'Warehouse',
  receive_branch: 'Test Branch',
  direction: 'in',
  no_of_boxes: '',
  stage: 'dispatched',
  line_count: 2,
  ...o,
});
const L = (str_id, id, code, strQ, dQ, rQ = null) => ({
  str_id,
  str_item_id: id,
  product_code: code,
  product_name: `Test ${code}`,
  str_qty: strQ,
  dispatch_qty: dQ,
  receive_qty: rQ,
  product_price: 10,
});
const HEADERS = [
  H({ str_id: 3, str_number: 'T-3', stage: 'received' }),
  H({ str_id: 2, str_number: 'T-2', stage: 'awaited', dispatch_branch: 'Depot' }),
  H({ str_id: 1, str_number: 'T-1', stage: 'dispatched' }),
];
const LINES = [
  L(3, 30, 'A', 20, 0), // zero dispatch (received)
  L(3, 31, 'B', 20, 20, 20),
  L(2, 20, 'C', 5, 0), // awaited: never zero dispatch
  L(1, 10, 'D', 6, null), // dispatched, null dispatch = zero
  L(1, 11, 'E', 6, 3), // partial: not zero
];
const api = { feedHeaders: vi.fn(), linesFor: vi.fn() };
const inventory = { productMeta: vi.fn() };
const prefs = { getPref: vi.fn(), setPref: vi.fn() };
vi.mock('../../js/modules/str/data/api.js', () => api);
vi.mock('../../js/modules/str/data/inventory.js', () => inventory);
vi.mock('../../js/core/prefs.js', () => prefs);

const report = await import('../../js/modules/str/ui/report.js');
const zero = await import('../../js/modules/str/ui/zero.js');

let el;
const settle = () => vi.advanceTimersByTimeAsync(50);
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  api.feedHeaders.mockReset().mockResolvedValue(HEADERS);
  api.linesFor.mockReset().mockResolvedValue(LINES);
  inventory.productMeta.mockReset().mockResolvedValue({});
  prefs.getPref.mockReset().mockResolvedValue(null);
  prefs.setPref.mockReset().mockResolvedValue({ error: null });
  window.print = vi.fn();
});
const entries = () => [...el.querySelectorAll('.str-entry')].map((e) => e.querySelector('h4, strong').textContent.trim());

describe('Report', () => {
  it('shows branches then STRs, newest first, in one batch of reads', async () => {
    await report.mount(el);
    await settle();
    expect([...el.querySelectorAll('.str-branch h3')].map((h) => h.textContent)).toEqual(['Depot', 'Warehouse']);
    expect(entries()).toEqual(['STR #T-2', 'STR #T-3', 'STR #T-1']);
    expect(api.linesFor).toHaveBeenCalledTimes(1);
    expect(inventory.productMeta).toHaveBeenCalledTimes(1);
  });
  it('shows all columns by default and applies saved choices', async () => {
    prefs.getPref.mockImplementation(async (k) => (k === 'str.report_cols' ? { price: false, diff: false, receiveQty: 'x' } : null));
    await report.mount(el);
    await settle();
    const heads = [...el.querySelector('.str-table thead tr').children].map((t) => t.textContent.trim());
    expect(heads).toEqual(['Sr#', 'Product', 'STR Qty (Pack)', 'Dispatch Qty (Pack)', 'Receive Qty (Pack)']);
  });
  it('hide 0-Dispatch removes zero lines by the shared rule, and remembers the choice', async () => {
    await report.mount(el);
    await settle();
    expect(el.textContent).toContain('[A]');
    el.querySelector('#str-hide0').click();
    await settle();
    expect(el.textContent).not.toContain('[A]'); // received, dispatch 0
    expect(el.textContent).not.toContain('[D]'); // dispatched, null dispatch
    expect(el.textContent).toContain('[C]'); // awaited stays
    expect(el.textContent).toContain('[E]'); // partial stays
    expect(prefs.setPref).toHaveBeenCalledWith('str.report_hide0', true);
  });
  it('filters by stage and saves a column choice per person', async () => {
    await report.mount(el);
    await settle();
    el.querySelector('[data-stage="awaited"]').click();
    expect(entries()).toEqual(['STR #T-2']);
    el.querySelector('[data-col="diff"]').click();
    expect(prefs.setPref).toHaveBeenCalledWith('str.report_cols', expect.objectContaining({ diff: false }));
  });
  it('prints what is on the page', async () => {
    await report.mount(el);
    await settle();
    el.querySelector('#str-print').click();
    expect(document.getElementById('str-print-root').textContent).toContain('STOCK TRANSFER REPORT');
    expect(window.print).toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
  });
  it('says plainly when loading fails', async () => {
    api.feedHeaders.mockRejectedValue(new Error('secret'));
    await report.mount(el);
    await settle();
    expect(el.textContent).toMatch(/Could not load the report/);
    expect(el.textContent).not.toContain('secret');
  });
  it('still works if saved preferences cannot be read', async () => {
    prefs.getPref.mockRejectedValue(new Error('x'));
    await report.mount(el);
    await settle();
    expect(entries()).toHaveLength(3);
  });
});

describe('Zero Dispatch', () => {
  it('lists only zero-dispatch lines on dispatched or received STRs', async () => {
    await zero.mount(el);
    await settle();
    expect(entries()).toEqual(['STR #T-3', 'STR #T-1']);
    expect(el.textContent).toContain('[A]');
    expect(el.textContent).toContain('[D]');
    for (const gone of ['[B]', '[C]', '[E]']) expect(el.textContent).not.toContain(gone);
  });
  it('starts with nothing ticked, and print is off until something is', async () => {
    await zero.mount(el);
    await settle();
    expect(el.querySelectorAll('[data-pick]:checked')).toHaveLength(0);
    expect(el.querySelector('#str-print').disabled).toBe(true);
  });
  it('select all, select none and print selected only', async () => {
    await zero.mount(el);
    await settle();
    el.querySelector('#str-all').click();
    expect(el.querySelectorAll('[data-pick]:checked')).toHaveLength(2);
    el.querySelector('#str-none').click();
    expect(el.querySelectorAll('[data-pick]:checked')).toHaveLength(0);
    const box = el.querySelector('[data-pick="1"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelector('#str-print').textContent).toMatch(/\(1\)/);
    el.querySelector('#str-print').click();
    const printed = document.getElementById('str-print-root').textContent;
    expect(printed).toContain('ZERO DISPATCH');
    expect(printed).toContain('T-1');
    expect(printed).not.toContain('T-3');
    window.dispatchEvent(new Event('afterprint'));
  });
  it('shows an empty message and saves column choices', async () => {
    api.linesFor.mockResolvedValue([L(1, 11, 'E', 6, 3)]);
    await zero.mount(el);
    await settle();
    expect(el.textContent).toMatch(/No zero-dispatch lines/);
    el.querySelector('[data-col="price"]').click();
    expect(prefs.setPref).toHaveBeenCalledWith('str.zero_cols', expect.objectContaining({ price: false }));
  });
  it('says plainly when loading fails', async () => {
    api.linesFor.mockRejectedValue(new Error('secret'));
    await zero.mount(el);
    await settle();
    expect(el.textContent).toMatch(/Could not load Zero Dispatch/);
  });
});
