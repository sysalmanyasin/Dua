// The "familiar to the old app" additions: previous-closing rows, the start-page calendar, named credit entries with descriptions.
import { describe, expect, it } from 'vitest';
import { dotsByDate, monthCells, suggestForDate } from '../../js/modules/closing/domain/calendar.js';
import { formFromRow, namedEntry, payloadFromForm } from '../../js/modules/closing/domain/form.js';
import { overviewValue, snapshotRows } from '../../js/modules/closing/domain/snapshot.js';

const ACCOUNTS = [{ id: 'a1', kind: 'named', label: 'Dr Ali' }];
const PAGE = {
  mode: 'shift',
  inputs: { sys_cash: 50000, last_bill_no: 123, comp_sale: 100, ret_manual_1: 10, prev_credit: 700, credit_adj: -50, prev_deposits: 20 },
  results: {
    total_returns: 10,
    net_sale: 9000,
    hs_total: 300,
    strips_a: 240,
    cc_curr: 400,
    cc_total: 900,
    till_c: 5001,
    vault_d: 0,
    debt_e: 900,
    deposits_f: 20,
    misc_g: 0,
    shift_variance: -150,
    net_cash: 8850,
    liquid: 9000,
    prev_cash: 150,
    mediq_extra: 0,
  },
  hs: [{ label: 'Delivery', amount: 300 }],
  strips: [
    { label: 'Panadol', price: 120, qty: 2 },
    { label: 'Brufen', price: 90, qty: 0 },
  ],
  cash: [
    { area: 'till', denomination: 5000, qty: 1 },
    { area: 'till', denomination: 1, qty: 1 },
  ],
  credit: [{ kind: 'named', label: 'Dr Ali — June', amount: 200 }],
  deposits: [{ label: 'Bank', amount: 20 }],
  mediq: [],
  misc: [],
};

describe('previous closing card rows', () => {
  it('shows what the last closing typed for the section, using the stored results', () => {
    expect(snapshotRows('pos', PAGE)).toContainEqual(['Last Bill Number', '123']);
    expect(snapshotRows('hs', PAGE)).toEqual([
      ['Delivery', '300.00'],
      ['Total HS (A)', '300.00'],
    ]);
    const strips = snapshotRows('strips', PAGE);
    expect(strips[0][0]).toBe('Panadol');
    expect(strips.map((r) => r[0])).not.toContain('Brufen'); // only items that sold
    expect(snapshotRows('till', PAGE)[0][0]).toBe('Rs. 5,000 notes');
    expect(snapshotRows('credit', PAGE)).toContainEqual(['Dr Ali — June', '200.00']);
    expect(snapshotRows('audit', PAGE)).toContainEqual(['Variance', '−150.00']);
  });
  it('shows nothing for unknown sections and a Final-only section only in Final mode', () => {
    expect(snapshotRows('nope', PAGE)).toEqual([]);
    expect(snapshotRows('final-agg', PAGE)).toEqual([]);
  });
  it('overview values come from the quick totals', () => {
    expect(overviewValue('hs', { hs: 30000 }, {})).toBe('300.00');
    expect(overviewValue('nope', {}, {})).toBe('');
  });
});

describe('start-page calendar', () => {
  it('lays a month out with leading blanks (Nov 2026 starts on a Sunday)', () => {
    const cells = monthCells(2026, 10);
    expect(cells[0]).toEqual({ day: 1, date: '2026-11-01' });
    expect(cells).toHaveLength(30);
    expect(monthCells(2026, 11)[0]).toBeNull(); // Dec 1 2026 is a Tuesday
  });
  const recent = [
    { business_date: '2026-11-10', kind: 'night', status: 'submitted' },
    { business_date: '2026-11-10', kind: 'morning', status: 'submitted' },
    { business_date: '2026-11-11', kind: 'night', status: 'draft' },
  ];
  it('gives one dot per submitted shift kind, drafts excluded', () => {
    expect(dotsByDate(recent)).toEqual({ '2026-11-10': ['night', 'morning'] });
  });
  it('suggests the slot after the last saved one', () => {
    expect(suggestForDate('2026-11-10', recent)).toBe('evening');
    expect(suggestForDate('2026-11-12', recent)).toBe('night');
    expect(suggestForDate('2026-11-10', [...recent, { business_date: '2026-11-10', kind: 'evening', status: 'submitted' }])).toBeNull();
  });
});

describe('named credit accounts with several entries', () => {
  it('splits "Account — description" back out when a draft loads, and joins it again on save', () => {
    const row = {
      closing_credit_lines: [
        { id: 'c1', line_id: 'l1', kind: 'named', account_id: 'a1', label: 'Dr Ali', amount: 300, sort: 1, deleted_at: null },
        {
          id: 'c2',
          line_id: 'l2',
          kind: 'named',
          account_id: 'a1',
          label: 'Dr Ali — payment received',
          amount: -100,
          sort: 2,
          deleted_at: null,
        },
      ],
    };
    const f = formFromRow(row, [], ACCOUNTS);
    expect(f.credit.named.map((r) => [r.label, r.desc, r.amount])).toEqual([
      ['Dr Ali', '', '300'],
      ['Dr Ali', 'payment received', '-100'],
    ]);
    const { payload, invalid } = payloadFromForm(f);
    expect(invalid).toEqual([]);
    expect(payload.credit.named.map((r) => [r.line_id, r.label, r.amount])).toEqual([
      ['l1', 'Dr Ali', 300],
      ['l2', 'Dr Ali — payment received', -100],
    ]);
  });
  it('an added entry is saved only once something is typed, and a negative amount is accepted', () => {
    const f = formFromRow({ closing_credit_lines: [] }, [], ACCOUNTS);
    f.credit.named.push(namedEntry('a1', 'Dr Ali'));
    expect(payloadFromForm(f).payload.credit.named).toHaveLength(1); // the empty extra entry is left out
    f.credit.named[1].desc = 'cheque';
    f.credit.named[1].amount = '-250.50';
    const { payload, invalid } = payloadFromForm(f);
    expect(invalid).toEqual([]);
    expect(payload.credit.named[1]).toMatchObject({ account_id: 'a1', label: 'Dr Ali — cheque', amount: -250.5 });
  });
  it('keeps the saved label within 120 characters', () => {
    const f = formFromRow({ closing_credit_lines: [] }, [], ACCOUNTS);
    f.credit.named[0].desc = 'x'.repeat(200);
    expect(payloadFromForm(f).payload.credit.named[0].label.length).toBeLessThanOrEqual(120);
  });
});
