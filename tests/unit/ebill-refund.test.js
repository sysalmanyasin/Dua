import { describe, expect, it } from 'vitest';
import { allRemaining, previewRefund } from '../../js/modules/ebill/domain/refund.js';

// 3 lines: A 2 x 100 = 200, B 1 x 50 = 50, C 4 x 25 = 100. Gross 350, a 10% discount makes the NET 315.
const inv = (over = {}) => ({
  net_total: 315,
  refunded_amount: 0,
  lines: [
    { line_no: 1, name: 'A', qty: 2, line_total: 200, refunded: 0, remaining: 2 },
    { line_no: 2, name: 'B', qty: 1, line_total: 50, refunded: 0, remaining: 1 },
    { line_no: 3, name: 'C', qty: 4, line_total: 100, refunded: 0, remaining: 4 },
  ],
  ...over,
});

describe('previewRefund', () => {
  it('returns the discounted share, not the full price', () => {
    const p = previewRefund(inv(), { 1: 1 }); // half of A = 100 of 350 gross -> 90 of 315
    expect(p.ok).toBe(true);
    expect(p.amount).toBe(90);
    expect(p.finalRefund).toBe(false);
    expect(p.leftAfter).toBe(6);
    expect(p.chosen).toEqual([{ line_no: 1, qty: 1 }]);
  });
  it('the refund that takes the last item returns exactly what is left, so refunds add up to net', () => {
    const lines = [{ line_no: 1, name: 'A', qty: 3, line_total: 10, refunded: 0, remaining: 3 }];
    const step = (refunded, refundedAmt, take) => {
      const x = { net_total: 10, refunded_amount: refundedAmt, lines: [{ ...lines[0], refunded, remaining: 3 - refunded }] };
      return previewRefund(x, { 1: take });
    };
    const a = step(0, 0, 1);
    const b = step(1, a.amount, 1);
    const c = step(2, a.amount + b.amount, 1);
    expect(c.finalRefund).toBe(true);
    expect(Math.round((a.amount + b.amount + c.amount) * 100) / 100).toBe(10);
  });
  it('refunding everything at once returns the whole net total', () => {
    const p = previewRefund(inv(), allRemaining(inv().lines));
    expect(p.amount).toBe(315);
    expect(p.finalRefund).toBe(true);
  });
  it('refuses more than remains, and an empty choice', () => {
    expect(previewRefund(inv(), { 2: 2 }).ok).toBe(false);
    expect(previewRefund(inv(), { 2: 2 }).message).toContain('Only 1 of');
    expect(previewRefund(inv(), {}).message).toBe('Choose what to refund.');
    expect(previewRefund(inv(), { 1: -1 }).ok).toBe(false);
  });
  it('allows for what was already refunded', () => {
    const x = inv({
      refunded_amount: 90,
      lines: [
        { line_no: 1, name: 'A', qty: 2, line_total: 200, refunded: 1, remaining: 1 },
        { line_no: 2, name: 'B', qty: 1, line_total: 50, refunded: 0, remaining: 1 },
        { line_no: 3, name: 'C', qty: 4, line_total: 100, refunded: 0, remaining: 4 },
      ],
    });
    expect(previewRefund(x, { 2: 1 }).amount).toBe(45); // 50/350 of 315
  });
});
