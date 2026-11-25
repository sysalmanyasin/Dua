import { describe, expect, it } from 'vitest';
import cases from '../fixtures/closing-cases.json';
import { computeClosing } from '../../js/modules/closing/domain/compute.js';
import { previewFigures, reconciliation } from '../../js/modules/closing/ui/sections-late.js';

// The three reconciliation lines (Target Net Sales, Net Cash Available, Plus/Less) are shown in the Final Audit banner and in the
// Submit review. They must always add up: cash available − target = the difference shown.
const rupees = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : v / 100]));
const close = (a, b) => Math.abs(a - b) < 0.005;
const emptyForm = { ret_manual: ['', '', ''], book: ['', ''], extra_cash: '', ret_system: '' };

describe('closing reconciliation lines', () => {
  it('a Shift closing: cash available is the net cash, and the difference is cash minus target', () => {
    const r = reconciliation({ net_sale: 100, net_cash: 90, shift_variance: -10, final_net_sale: 0, final_net_cash: 0 }, 'shift');
    expect(r).toEqual({ target: 100, cash: 90, diff: -10 });
  });

  it('a Final closing: final_net_cash is already the difference, so cash available is it plus the target', () => {
    const r = reconciliation({ net_sale: 1, net_cash: 1, shift_variance: 0, final_net_sale: 500, final_net_cash: 25 }, 'final');
    expect(r).toEqual({ target: 500, cash: 525, diff: 25 });
  });

  it.each(cases.map((c) => [c.name, c]))('adds up for every calculation fixture, in both modes: %s', (_name, c) => {
    for (const mode of ['shift', 'final']) {
      const p = rupees(computeClosing({ ...c.input, mode }));
      const r = reconciliation(p, mode);
      expect(close(r.cash - r.target, r.diff)).toBe(true);
    }
  });

  it('the banner shows the cash available, not the cash plus the target (it once showed 190 for a 100 target and a 10 shortage)', () => {
    const p = { grand: 1, liquid: 1, net_sale: 100, net_cash: 90, shift_variance: -10, shift_sale: 100, customers: 0, mediq_extra: 0 };
    const f = previewFigures({ ...p, final_net_sale: 0, final_net_cash: 0 }, {}, emptyForm, 'shift');
    expect(f.bTarget.text).toBe('100.00');
    expect(f.bCash.text).toBe('90.00');
    expect(f.bVarLabel.text).toBe('▼ Less');
    expect(f.bVar.text).toBe('10.00');
  });
});
