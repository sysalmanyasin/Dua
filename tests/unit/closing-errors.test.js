import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MESSAGES, conflictVersion, friendlyError } from '../../js/modules/closing/domain/errors.js';

describe('closing refusal messages', () => {
  it('has a sentence for every machine code the closing migrations can raise', () => {
    const sql = readdirSync('supabase/migrations')
      .filter((f) => /^02\d\d_/.test(f))
      .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
      .join('\n');
    const codes = new Set([...sql.matchAll(/hint = '([a-z_]+)'/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(25);
    for (const c of codes) expect(MESSAGES[c], `no message for hint "${c}"`).toBeTruthy();
  });
  it('has no message for a code the database never raises (no dead text)', () => {
    const sql = readdirSync('supabase/migrations')
      .filter((f) => /^02\d\d_/.test(f))
      .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
      .join('\n');
    for (const c of Object.keys(MESSAGES)) expect(sql, `"${c}" is never raised`).toContain(`hint = '${c}'`);
  });
  it('maps a database refusal to its sentence', () => {
    const r = friendlyError({ hint: 'previous_slot_open', message: 'the slot before has not been submitted' });
    expect(r).toMatchObject({ code: 'previous_slot_open', kind: 'refused' });
    expect(r.message).toMatch(/slot before/);
  });
  it('treats a changed draft or changed carried figures as a conflict the screen reloads from', () => {
    expect(friendlyError({ hint: 'draft_conflict' }).kind).toBe('conflict');
    expect(friendlyError({ hint: 'carry_changed' }).kind).toBe('conflict');
  });
  it('a plain permission error becomes not_allowed, a dropped connection becomes offline', () => {
    expect(friendlyError({ code: '42501', message: 'permission denied' }).code).toBe('not_allowed');
    expect(friendlyError(new TypeError('Failed to fetch')).kind).toBe('offline');
  });
  it('never shows raw database text to the cashier', () => {
    const r = friendlyError({ message: 'duplicate key value violates unique constraint "closings_pkey"' });
    expect(r.kind).toBe('unknown');
    expect(r.message).not.toMatch(/duplicate|constraint/);
  });
  it('reads the version out of a conflict', () => {
    expect(conflictVersion({ details: 'version=4' })).toBe(4);
    expect(conflictVersion({})).toBeNull();
  });
});
