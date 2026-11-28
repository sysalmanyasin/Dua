# Audit 0 baseline: code reality and test acceptance

**Date:** 27 Nov 2026. **Commit audited:** `07e87e4` (`main`), 807 commits. **Environment:** fresh clone, Node 22.23.5, npm 10.9.9, PostgreSQL 16 (local throwaway cluster), Deno 2.9.6, Python actionlint. No Supabase project, token or production resource was touched.

## Commands and results (before Audit 0 changes)

| Command | Result |
|---|---|
| `npm ci` | pass. `npm audit`: 6 dev-only advisories; `npm audit --omit=dev`: 0 |
| `npm run lint` | pass |
| `npm run format:check` | pass (`.md`, `.ts`, `.sql`, `android-app/` are excluded by `.prettierignore`) |
| `npm test` | pass: 197 files, 3,514 tests; no `.skip`, `.only` or `.todo` in `tests/` |
| `npm run check:secrets`, `npm run check:vendor` | pass. An independent pattern scan of the tree and git history found only test fixtures |
| `bash supabase/tests/run.sh` | pass: 131 of 131 migrations, 114 test files, 3,209 `pass:` lines, 0 FAIL/ERROR |
| `deno check` on the 7 Edge Functions (as `ci.yml:57`) | pass (types only) |
| `actionlint` | pass |
| `npm run build:sw` | pass; `sw.js` unchanged (389 files) |
| `android-app`: `npm ci`, `node scripts/check-shell.mjs` | pass |
| `./gradlew testDebugUnitTest`, APK build | not run (Google Maven unreachable from the sandbox); GitHub shows an Android APK run on this commit with conclusion `success` (logs not read) |

## Schema measured on the migrated local database

140 public tables (0 without RLS; 30 with RLS and no policy), 430 routines, 365 SECURITY DEFINER (0 without a pinned `search_path`; 0 executable by `anon`), 279 SECURITY DEFINER executable by `authenticated`, 8 views (all `security_invoker`), 80 permission keys, 0 table grants to `anon`. Five non-definer functions are executable by `anon` (KI-1).

## Changes made by Audit 0 (branch `audit-0-baseline`, not pushed, not deployed)

New tests: `supabase/tests/0999_global_exposure_test.sql`, `0014_...`, `0226_...`, `0505_...`, `1002_..._test.sql`; `tests/unit/edge-staff-login.test.js`, `edge-admin-users.test.js`, `edge-device-endpoints.test.js`, `invoice-desk-known-defects.test.js`, `docs-consistency.test.js`; harness `tests/helpers/edgeHarness.js`. New script `npm run test:coverage`. Each new handler and database test was mutation-checked: the code under test was deliberately broken in a scratch copy and the test was confirmed to fail, then the code was restored. No existing test, workflow, migration or application file was changed or removed. Only `README.tmp` was deleted.

## Final results after Audit 0 changes

| Check | Result |
|---|---|
| `npm run lint`, `format:check`, `check:secrets`, `check:vendor` | pass |
| `npm run test:coverage` | pass: 202 files, 3,601 tests (197 files and 3,514 tests before Audit 0). Coverage: 88.0% statements, 86.7% branches, 88.2% functions, 88.0% lines over `js/**` and `supabase/functions/**/*.ts` (v8; not a quality gate) |
| `bash supabase/tests/run.sh` | pass: 131 migrations, 119 test files, 3,268 `pass:` lines plus 843 `pass (refused)` lines, 0 FAIL/ERROR (3,209 `pass:` lines before Audit 0) |
| `deno check` (7 functions), `actionlint`, `build:sw` | pass; `sw.js` unchanged |

Per-module matrix: `docs/TEST_ACCEPTANCE_MATRIX.md`. Current totals are also in the Evidence section of `docs/PROJECT_STATUS.md`.

## Follow-up (28 Nov 2026, `main` at `fb462f8`)

The first Audit 0 branch was merged as PR #111. Other work then reached `main` (attendance health, closing summary, workspace entry, audit live progress, database-CI fixes), so the baseline was re-measured on the merged tip before more tests were added.

**Re-measured on `main`:** 137 migrations, 8 Edge Functions (`attendance-health` is new), 15 modules. Local PostgreSQL 16: 141 public tables (0 without RLS, 31 with RLS and no policy), 437 routines, 372 SECURITY DEFINER (0 without a pinned `search_path`), 8 views, 80 permission keys. The same five functions remain executable by `anon` (KI-1); `0999` passes against all 137 migrations, so the three newest migrations introduced no new exposure.

**What the first PR run taught:** CI failed on the PR because `main` had moved and `tests/unit/docs-consistency.test.js` compared my facts block with the merged repository. That is the guard working as designed; the facts block must be updated in any change that adds a migration, database test file, module or function.

**Added in this follow-up (tests mutation-checked; no application code, workflow or existing test weakened; two migrations added, see below):**

| Area | New |
|---|---|
| Edge handlers | `edge-attendance-health` (19), `edge-notify-ntfy` (19), `edge-sync-inventory` (23). All 8 handlers now have tests |
| Database | `0004` (removed import helper stays gone), `0310` (deactivated products), `0212` (Closing book: `closing_book_own`, page JSON, previous page, saved list, grants), `1000` (Invoice Desk save and product save: idempotency, validation, totals, RLS) |
| Docs | Facts, counts, cron list (10 jobs, `attendance-health-check` added), function count (8), test gaps and acceptance matrix updated |

**Live verification (28 Nov, read-only catalog queries on the project `DuaPharmaPlus`, PostgreSQL 17.11):** 141 public tables, 0 without RLS, 31 with RLS and no policy, 80 permission keys, 8 views, 438 routines (373 SECURITY DEFINER, 0 without a pinned `search_path`). The one routine more than the local build is `rls_auto_enable`, a Supabase platform helper that migration `0017` revokes. The registry had 139 rows against 137 repo files: `0113` and `1112` had been applied from branches and reached `main` hours later (KI-10). The same five visitor-callable functions existed live (KI-1). Ten Edge Functions are deployed, all `verify_jwt = false`: the eight in the repo plus the retired `claim-account` and `request-access` (KI-9).

**Migrations applied to the live project (28 Nov, with your permission):** `1004_invoice_desk_revoke_public_execute` and `1405_app_devices_revoke_public_execute`, each a set of `REVOKE`/`GRANT EXECUTE` statements on five functions, tested first against all 141 migrations on a local PostgreSQL 16 (the whole database suite passes with them), then applied and registered by hand like `0113` and `1112`. Verified afterwards on the live project: `anon` executes no function; both Invoice Desk helpers are still callable by signed-in people and the service role; all three triggers are enabled; registry 141 rows. No data was read or changed.

**Still open from the list:** database tests for `closing_refresh_draft` (`0215`), `audit_alert_compiled`/`audit_alert_submitted` (`0413`), `audit_live_balances` (`0419`); Invoice Desk page tests; browser end-to-end tests; live verification.
