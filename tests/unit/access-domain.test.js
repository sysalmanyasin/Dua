import { describe, expect, it } from 'vitest';
import { effectiveAccess } from '../../js/modules/access/domain/permissions.js';

const rolePerms = [{ role: 'junior', perm_key: 'closing.enter_own' }];
describe('effective access', () => {
  it('follows the role preset by default', () => {
    expect(effectiveAccess('junior', rolePerms, [], 'closing.enter_own').allowed).toBe(true);
    expect(effectiveAccess('junior', rolePerms, [], 'sales.view_history').allowed).toBe(false);
  });
  it('grant adds, deny removes', () => {
    expect(effectiveAccess('junior', rolePerms, [{ perm_key: 'sales.view_history', effect: 'grant' }], 'sales.view_history').allowed).toBe(
      true,
    );
    expect(effectiveAccess('junior', rolePerms, [{ perm_key: 'closing.enter_own', effect: 'deny' }], 'closing.enter_own').allowed).toBe(
      false,
    );
  });
});
