import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUDIT_KEYS, BUNDLES, bundleStatus, keyAccess, planApply, planClear } from '../../js/modules/audit/domain/bundles.js';
import { MESSAGES, friendlyError } from '../../js/modules/audit/domain/errors.js';

const sql = readdirSync('supabase/migrations')
  .filter((f) => /^04\d\d_/.test(f))
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');

// Permission keys the database seeds: every `insert into public.permissions` block, in every migration.
const allSql = readdirSync('supabase/migrations')
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');
const seededAuditKeys = new Set(
  [...allSql.matchAll(/insert into public\.permissions[^;]*?values([^;]*);/gs)].flatMap((m) =>
    [...m[1].matchAll(/\('(audit\.[a-z_]+)'/g)].map((k) => k[1]),
  ),
);

describe('audit bundles', () => {
  it('every key a bundle names is a permission the migrations seed', () => {
    for (const b of Object.values(BUNDLES)) for (const k of b.keys) expect(seededAuditKeys.has(k), k).toBe(true);
  });
  it('the key list is exactly the keys the database seeds (17)', () => {
    expect(new Set(AUDIT_KEYS.map((a) => a.key))).toEqual(seededAuditKeys);
    expect(AUDIT_KEYS).toHaveLength(17);
  });
  it('matches the agreed bundles', () => {
    expect([...BUNDLES.deputy.keys].sort()).toEqual([
      'audit.barcode_register',
      'audit.count',
      'audit.report',
      'audit.suggest',
      'audit.view',
    ]);
    expect([...BUNDLES.sub.keys].sort()).toEqual(['audit.barcode_scan', 'audit.count', 'audit.expiry_log', 'audit.individual']);
    expect(BUNDLES.lead.keys).toHaveLength(17);
  });
  const rolePerms = [
    { role: 'senior', perm_key: 'audit.count' },
    { role: 'junior', perm_key: 'audit.count' },
  ];
  it('a role preset counts as held, a deny beats it, a grant adds', () => {
    expect(keyAccess('junior', rolePerms, [], 'audit.count').allowed).toBe(true);
    expect(keyAccess('junior', rolePerms, [{ perm_key: 'audit.count', effect: 'deny' }], 'audit.count').allowed).toBe(false);
    expect(keyAccess('junior', rolePerms, [{ perm_key: 'audit.view', effect: 'grant' }], 'audit.view').allowed).toBe(true);
    expect(keyAccess('junior', rolePerms, [], 'audit.view').allowed).toBe(false);
  });
  it('plans only the missing keys, and replaces a deny with an allow', () => {
    expect(planApply('sub', 'junior', rolePerms, []).map((p) => p.key)).toEqual([
      'audit.individual',
      'audit.barcode_scan',
      'audit.expiry_log',
    ]);
    const denied = [{ perm_key: 'audit.count', effect: 'deny' }];
    expect(planApply('sub', 'junior', rolePerms, denied)[0]).toEqual({ key: 'audit.count', effect: 'grant' });
    expect(planApply('sub', 'junior', rolePerms, [...denied]).every((p) => p.effect === 'grant')).toBe(true);
  });
  it('reports full, partial and none', () => {
    expect(bundleStatus('sub', 'junior', rolePerms, [])).toBe('partial'); // only the preset's audit.count
    const all = BUNDLES.sub.keys.map((k) => ({ perm_key: k, effect: 'grant' }));
    expect(bundleStatus('sub', 'junior', rolePerms, all)).toBe('full');
    expect(bundleStatus('deputy', 'junior', [], [])).toBe('none');
  });
  it('a bundle already held plans nothing; clear lists only personal audit settings', () => {
    const all = BUNDLES.sub.keys.map((k) => ({ perm_key: k, effect: 'grant' }));
    expect(planApply('sub', 'junior', rolePerms, all)).toEqual([]);
    expect(
      planClear([...all, { perm_key: 'closing.review', effect: 'grant' }])
        .map((p) => p.key)
        .sort(),
    ).toEqual([...BUNDLES.sub.keys].sort());
    expect(planClear(all).every((p) => p.effect === null)).toBe(true);
  });
});

describe('audit refusal messages', () => {
  const codes = new Set([...sql.matchAll(/hint = '([a-z_]+)'/g)].map((m) => m[1]));
  it('has a sentence for every machine code the audit migrations raise', () => {
    expect(codes.size).toBeGreaterThan(30);
    for (const c of codes) expect(MESSAGES[c], `no message for hint "${c}"`).toBeTruthy();
  });
  it('has no sentence for a code the database never raises', () => {
    for (const c of Object.keys(MESSAGES)) expect(sql, `"${c}" is never raised`).toContain(`hint = '${c}'`);
  });
  it('maps refusals, conflicts, permission errors and dropped connections', () => {
    expect(friendlyError({ hint: 'items_unassigned' })).toMatchObject({ code: 'items_unassigned', kind: 'refused' });
    expect(friendlyError({ hint: 'version_conflict' }).kind).toBe('conflict');
    expect(friendlyError({ code: '42501' }).code).toBe('not_allowed');
    expect(friendlyError(new TypeError('Failed to fetch')).kind).toBe('offline');
  });
  it('never shows raw database text', () => {
    const r = friendlyError({ message: 'duplicate key value violates unique constraint "audit_rounds_pkey"' });
    expect(r.kind).toBe('unknown');
    expect(r.message).not.toMatch(/duplicate|constraint/);
  });
});
