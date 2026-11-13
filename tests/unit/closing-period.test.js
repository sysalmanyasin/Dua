import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPaisa } from '../../js/modules/closing/domain/compute.js';

// The "since the last Final" roll-up is built in the database (closing_period_agg, migration 0204) and run against these same
// hand-worked cases in supabase/tests/0204_closing_period_test.sql. This file is an INDEPENDENT second implementation, written
// from the old app's aggregateSinceLastFinal and BUSINESS_RULES section 5, so the hand-worked expectations are checked by two
// different pieces of code. It is a test reference, not application code: the screens read the database's figures.
const cases = JSON.parse(readFileSync('tests/fixtures/closing-period-cases.json', 'utf8'));

const before = (a, b) => a.day < b.day || (a.day === b.day && a.seq < b.seq);

function rollUp(timeline, current) {
  const live = timeline.filter((c) => c.status === 'submitted' && before(c, current));
  const finals = live.filter((c) => c.mode === 'final');
  const lf = finals.length ? finals.reduce((a, b) => (before(a, b) ? b : a)) : null;
  const period = live.filter((c) => !lf || before(lf, c));
  const p = (v) => toPaisa(v);
  const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
  const same = period.filter((c) => c.day === current.day);
  const pre = period.filter((c) => c.day < current.day);
  const lfSame = lf && lf.day === current.day ? lf : null;
  const lfPre = lf && lf.day < current.day ? lf : null;
  const manual = (c) => c.ret_manual.reduce((t, v) => t + p(v), 0);
  const books = (c) => c.book.reduce((t, v) => t + p(v), 0);
  const own = lf ? [lf] : [];
  return {
    same_date_shift_sale: sum(same, (c) => p(c.shift_sale)),
    pre_date_shift_sale: sum(pre, (c) => p(c.shift_sale)),
    same_date_customers: sum(same, (c) => c.customers) * 100,
    pre_date_customers: sum(pre, (c) => c.customers) * 100,
    same_date_sys_returns: sum(same, (c) => p(c.ret_system)),
    pre_date_sys_returns: sum(pre, (c) => p(c.ret_system)),
    total_manual_returns: sum(period.concat(own), manual),
    total_book_bills: sum(period.concat(own), books),
    total_extra_cash: sum(period.concat(own), (c) => p(c.extra_cash)),
    total_mediq_extra: sum(period.concat(own), (c) => p(c.mediq_extra)),
    lf_same_date_sale: lfSame ? p(lfSame.shift_sale) : 0,
    lf_pre_date_sale: lfPre ? p(lfPre.shift_sale) : 0,
    lf_same_date_cust: lfSame ? lfSame.customers * 100 : 0,
    lf_pre_date_cust: lfPre ? lfPre.customers * 100 : 0,
    lf_same_date_sys_ret: lfSame ? p(lfSame.ret_system) : 0,
    lf_pre_date_sys_ret: lfPre ? p(lfPre.ret_system) : 0,
  };
}

describe('period roll-up (shared hand-worked cases, also run against the database)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const got = rollUp(c.timeline, c.current);
      for (const [key, want] of Object.entries(c.expect)) {
        const wantPaisa = key.endsWith('customers') || key.endsWith('_cust') ? want * 100 : toPaisa(want);
        expect(got[key], key).toBe(wantPaisa);
      }
    });
  }
  it('every case states all sixteen figures, so a forgotten field cannot pass silently', () => {
    for (const c of cases) expect(Object.keys(c.expect).sort(), c.name).toEqual(Object.keys(rollUp([], { day: 1, seq: 10 })).sort());
  });
});
