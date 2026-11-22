// @vitest-environment jsdom
// Pure helpers behind the Audit 3.0 quick wins: which assignment to open, what to recount, and the remembered last audit.
import { beforeEach, describe, expect, it } from 'vitest';
import { differingCodes, isOpenAssignment, nextOpenAssignment, soleOpenAssignment } from '../../js/modules/audit/domain/count.js';
import { getLastView, getView, setView } from '../../js/modules/audit/domain/nav.js';

const asg = (id, over = {}) => ({ assignment_id: id, round_state: 'counting', status: 'assigned', ...over });

describe('which assignment to open', () => {
  it('open means the round is counting and the person has not submitted; a revoked one is not theirs', () => {
    expect(isOpenAssignment(asg('a'))).toBe(true);
    expect(isOpenAssignment(asg('a', { status: 'counting' }))).toBe(true);
    expect(isOpenAssignment(asg('a', { status: 'submitted' }))).toBe(false);
    expect(isOpenAssignment(asg('a', { status: 'revoked' }))).toBe(false);
    expect(isOpenAssignment(asg('a', { round_state: 'locked' }))).toBe(false);
    expect(isOpenAssignment(asg('a', { round_state: 'compiled' }))).toBe(false);
  });

  it('picks the only open assignment, and nothing when there are none or several', () => {
    expect(soleOpenAssignment([asg('a'), asg('b', { status: 'submitted' }), asg('c', { round_state: 'final' })])).toBe('a');
    expect(soleOpenAssignment([asg('a'), asg('b')])).toBeNull();
    expect(soleOpenAssignment([asg('a', { status: 'submitted' })])).toBeNull();
    expect(soleOpenAssignment([])).toBeNull();
    expect(soleOpenAssignment(null)).toBeNull();
  });

  it('finds the next open assignment after the current one', () => {
    const list = [asg('a'), asg('b', { status: 'submitted' }), asg('c')];
    expect(nextOpenAssignment(list, 'a').assignment_id).toBe('c');
    expect(nextOpenAssignment(list, 'c').assignment_id).toBe('a');
    expect(nextOpenAssignment([asg('a')], 'a')).toBeNull();
    expect(nextOpenAssignment(undefined, 'a')).toBeNull();
  });
});

describe('what to recount', () => {
  const item = (id, code, system, over = {}) => ({ round_item_id: id, code, system_qty: system, retail_price: 10, ...over });
  const items = [item('i1', 'A1', 10), item('i2', 'A2', 5), item('i3', 'B1', 8), item('i4', 'B2', 0), item('i5', null, 4)];

  it('lists the codes whose count differs, an uncounted item reading as zero in stock', () => {
    const entries = { i1: { qty: 7, auto: false }, i2: { qty: 5, auto: false } }; // i3 not counted: 8 short; i4 is 0 in stock and uncounted: no difference
    expect(differingCodes(items, entries)).toEqual(['A1', 'B1']);
  });

  it('leaves out items that match, including ones marked as matching, and items with no code', () => {
    const entries = { i1: { qty: 10, auto: true }, i2: { qty: 5, auto: false }, i3: { qty: 8, auto: false }, i5: { qty: 1, auto: false } };
    expect(differingCodes(items, entries)).toEqual([]);
  });

  it('lists each code once and stops at the limit', () => {
    const dup = [item('x1', 'Z1', 3), item('x2', 'Z1', 3), item('x3', 'Z2', 3), item('x4', 'Z3', 3)];
    expect(differingCodes(dup, {})).toEqual(['Z1', 'Z2', 'Z3']);
    expect(differingCodes(dup, {}, 2)).toEqual(['Z1', 'Z2']);
  });
});

describe('remembering the last audit opened', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('keeps the audit and round on the device, but only ids', () => {
    setView({ engagement: 'e1', round: 'r2', assignment: 'a9', secret: 'x' });
    expect(getLastView()).toEqual({ engagement: 'e1', round: 'r2' });
    expect(localStorage.getItem('dua.audit.last')).not.toContain('a9');
  });

  it('does not forget the audit when the person only opens an assignment or clears the tab', () => {
    setView({ engagement: 'e1', round: 'r2' });
    setView({ assignment: 'a1' });
    sessionStorage.clear();
    expect(getLastView()).toEqual({ engagement: 'e1', round: 'r2' });
    expect(getView()).toBeNull();
  });

  it('is null when nothing was kept, or what was kept is not usable', () => {
    expect(getLastView()).toBeNull();
    localStorage.setItem('dua.audit.last', '{"engagement":5}');
    expect(getLastView()).toBeNull();
    localStorage.setItem('dua.audit.last', 'not json');
    expect(getLastView()).toBeNull();
  });

  it('keeps an audit with no round, and treats a round without an audit as nothing to resume', () => {
    setView({ engagement: 'e1' });
    expect(getLastView()).toEqual({ engagement: 'e1', round: null });
    localStorage.setItem('dua.audit.last', '{"engagement":null,"round":"r1"}');
    expect(getLastView()).toBeNull();
  });
});
