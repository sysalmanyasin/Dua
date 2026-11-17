// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalDb } from '../../js/modules/ebill/data/localDb.js';

const DEV = '20000000-0000-0000-0000-000000000001';
vi.mock('../../js/modules/ebill/data/products.js', () => ({ clock: () => '02:00 pm' }));
vi.mock('../../js/modules/ebill/data/device.js', () => ({
  getDeviceId: () => '20000000-0000-0000-0000-000000000001',
  deviceLabel: () => 'Test device',
}));
const serverRow = (n, over = {}) => ({
  invoice_id: `s${n}`,
  invoice_no: `EB-261116-0000${n}`,
  business_date: '2026-11-16',
  created_at: '2026-11-16T10:00:00Z',
  client_created_at: `2026-11-16T10:0${n}:00Z`,
  staff_name: 'J One',
  device_id: DEV,
  device_label: 'Counter 1',
  pin_check: 'server',
  customer: `Customer ${n}`,
  payment_mode: 'Cash',
  gross_total: '100',
  discounts: '10',
  net_total: '90',
  items: 2,
  status: 'posted',
  ...over,
});
vi.mock('../../js/modules/ebill/data/api.js', () => ({
  currentUserId: vi.fn(async () => 'u1'),
  saveInvoice: vi.fn(async (p) => ({ ok: true, code: 'saved', invoice_no: 'EB-' + p.invoice_id })),
  registerDevice: vi.fn(async () => ({ ok: true })),
  holdBill: vi.fn(async () => ({ ok: true })),
  releaseHeld: vi.fn(async () => ({ ok: true })),
  history: vi.fn(async () => ({ rows: [], total: 0, sum_net: 0, sum_refunded: 0 })),
  invoiceDetail: vi.fn(),
  refundInvoice: vi.fn(async () => ({ ok: true, code: 'refunded', amount: 90 })),
  correctInvoice: vi.fn(async () => ({ ok: true, code: 'corrected' })),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
const api = () => import('../../js/modules/ebill/data/api.js');
let el;
let online;
const setOnline = (v) => {
  online = v;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const nowIso = new Date().toISOString();
const localRec = (id, status, over = {}) => ({
  invoice_id: id,
  user_id: 'u1',
  device_id: DEV,
  status,
  created_at: nowIso,
  local_ref: `LOCAL-${id}`,
  customer: 'Local Customer',
  staff_name: 'J One',
  net_total: 50,
  attempts: 0,
  last_error: null,
  invoice_no: null,
  synced_at: null,
  payload: {
    invoice_id: id,
    payment_mode: 'Cash',
    totals: { gross_total: 55, net_total: 50 },
    lines: [{ code: 'A1', name: 'Test Tablet', unit: 'unit', qty: 2, rate: 27.5 }],
  },
  ...over,
});
async function seed(records) {
  const s = await openLocalDb();
  for (const r of records) await s.putInvoice(r);
  s.close();
}
async function boot(permissions = ['ebill.use']) {
  document.body.replaceChildren();
  el = document.createElement('div');
  document.body.append(el);
  const { mount } = await import('../../js/modules/ebill/ui/history.js');
  await mount(el, { ctx: { user_id: 'u1', full_name: 'J One', permissions } });
  await tick();
}
const rows = () => [...el.querySelectorAll('#hs-table tbody tr[data-key]')];
const type = (e, v) => {
  e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (e, v) => {
  e.value = v;
  e.dispatchEvent(new Event('change', { bubbles: true }));
};
const fields = () => el.querySelector('#hs-dialog');

beforeEach(async () => {
  vi.useRealTimers();
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  vi.clearAllMocks();
  const { history } = await api();
  history.mockResolvedValue({ rows: [], total: 0, sum_net: 0, sum_refunded: 0 });
});

describe('history list', () => {
  it('shows server invoices with their figures, and asks the server for today by default', async () => {
    const { history } = await api();
    history.mockResolvedValue({
      rows: [serverRow(1), serverRow(2, { discounts: '0', net_total: '100' })],
      total: 2,
      sum_net: 190,
      sum_refunded: 0,
    });
    await boot();
    expect(history).toHaveBeenCalledWith({ from: today, to: today, text: '', status: '', mode: '', limit: 50, offset: 0 });
    expect(rows()).toHaveLength(2);
    const t = rows()[0].textContent;
    expect(t).toContain('EB-261116-00001');
    expect(t).toContain('Customer 1');
    expect(t).toContain('Synced');
    expect(el.querySelector('#hs-summary').textContent).toContain('2 on the server');
    expect(el.querySelector('#hs-summary').textContent).toContain('190.00');
  });
  it('puts invoices still only on this device first, marked Pending or Failed, and says they are not in the totals', async () => {
    const { history } = await api();
    history.mockResolvedValue({ rows: [serverRow(1)], total: 1, sum_net: 90, sum_refunded: 0 });
    await seed([
      localRec('p1', 'pending'),
      localRec('f1', 'failed', { last_error: { code: 'discount_limit', message: 'The discount is above your limit.' } }),
    ]);
    await boot();
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toMatch(/LOCAL-(p1|f1)/);
    expect(el.querySelector('#hs-table').textContent).toContain('Pending');
    expect(el.querySelector('#hs-table').textContent).toContain('Failed');
    const s = el.querySelector('#hs-summary').textContent;
    expect(s).toContain('1 pending, 1 failed');
    expect(s).toContain('not included');
    expect(el.querySelector('.eb-row-failed')).not.toBeNull();
  });
  it('does not list an invoice twice once it is on the server', async () => {
    const { history } = await api();
    history.mockResolvedValue({ rows: [serverRow(1, { invoice_id: 'dup1' })], total: 1, sum_net: 90, sum_refunded: 0 });
    await seed([localRec('dup1', 'synced', { invoice_no: 'EB-261116-00001' })]);
    await boot();
    expect(rows()).toHaveLength(1);
  });
  it("hides other people's device invoices", async () => {
    await seed([localRec('mine', 'pending'), localRec('theirs', 'pending', { user_id: 'someone-else' })]);
    await boot();
    expect(rows()).toHaveLength(1);
  });
  it('passes every filter to the server, and the search is debounced', async () => {
    const { history } = await api();
    await boot();
    choose(el.querySelector('#hs-from'), '2026-11-01');
    choose(el.querySelector('#hs-to'), '2026-11-15');
    choose(el.querySelector('#hs-status'), 'refunded');
    choose(el.querySelector('#hs-mode'), 'Card');
    await new Promise((r) => setTimeout(r, 50));
    history.mockClear();
    type(el.querySelector('#hs-text'), 'a');
    type(el.querySelector('#hs-text'), 'al');
    type(el.querySelector('#hs-text'), 'ali');
    expect(history).not.toHaveBeenCalled(); // still waiting for the typing to stop
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(history).toHaveBeenCalledWith({
      from: '2026-11-01',
      to: '2026-11-15',
      text: 'ali',
      status: 'refunded',
      mode: 'Card',
      limit: 50,
      offset: 0,
    });
  });
  it('the Sync filter: Pending and Failed show only what is on the device and ask the server for nothing', async () => {
    const { history } = await api();
    await seed([localRec('p1', 'pending'), localRec('f1', 'failed')]);
    await boot();
    history.mockClear();
    choose(el.querySelector('#hs-sync'), 'pending');
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].textContent).toContain('LOCAL-p1');
    choose(el.querySelector('#hs-sync'), 'failed');
    await vi.waitFor(() => expect(rows()[0]?.textContent).toContain('LOCAL-f1'));
    expect(history).not.toHaveBeenCalled();
  });
  it('pages through a long history and keeps the filters', async () => {
    const { history } = await api();
    history.mockResolvedValue({ rows: [serverRow(1)], total: 120, sum_net: 9000, sum_refunded: 0 });
    await boot();
    expect(el.querySelector('#hs-pager').textContent).toContain('Page 1 of 3');
    expect(el.querySelector('[data-page="prev"]').disabled).toBe(true);
    history.mockClear();
    el.querySelector('[data-page="next"]').click();
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    expect(history.mock.calls[0][0]).toMatchObject({ offset: 50, from: today });
    await vi.waitFor(() => expect(el.querySelector('#hs-pager').textContent).toContain('Page 2 of 3'));
  });
  it('shows refunded money separately from the net total', async () => {
    const { history } = await api();
    history.mockResolvedValue({ rows: [serverRow(1, { status: 'refunded' })], total: 1, sum_net: 0, sum_refunded: 90 });
    await boot();
    expect(el.querySelector('#hs-summary').textContent).toContain('Refunded');
    expect(el.querySelector('#hs-summary').textContent).toContain('not in the net total');
    expect(rows()[0].textContent).toContain('Refunded');
  });
  it('only managers see the device and PIN-check columns', async () => {
    const { history } = await api();
    history.mockResolvedValue({ rows: [serverRow(1, { pin_check: 'device' })], total: 1, sum_net: 90, sum_refunded: 0 });
    await boot(['ebill.use']);
    expect(el.querySelector('#hs-table').textContent).not.toContain('Counter 1');
    await boot(['ebill.use', 'ebill.manage']);
    expect(el.querySelector('#hs-table').textContent).toContain('Counter 1');
    expect(el.querySelector('#hs-table').textContent).toContain('Device');
  });
});

describe('history without a connection', () => {
  it('does not call the server, shows what the device holds (including what already uploaded) and says so', async () => {
    const { history } = await api();
    await seed([localRec('p1', 'pending'), localRec('s1', 'synced', { invoice_no: 'EB-261116-00009' })]);
    setOnline(false);
    await boot();
    expect(history).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
    expect(el.querySelector('#hs-msg').textContent).toContain('You are offline');
    expect(el.querySelector('#hs-table').textContent).toContain('EB-261116-00009');
  });
  it('a server error falls back to the device list with a clear message', async () => {
    const { history } = await api();
    history.mockRejectedValueOnce(new Error('Could not load the history.'));
    await seed([localRec('p1', 'pending')]);
    await boot();
    expect(el.querySelector('#hs-msg').textContent).toContain('Showing what is on this device');
    expect(rows()).toHaveLength(1);
  });
  it('refreshes by itself when the connection returns', async () => {
    const { history } = await api();
    setOnline(false);
    await boot();
    expect(history).not.toHaveBeenCalled();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(history).toHaveBeenCalled());
  });
  it('Upload now and Retry failed use the same sync as the billing screen', async () => {
    const { saveInvoice } = await api();
    await seed([localRec('p1', 'pending'), localRec('f1', 'failed', { last_error: { code: 'x', message: 'no' } })]);
    await boot();
    el.querySelector('[data-act="retry"]').click();
    await vi.waitFor(() => expect(saveInvoice).toHaveBeenCalledTimes(2)); // the failed one goes back to pending, then both are sent
    await vi.waitFor(() => expect(el.querySelector('#hs-summary').textContent).not.toContain('not included'));
  });
});

const detail = (over = {}) => ({
  ok: true,
  invoice: {
    invoice_id: 's1',
    invoice_no: 'EB-261116-00001',
    client_created_at: '2026-11-16T10:01:00Z',
    staff_name: 'J One',
    customer: 'Customer 1',
    payment_mode: 'Cash',
    device_label: 'Counter 1',
    pin_check: 'server',
    comments: '',
    status: 'posted',
    gross_total: '100',
    customer_discount_pct: '0',
    customer_discount: '0',
    receipt_discount: '0',
    tax: '0',
    adjustment: '0',
    net_total: '90',
    cash_received: '100',
    ...over,
  },
  lines: [{ code: 'A1', name: 'Test Tablet', unit: 'unit', qty: 2, rate: '50', line_total: '90' }],
  events: [],
});

describe('invoice detail', () => {
  const openFirst = async (permissions, d = detail()) => {
    const { history, invoiceDetail } = await api();
    history.mockResolvedValue({ rows: [serverRow(1, { invoice_id: 's1' })], total: 1, sum_net: 90, sum_refunded: 0 });
    invoiceDetail.mockResolvedValue(d);
    await boot(permissions);
    rows()[0].click();
    await vi.waitFor(() => expect(el.querySelector('#hs-detail .eb-detail h2')).not.toBeNull());
  };
  it('shows the lines, the totals and who saved it', async () => {
    await openFirst(['ebill.use']);
    const t = el.querySelector('#hs-detail').textContent.replace(/\s+/g, ' ');
    expect(t).toContain('EB-261116-00001');
    expect(t).toContain('Test Tablet');
    expect(t).toContain('Net total');
    expect(t).toContain('PIN checked on the server');
    expect(el.querySelector('[data-act="refund"]')).toBeNull(); // staff cannot refund
  });
  it('shows refunds and corrections with who did them and why', async () => {
    await openFirst(
      ['ebill.use', 'ebill.manage'],
      detail({ status: 'corrected' }) && {
        ...detail({ status: 'corrected' }),
        events: [
          {
            kind: 'correction',
            reason: 'wrong name',
            changes: { customer: { from: 'Mr Ali', to: 'Ali Khan' } },
            by: 'S One',
            at: '2026-11-16T11:00:00Z',
          },
        ],
      },
    );
    const t = el.querySelector('#hs-detail').textContent;
    expect(t).toContain('Mr Ali');
    expect(t).toContain('Ali Khan');
    expect(t).toContain('wrong name');
    expect(t).toContain('S One');
  });
  it('a manager refunds with a reason, then sees the result', async () => {
    const { refundInvoice, invoiceDetail } = await api();
    await openFirst(['ebill.use', 'ebill.manage']);
    invoiceDetail.mockResolvedValue({
      ...detail({ status: 'refunded' }),
      events: [{ kind: 'refund', reason: 'returned', amount: '90', by: 'S One', at: '2026-11-16T11:00:00Z' }],
    });
    el.querySelector('[data-act="refund"]').click();
    await vi.waitFor(() => expect(fields().querySelector('[data-f="why"]')).not.toBeNull());
    fields().querySelector('[data-f="why"]').value = 'customer returned the goods';
    fields().querySelector('[data-act="yes"]').click();
    await vi.waitFor(() => expect(refundInvoice).toHaveBeenCalledWith('s1', 'customer returned the goods'));
    await vi.waitFor(() => expect(el.querySelector('#hs-detail').textContent).toContain('Refunded'));
    expect(el.querySelector('[data-act="refund"]').disabled).toBe(true);
    expect(el.querySelector('[data-act="correct"]').disabled).toBe(true);
  });
  it('cancelling the refund question does nothing', async () => {
    const { refundInvoice } = await api();
    await openFirst(['ebill.use', 'ebill.manage']);
    el.querySelector('[data-act="refund"]').click();
    await vi.waitFor(() => expect(fields().querySelector('[data-act="no"]')).not.toBeNull());
    fields().querySelector('[data-act="no"]').click();
    await tick();
    expect(refundInvoice).not.toHaveBeenCalled();
  });
  it('a correction sends only what changed, with the reason', async () => {
    const { correctInvoice } = await api();
    await openFirst(['ebill.use', 'ebill.manage']);
    el.querySelector('[data-act="correct"]').click();
    await vi.waitFor(() => expect(fields().querySelector('[data-f="customer"]')).not.toBeNull());
    fields().querySelector('[data-f="customer"]').value = 'Ali Khan';
    fields().querySelector('[data-f="payment_mode"]').value = 'Card';
    fields().querySelector('[data-f="why"]').value = 'wrong name and tender';
    fields().querySelector('[data-act="yes"]').click();
    await vi.waitFor(() =>
      expect(correctInvoice).toHaveBeenCalledWith('s1', { customer: 'Ali Khan', payment_mode: 'Card' }, 'wrong name and tender'),
    );
  });
  it('a correction with nothing different sends nothing', async () => {
    const { correctInvoice } = await api();
    await openFirst(['ebill.use', 'ebill.manage']);
    el.querySelector('[data-act="correct"]').click();
    await vi.waitFor(() => expect(fields().querySelector('[data-f="why"]')).not.toBeNull());
    fields().querySelector('[data-f="why"]').value = 'no change';
    fields().querySelector('[data-act="yes"]').click();
    await vi.waitFor(() => expect(el.querySelector('#hs-msg').textContent).toContain('Nothing was different'));
    expect(correctInvoice).not.toHaveBeenCalled();
  });
  it('a refusal from the server is shown in words', async () => {
    const { refundInvoice } = await api();
    refundInvoice.mockResolvedValueOnce({ ok: false, code: 'not_found', message: 'No such invoice.' });
    await openFirst(['ebill.use', 'ebill.manage']);
    el.querySelector('[data-act="refund"]').click();
    await vi.waitFor(() => expect(fields().querySelector('[data-f="why"]')).not.toBeNull());
    fields().querySelector('[data-f="why"]').value = 'because';
    fields().querySelector('[data-act="yes"]').click();
    await vi.waitFor(() => expect(el.querySelector('#hs-msg').textContent).toContain('No such invoice.'));
  });
  it('offline, refunds and corrections are switched off with the reason', async () => {
    await openFirst(['ebill.use', 'ebill.manage']);
    document.body.replaceChildren();
    setOnline(false);
    const { history, invoiceDetail } = await api();
    history.mockResolvedValue({ rows: [], total: 0, sum_net: 0, sum_refunded: 0 });
    invoiceDetail.mockResolvedValue(detail());
    await seed([localRec('p1', 'pending')]);
    await boot(['ebill.use', 'ebill.manage']);
    rows()[0].click();
    await vi.waitFor(() => expect(el.querySelector('#hs-detail .eb-detail h2')).not.toBeNull());
    expect(el.querySelector('#hs-detail').textContent).toContain('not reached the server');
  });
  it("a failed device invoice shows the server's reason and says it is kept", async () => {
    await seed([localRec('f1', 'failed', { last_error: { code: 'device_inactive', message: 'This device has been deactivated.' } })]);
    await boot();
    rows()[0].click();
    await vi.waitFor(() => expect(el.querySelector('#hs-detail .eb-detail h2')).not.toBeNull());
    const t = el.querySelector('#hs-detail').textContent;
    expect(t).toContain('This device has been deactivated.');
    expect(t).toContain('kept on this device');
    expect(t).toContain('Test Tablet');
  });
  it('a detail that cannot be loaded says so instead of hanging', async () => {
    const { history, invoiceDetail } = await api();
    history.mockResolvedValue({ rows: [serverRow(1)], total: 1, sum_net: 90, sum_refunded: 0 });
    invoiceDetail.mockRejectedValue(new Error('offline'));
    await boot();
    rows()[0].click();
    await vi.waitFor(() => expect(el.querySelector('#hs-detail').textContent).toContain('Could not load this invoice'));
  });
});
