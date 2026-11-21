# Access — module brief

**Purpose:** provide the owner with one permission-gated place to manage staff logins and each person's effective application access.

## Current implementation

- Registered module id: `access`; route: `/access`; manifest permission: `users.manage`.
- The Users & Access page lists profiles linked to Staff Registry people, role templates and disabled/locked state.
- Owner actions include changing a staff role, setting a new 4-digit PIN, unlocking a PIN lockout, enabling/disabling a login, and setting per-person permission overrides.
- Effective access is role preset plus personal override; an explicit deny wins over the role default. Admin access remains governed by the database MFA/aal2 rule.
- Login creation is owner-managed from the Staff Registry; self-sign-up and public access-request onboarding have been removed.
- `staff-login` authenticates username/PIN and applies rate/lockout controls. `admin-users` verifies the caller's `users.manage` permission before create/set-PIN/unlock/disable actions.

## Code ownership

- `js/modules/access/manifest.js`: route and permission metadata.
- `js/modules/access/domain/permissions.js`: pure effective-access calculation.
- `js/modules/access/data/api.js`: profile, permission catalog and override reads; RPC/Edge Function actions.
- `js/modules/access/ui/page.js`: Users & Access page.
- `js/shared/permissionPanel.js` + `permissionGroups.js` + `css/permissions.css`: the grouped checkbox list (also used by Audit team access). A checkbox shows the final result; the stored value is the smallest change (nothing when it matches the role preset, else a personal Allow or Deny). One logged `set_user_permission` call per change; the list updates in place and a failed save puts the row back.
- `supabase/functions/staff-login/` and `admin-users/`: staff authentication and owner-managed account operations.
- `tests/unit/access-domain.test.js`: domain permission tests. `tests/unit/permission-groups.test.js`, `permission-panel.test.js`: grouping, checkbox rules and the panel in a DOM.

## Security boundaries

- Do not expose PINs or derived passwords to the browser, logs or activity records.
- Do not create a second permission engine. Database `has_perm` and RLS/function checks remain authoritative; the UI calculation is presentation only.
- Owner/admin actions require `users.manage`; administrative permissions require MFA at the database layer.
- Keep username/PIN validation, weak-PIN rejection, lockout and disable semantics consistent between Edge Functions, database and UI.

## Remaining work

- Complete an owner/staff sign-in and disable/unlock acceptance pass on real devices.
- Review staff PIN lifecycle, lockout abuse/recovery and account-expiry operations.
- Review authenticated-callable SECURITY DEFINER functions for explicit permission checks and least-privilege grants; do not blanket-revoke them.
- Review leaked-password protection compatibility with the staff username/PIN model.
- Repeat access tests after staging/production project separation.

See [Access progress](access.progress.md), [Security Model](../SECURITY_MODEL.md) and [Master Module Progress Register](../MODULE_PROGRESS_REGISTER.md).
