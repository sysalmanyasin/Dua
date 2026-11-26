import { describe, expect, it } from 'vitest';
import { finalBlocked, finalChecks } from '../../js/modules/audit/domain/finalChecks.js';

const base = (over = {}) => ({
  round: { id: 'r1', state: 'compiled' },
  compilation: { compiled_at: '2026-11-18T08:00:00Z', with_missing: false, missing_assignment_ids: [] },
  conflicts: [],
  corrections: [],
  assignments: [{ id: 'a1', name: 'Count One', status: 'submitted' }],
  ...over,
});
const get = (checks, key) => checks.find((c) => c.key === key);

describe('checks before a final snapshot', () => {
  it('passes when everything is in order', () => {
    const checks = finalChecks(base());
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(finalBlocked(checks)).toBe(false);
  });

  it('blocks on an approved correction made after the compile, like the database does', () => {
    const checks = finalChecks(base({ corrections: [{ status: 'approved', decided_at: '2026-11-18T09:00:00Z' }] }));
    expect(get(checks, 'current').ok).toBe(false);
    expect(finalBlocked(checks)).toBe(true);
  });

  it('does not block on a correction approved before the compile', () => {
    expect(finalBlocked(finalChecks(base({ corrections: [{ status: 'approved', decided_at: '2026-11-18T07:00:00Z' }] })))).toBe(false);
  });

  it('blocks on a count submitted after the compile', () => {
    const o = base({ compilation: { compiled_at: '2026-11-18T08:00:00Z', missing_assignment_ids: ['a1'] } });
    expect(get(finalChecks(o), 'current').ok).toBe(false);
  });

  it('blocks on a waiting correction and an unsettled conflict, each with the screen that fixes it', () => {
    const checks = finalChecks(
      base({ corrections: [{ status: 'proposed' }, { status: 'proposed' }], conflicts: [{ resolved_side: null }, { resolved_side: 'a' }] }),
    );
    expect(get(checks, 'corrections').text).toBe('2 corrections are waiting for a decision.');
    expect(get(checks, 'corrections').fix.path).toBe('/audit/corrections');
    expect(get(checks, 'conflicts').text).toBe('1 conflict is not settled yet.');
    expect(get(checks, 'conflicts').fix.path).toBe('/audit/compile');
    expect(finalBlocked(checks)).toBe(true);
  });

  it('only warns when someone was missing or reopened a count', () => {
    const missing = finalChecks(
      base({ compilation: { compiled_at: '2026-11-18T08:00:00Z', with_missing: true, missing_assignment_ids: [] } }),
    );
    expect(get(missing, 'complete').ok).toBe(false);
    expect(finalBlocked(missing)).toBe(false);
    const reopened = finalChecks(base({ assignments: [{ id: 'a1', name: 'Count One', status: 'assigned' }] }));
    expect(get(reopened, 'complete').text).toContain('Count One reopened');
    expect(finalBlocked(reopened)).toBe(false);
  });
});
