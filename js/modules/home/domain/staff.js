// Pure helpers for the Staff sections on Home (My Payroll, My Recent Activity). No Supabase, no DOM.
// Payroll values are the ones Manager saved when it closed the month; nothing here recalculates them.
import { monthLabel, shortDate } from '../../../shared/format.js';

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function normalisePayslips(result) {
  const rows = Array.isArray(result?.payslips) ? result.payslips : [];
  return rows
    .map((r) => {
      const month = isoDate(r?.month);
      if (!month) return null;
      const other = (Array.isArray(r.other) ? r.other : [])
        .map((o) => ({ name: text(o?.name, 40), amount: num(o?.amount), sign: o?.sign === -1 ? -1 : 1 }))
        .filter((o) => o.name);
      return {
        month,
        label: monthLabel(month),
        base: num(r.base_salary),
        days: num(r.days),
        advance: num(r.advance_deducted),
        incentive: num(r.incentive),
        other,
        net: num(r.net),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.month.localeCompare(a.month));
}

const SLOT = { night: 'Night', morning: 'Morning', evening: 'Evening', handover: 'Handover' };

// The person's own closings, newest first. A saved draft and a submitted closing are worded differently so it is clear
// whether the work is finished.
export function normaliseMyClosings(rows, limit = 10) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const date = isoDate(r?.business_date);
      if (!date || (r.status !== 'draft' && r.status !== 'submitted')) return null;
      const submitted = r.status === 'submitted';
      return {
        id: text(r.closing_id, 64),
        date,
        title: `${SLOT[r.kind] ?? 'Closing'} closing · ${shortDate(date).slice(0, 6)}`,
        status: submitted ? 'Submitted' : 'Draft saved, not yet submitted',
        submitted,
        at: typeof (submitted ? r.submitted_at : r.updated_at) === 'string' ? (submitted ? r.submitted_at : r.updated_at) : null,
        revision: num(r.revision) || 1,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || b.date.localeCompare(a.date))
    .slice(0, limit);
}
