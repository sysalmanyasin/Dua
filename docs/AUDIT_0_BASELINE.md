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
| `npm run test:coverage` | pass: 202 files, 3,601 tests (197 files and 3,514 tests before Audit 0). Coverage: 87.6% statements, 86.6% branches, 88.1% functions, 87.6% lines over `js/**` and `supabase/functions/**/*.ts` (v8; not a quality gate) |
| `bash supabase/tests/run.sh` | pass: 131 migrations, 119 test files, 3,268 `pass:` lines plus 843 `pass (refused)` lines, 0 FAIL/ERROR (3,209 `pass:` lines before Audit 0) |
| `deno check` (7 functions), `actionlint`, `build:sw` | pass; `sw.js` unchanged |

Per-module matrix: `docs/TEST_ACCEPTANCE_MATRIX.md`. Current totals are also in the Evidence section of `docs/PROJECT_STATUS.md`.
