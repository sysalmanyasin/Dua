import { describe, expect, it } from 'vitest';
import { normaliseMyClosings, normalisePayslips } from '../../js/modules/home/domain/staff.js';

describe('normalisePayslips', () => {
  const slip = (o = {}) => ({
    month: '2026-10-01',
    base_salary: 40000,
    days: 31,
    advance_deducted: 5000,
    incentive: 1200,
    other: [{ name: 'Eid bonus', sign: 1, amount: 700 }],
    net: 36900,
    ...o,
  });
  it('reads the saved values and labels the month', () => {
    const [s] = normalisePayslips({ payslips: [slip()] });
    expect(s).toMatchObject({ month: '2026-10-01', label: 'October 2026', base: 40000, advance: 5000, incentive: 1200, net: 36900 });
    expect(s.other).toEqual([{ name: 'Eid bonus', amount: 700, sign: 1 }]);
  });
  it('lists newest month first', () => {
    const out = normalisePayslips({
      payslips: [slip({ month: '2026-08-01' }), slip({ month: '2026-10-01' }), slip({ month: '2026-09-01' })],
    });
    expect(out.map((s) => s.month)).toEqual(['2026-10-01', '2026-09-01', '2026-08-01']);
  });
  it('drops rows with no valid month and copes with null or bad input', () => {
    expect(normalisePayslips(null)).toEqual([]);
    expect(normalisePayslips({ payslips: 'x' })).toEqual([]);
    expect(normalisePayslips({ payslips: [null, slip({ month: 'bad' })] })).toEqual([]);
  });
  it('treats a missing number as zero and drops unnamed extra lines', () => {
    const [s] = normalisePayslips({
      payslips: [
        slip({
          advance_deducted: null,
          other: [
            { name: '', amount: 5 },
            { name: 'Fine', sign: -1, amount: 10 },
          ],
        }),
      ],
    });
    expect(s.advance).toBe(0);
    expect(s.other).toEqual([{ name: 'Fine', amount: 10, sign: -1 }]);
  });
});

describe('normaliseMyClosings', () => {
  const row = (o = {}) => ({
    closing_id: 'c1',
    business_date: '2026-11-21',
    kind: 'evening',
    status: 'submitted',
    revision: 1,
    submitted_at: '2026-11-22T01:00:00Z',
    updated_at: '2026-11-22T00:30:00Z',
    ...o,
  });
  it('says plainly whether a closing is finished', () => {
    const out = normaliseMyClosings([row(), row({ closing_id: 'c2', status: 'draft', submitted_at: null, business_date: '2026-11-20' })]);
    expect(out[0]).toMatchObject({ submitted: true, status: 'Submitted' });
    expect(out[1]).toMatchObject({ submitted: false, status: 'Draft saved, not yet submitted' });
  });
  it('orders newest first and keeps only the limit', () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row({
        closing_id: `c${i}`,
        submitted_at: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
        business_date: `2026-11-${String(i + 1).padStart(2, '0')}`,
      }),
    );
    const out = normaliseMyClosings(rows, 10);
    expect(out).toHaveLength(10);
    expect(out[0].id).toBe('c13');
  });
  it('ignores superseded or malformed rows', () => {
    expect(normaliseMyClosings([row({ status: 'superseded' }), row({ business_date: 'bad' }), null])).toEqual([]);
    expect(normaliseMyClosings(null)).toEqual([]);
  });
});
