import { describe, expect, it } from 'vitest';
import { computeClosing, toPaisa } from '../../js/modules/closing/domain/compute.js';
import { emptyForm, formFromRow, localTotals, payloadFromForm, rowExtra, stripLineTotal } from '../../js/modules/closing/domain/form.js';

const CATALOGUE = [
  { id: 's1', label: 'Panadol', price: 120 },
  { id: 's2', label: 'Brufen', price: 85.5 },
];

describe('closing form', () => {
  it('starts with one line per catalogue strip, empty quantity', () => {
    const f = emptyForm(CATALOGUE);
    expect(f.strips.map((l) => [l.strip_id, l.label, l.price, l.qty])).toEqual([
      ['s1', 'Panadol', '120', ''],
      ['s2', 'Brufen', '85.5', ''],
    ]);
  });

  it('round-trips a saved draft: what was saved is what comes back, and a typed 0 override survives', () => {
    const row = {
      sys_cash: 100000,
      last_bill_no: 520,
      comp_sale: 2000,
      alfalah: 3000,
      keenu: 0,
      ret_manual_1: 50,
      ret_manual_2: 0,
      ret_manual_3: 0,
      ret_system: 10,
      prev_mediq: 25,
      book_bill_1: 100,
      book_bill_2: 0,
      ov_shift_sale: 0,
      ov_customers: null,
      ov_curr_cc: null,
      ov_prev_cash: null,
      responsible_staff_id: 'staff-1',
      prev_cc: 1000,
      prev_credit: 2500,
      prev_deposits: 700,
      prev_cash: 4200,
      closing_mediq_orders: [{ id: 'm1', bill_no: 'B1', collected: 200, pharmacy_bill: 150, sort: 1, deleted_at: null }],
      closing_hs_rows: [{ id: 'h1', label: 'Rent', amount: 500, sort: 1, deleted_at: '2026-11-01T00:00:00Z' }],
      closing_strip_lines: [{ id: 'l1', strip_id: 's1', label: 'Panadol', price: 120, qty: 3, sort: 1, deleted_at: null }],
    };
    const f = formFromRow(row, CATALOGUE);
    expect(f.overrides.shift_sale).toBe('0'); // a typed 0 is a real override
    expect(f.overrides.customers).toBe('');
    expect(f.keenu).toBe(''); // a saved 0 shows as an empty box
    expect(f.hs[0].deleted).toBe(true);
    expect(f.strips.map((l) => l.strip_id)).toEqual(['s1', 's2']); // the catalogue strip not yet in the draft is added
    const { payload, invalid } = payloadFromForm(f, { isOpening: true });
    expect(invalid).toEqual([]);
    expect(payload).toMatchObject({
      sys_cash: 100000,
      last_bill_no: 520,
      ret_manual_1: 50,
      ret_system: 10,
      prev_mediq: 25,
      overrides: { shift_sale: 0, customers: null, curr_cc: null, prev_cash: null },
      responsible_staff_id: 'staff-1',
      opening: { cc: 1000, credit: 2500, deposits: 700, cash: 4200 },
    });
    expect(payload.mediq).toEqual([{ bill_no: 'B1', collected: 200, pharmacy_bill: 150, deleted: false }]);
    expect(payload.hs).toEqual([{ label: 'Rent', amount: 500, deleted: true }]);
    expect(payload.strips[0]).toEqual({ strip_id: 's1', label: 'Panadol', price: 120, qty: 3, deleted: false });
  });

  it('always sends all four overrides, so one cannot be cleared by accident', () => {
    const { payload } = payloadFromForm(emptyForm());
    expect(Object.keys(payload.overrides).sort()).toEqual(['curr_cc', 'customers', 'prev_cash', 'shift_sale']);
    expect(Object.values(payload.overrides)).toEqual([null, null, null, null]);
  });

  it('never turns a typo into a saved zero: junk is reported and nothing is guessed', () => {
    const f = emptyForm(CATALOGUE);
    f.sys_cash = '12O00'; // letter O
    f.last_bill_no = '-5';
    f.hs = [{ id: 'a', label: 'x', amount: '12abc', deleted: false }];
    f.strips[0].qty = '-1';
    const { invalid } = payloadFromForm(f);
    expect(invalid).toEqual(['sys_cash', 'last_bill_no', 'hs.0.amount', 'strips.0.qty']);
  });

  it('accepts commas and the minus sign people type', () => {
    const f = emptyForm();
    f.sys_cash = '1,234,567.5';
    f.ret_system = '−30';
    const { payload, invalid } = payloadFromForm(f);
    expect(invalid).toEqual([]);
    expect(payload.sys_cash).toBe(1234567.5);
    expect(payload.ret_system).toBe(-30);
  });

  it('drops rows nobody typed in, but keeps every configured strip and any struck-through row', () => {
    const f = emptyForm(CATALOGUE);
    f.hs = [
      { id: 'a', label: '', amount: '', deleted: false },
      { id: 'b', label: '', amount: '', deleted: true },
    ];
    f.mediq = [{ id: 'c', bill_no: '', collected: '', pharmacy_bill: '', deleted: false }];
    f.strips.push({ id: 'd', deleted: false, strip_id: null, label: '', price: '', qty: '' });
    const { payload } = payloadFromForm(f);
    expect(payload.hs).toHaveLength(1);
    expect(payload.hs[0].deleted).toBe(true);
    expect(payload.mediq).toHaveLength(0);
    expect(payload.strips).toHaveLength(2);
  });

  it('opening figures are sent only for the opening closing', () => {
    expect(payloadFromForm(emptyForm()).payload.opening).toBeUndefined();
    expect(payloadFromForm(emptyForm(), { isOpening: true }).payload.opening).toEqual({ cc: 0, credit: 0, deposits: 0, cash: 0 });
  });
});

describe('quick totals agree with the shared calculation', () => {
  it('gives the same HS, strips, MEDIQ extra and returns as computeClosing on the same data', () => {
    const f = emptyForm(CATALOGUE);
    f.hs = [
      { id: 'a', label: 'Rent', amount: '1000.10', deleted: false },
      { id: 'b', label: 'Gone', amount: '999', deleted: true },
      { id: 'c', label: 'Tea', amount: '0.20', deleted: false },
    ];
    f.strips[0].qty = '3';
    f.strips[1].qty = '2.5';
    f.mediq = [
      { id: 'm1', bill_no: '1', collected: '300', pharmacy_bill: '250', deleted: false },
      { id: 'm2', bill_no: '2', collected: '77', pharmacy_bill: '1', deleted: true },
    ];
    f.prev_mediq = '40';
    f.ret_manual = ['10', '0.5', ''];
    f.ret_system = '7';
    const t = localTotals(f);
    const r = computeClosing({
      mode: 'shift',
      settings: { till_float: 45000, per_customer_charge: 1 },
      hs: f.hs.map((x) => ({ v: x.amount || 0, deleted: x.deleted })),
      strips: f.strips.map((x) => ({ price: x.price, qty: x.qty || 0, deleted: x.deleted })),
      mediq: f.mediq.map((x) => ({ collected: x.collected, bill: x.pharmacy_bill, deleted: x.deleted })),
      prev_mediq: f.prev_mediq,
      returns: { manual: ['10', '0.5', ''], system: '7' },
    });
    expect(t.hs).toBe(r.hs_total);
    expect(t.strips).toBe(r.strips_a);
    expect(t.mediqExtra).toBe(r.mediq_extra);
    expect(t.returns).toBe(r.total_returns);
    // hand-worked: HS 1000.10 + 0.20 = 1000.30; strips 3 x 120 + 2.5 x 85.50 = 360 + 213.75 = 573.75; mediq 40 + 50 = 90; returns 17.50
    expect([t.hs, t.strips, t.mediqExtra, t.returns]).toEqual([toPaisa(1000.3), toPaisa(573.75), toPaisa(90), toPaisa(17.5)]);
  });
  it('row helpers use the same paisa rounding', () => {
    expect(rowExtra({ collected: '300.10', pharmacy_bill: '250.05' })).toBe(5005);
    expect(stripLineTotal({ price: '0.10', qty: '3' })).toBe(30);
  });
});

describe('sections 6-14 in the form', () => {
  const ACCOUNTS = [
    { id: 'a1', kind: 'named', label: 'Dr Ali' },
    { id: 't1', kind: 'tier_name', label: 'Staff' },
  ];
  const ROW = {
    extra_cash: 200,
    final_sys_returns: 0,
    credit_adj: -500,
    closing_cash_counts: [
      { area: 'till', denomination: 5000, qty: 9 },
      { area: 'till', denomination: 1, qty: 40 },
      { area: 'vault', denomination: 1000, qty: 3 },
    ],
    closing_misc_rows: [{ id: 'm1', charge_id: 'ch1', label: 'Repair', amount: 750, sort: 1, deleted_at: null }],
    closing_deposits: [{ id: 'd1', label: 'Bank', amount: 1200, sort: 1, deleted_at: null }],
    closing_credit_lines: [
      { id: 'c1', line_id: 'ln1', kind: 'named', account_id: 'a1', label: 'Dr Ali', amount: 300, sort: 1, deleted_at: null },
      { id: 'c2', line_id: 'ln2', kind: 'tier', tier_slot: 2, label: 'Staff', amount: 80, sort: 2, deleted_at: null },
      { id: 'c3', line_id: 'ln3', kind: 'free', label: 'Other', amount: 25, sort: 3, deleted_at: null },
    ],
  };
  it('round-trips counts, misc (keeping charge_id), deposits and credit lines (keeping line_id and tier slots)', () => {
    const f = formFromRow(ROW, [], ACCOUNTS);
    expect(f.till).toEqual(['9', '', '', '', '', '', '', '40']);
    expect(f.vault[1]).toBe('3');
    expect(f.credit.tier.map((t) => t.amount)).toEqual(['', '80', '']);
    const { payload, invalid } = payloadFromForm(f);
    expect(invalid).toEqual([]);
    expect(payload.till).toEqual([9, 0, 0, 0, 0, 0, 0, 40]);
    expect(payload.misc).toEqual([{ charge_id: 'ch1', label: 'Repair', amount: 750, deleted: false }]);
    expect(payload.deposits).toEqual([{ label: 'Bank', amount: 1200, deleted: false }]);
    expect(payload.credit.named).toEqual([{ line_id: 'ln1', account_id: 'a1', label: 'Dr Ali', amount: 300, deleted: false }]);
    // slot 1 is sent blank so slot 2 stays slot 2; trailing blank slot 3 is not sent
    expect(payload.credit.tier).toEqual([
      { label: '', amount: 0 },
      { line_id: 'ln2', label: 'Staff', amount: 80 },
    ]);
    expect(payload.credit.free).toEqual([{ line_id: 'ln3', label: 'Other', amount: 25, deleted: false }]);
    expect([payload.credit_adj, payload.extra_cash]).toEqual([-500, 200]);
  });
  it('a configured named account that is not in the draft yet still gets a line, without a line_id', () => {
    const f = formFromRow({ ...ROW, closing_credit_lines: [] }, [], ACCOUNTS);
    expect(f.credit.named).toHaveLength(1);
    expect(payloadFromForm(f).payload.credit.named[0]).toMatchObject({ account_id: 'a1', amount: 0 });
    expect(payloadFromForm(f).payload.credit.named[0].line_id).toBeUndefined();
  });
  it('reports junk counts and amounts instead of saving zero', () => {
    const f = emptyForm([], ACCOUNTS);
    f.till[0] = '9x';
    f.vault[2] = '-3';
    f.credit_adj = 'abc';
    f.deposits = [{ id: 'd', label: 'x', amount: '1..2', deleted: false }];
    expect(payloadFromForm(f).invalid).toEqual(['credit_adj', 'till.0', 'vault.2', 'deposits.0.amount']);
  });
  it('quick totals agree with computeClosing for misc, card, till, vault, credit and deposits', () => {
    const f = formFromRow(ROW, [], ACCOUNTS);
    f.alfalah = '1000.50';
    f.keenu = '500';
    f.comp_sale = '200.25';
    f.misc.push({ id: 'x', charge_id: null, label: 'Gone', amount: '99', deleted: true });
    const carry = { cc: 1000, credit: 2500, deposits: 300, cash: 4200 };
    const t = localTotals(f, carry);
    const r = computeClosing({
      mode: 'shift',
      settings: { till_float: 45000, per_customer_charge: 1 },
      pos: { alfalah: '1000.50', keenu: '500', comp_sale: '200.25' },
      carried: carry,
      misc: f.misc.map((x) => ({ v: x.amount || 0, deleted: x.deleted })),
      till: [9, 0, 0, 0, 0, 0, 0, 40],
      vault: [0, 3, 0, 0, 0, 0, 0, 0],
      credit: { named: [{ v: 300, deleted: false }], tier: [0, 80, 0], free: [{ v: 25, deleted: false }] },
      credit_adj: -500,
      deposits: [{ v: 1200, deleted: false }],
    });
    expect(t.misc).toBe(r.misc_g);
    expect(t.ccCurr).toBe(r.cc_curr);
    expect(t.ccTotal).toBe(r.cc_total);
    expect(t.till).toBe(r.till_c);
    expect(t.vault).toBe(r.vault_d);
    expect(t.debt).toBe(r.debt_e);
    expect(t.deposits).toBe(r.deposits_f);
    // hand-worked: till 9 x 5000 + 40 = 45040; vault 3 x 1000 = 3000; card 1000.50 + 500 - 200.25 = 1300.25 (+1000 carried)
    expect([t.till, t.vault, t.ccCurr, t.ccTotal]).toEqual([4504000, 300000, 130025, 230025]);
    // debt 2500 + 300 + 80 + 25 - 500 = 2405
    expect(t.debt).toBe(240500);
  });
  it('a typed card override replaces the calculated card figure, and a typed 0 counts', () => {
    const f = emptyForm();
    f.alfalah = '100';
    f.overrides.curr_cc = '0';
    expect(localTotals(f, {}).ccCurr).toBe(0);
    f.overrides.curr_cc = '';
    expect(localTotals(f, {}).ccCurr).toBe(10000);
  });
});

describe('invalid paths point at the row as shown, not as sent', () => {
  it('keeps the screen index when blank rows before it are dropped', () => {
    const f = emptyForm();
    f.hs = [
      { id: 'a', label: '', amount: '', deleted: false },
      { id: 'b', label: 'x', amount: 'oops', deleted: false },
    ];
    expect(payloadFromForm(f).invalid).toEqual(['hs.1.amount']);
  });
});
