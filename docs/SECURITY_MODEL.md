# Security Model (Phase 1)

## Identity
- Admin (owner/manager): real email + password + **MFA required**.
- Staff: username + 6-digit PIN → hidden internal email (`username@staff.dua.invalid`, configurable) → Supabase Auth. Repeated and sequential PINs (111111, 123456) are refused. Login goes through Edge Function `staff-login`: 5 wrong PINs → locked 15 min (admin can unlock); every attempt logged.
- No public sign-up in Supabase Auth. Self-registration writes a row in `access_requests` through Edge Function `request-access` (rate-limited, no PIN stored). Admin approves → one-time setup code (hashed, 24 h expiry) → staff sets own PIN. Forgot PIN uses the same path.
- Each login links to a `staff` record; deleting/disabling a login never deletes the record.

## Authorisation: per-user permissions
Roles (admin / senior / junior) are templates. Effective permission = role template + per-user grants − per-user denies. Admin = all. Checked by SQL function `has_perm(key)` inside every RLS policy and RPC. Menus hiding is cosmetic only.

Initial keys (extend as modules land):
`sales.view_last_day` · `sales.view_history` · `sales.enter` · `sales.edit` · `targets.manage` ·
`closing.enter_own` · `closing.view_all` · `closing.review` · `closing.correct` · `closing.settings` ·
`audit.count` · `audit.manage` · `audit.review` · `inventory.search` · `inventory.view_cost` ·
`str.create` · `str.approve` · `credit.view` · `mgmt.salary` · `mgmt.petty_cash` · `reports.view` ·
`users.manage` · `settings.manage` · `activity.view` · `backup.run`

Starting presets: Junior = `closing.enter_own`, `audit.count`, `inventory.search`, `sales.view_last_day`, `str.create`. Senior = Junior (to be differentiated later). Both editable per person.

## Database rules
1. RLS enabled on every table; default deny; `anon` has no grants (revoked). The old apps' `anon_all` policies are not carried over.
2. Staff can only read/write their own drafts, their own assignments and submissions. Submitted rows are locked by trigger; corrections via `closing_correct()` (needs `closing.correct`, reason mandatory, original kept).
3. Sensitive reads (sales totals, history, credit balances, salaries) are functions/views that check permissions; staff never get raw table access to them. "Last day sale" = function returning only the latest *closed* business date.
4. `security definer` functions: reviewed individually, `search_path` fixed, execute revoked from public/anon and granted to `authenticated` only.
5. Every sensitive action → `activity_log` (user, action, record, old/new, reason, device, time). Log is append-only.
6. Idempotency keys unique per write.

## Own-phone (BYOD) controls
Admin can revoke any user's sessions instantly (ban + sign out). Access tokens short-lived; refresh tokens revoked on disable. Offline cache holds only that user's own work and is wiped on logout. No sales totals, credit or salary data are ever cached on staff devices. Optional per-user expiry date (kept from Audit Hub).

## Frontend and repo
Publishable key only; service-role key only in Edge Function secrets. Strict CSP (self + pinned CDNs + Supabase host). No secrets, keystores, tokens or notification topics in Git (secret scanning + pre-commit check in CI). Public repo ⇒ no staff names, phone numbers or amounts in code or seed data.

## Backups
Daily export by GitHub Actions: `pg_dump` → encrypted with `age` → Google Drive (service-account credentials held as GitHub secrets, never logged). Keep 30 daily + 12 weekly. Restore drill into a throw-away project before launch and every quarter.

## Required automated security tests (must fail access)
anon reads nothing · junior cannot read sales history, salaries, credit, others' closings · junior cannot edit a submitted closing · self-registered user has no access until approved · disabled user's token stops working · duplicate submit with same idempotency key creates one row · locked-out account cannot log in · direct table write bypassing RPC is refused.

## Risks accepted / watch list
Free plan: no automatic backups, project may pause after a week of inactivity, limits on storage and egress (monitor). 6-digit PIN is weaker than a password; mitigated by lockout, rate limits and revocation. Public repo exposes business rules.

## Implemented in Phase 2
Admin MFA is enforced in `has_perm()` (no aal2 = no permissions). Setup codes: 10 characters, hashed with a per-code salt, 5 attempts, 24 h expiry, single use. Request-access is rate-limited (5 per address per hour, 30 pending in total) and answers the same whether or not a username exists. Admin role and permission changes are logged with old and new values. 48 database security checks and 42 front-end checks run in CI.
