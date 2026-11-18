# Testing and verification

**Status snapshot:** 13 November 2026. This document separates test evidence from real-device / production verification.

## Current recorded test status

The latest `main` entry in `PROJECT_PROGRESS.md` reports **357 unit/jsdom tests** and a full database suite including Closing, Manager and Inventory. Earlier module progress files report counts from different snapshots (Manager: 294 unit tests / 385 DB checks; Closing: 351 unit tests at its Session A snapshot; Inventory: 242 at its earlier A0/A stage). These are not additive and must not be presented as one total.

For release decisions, use the current GitHub Actions run and rerun the commands below. Do not treat a dated count as proof that the current checkout passes.

## Test suites

| Suite | Command / location | Coverage |
|---|---|---|
| Front-end unit and page tests | `npm test`; `tests/unit/` | Domain calculations, parsing, permission registry, page interactions in jsdom, save/retry/conflict, view-only states, print/copy and Gmail dialogs |
| Repository checks | `npm run lint`, `npm run format:check`, `npm run check:secrets`, `npm run check:vendor` | Style, unsafe DOM patterns, secret leakage and vendored-file hashes |
| Database tests | `bash supabase/tests/run.sh` | Rebuilds a clean local PostgreSQL database from repository migrations, then checks RLS, grants, permissions, validation, idempotency, immutable records and module-specific rules |
| Edge Function checks | CI Deno checks | Type-checks the Edge Functions included in the workflow |
| Workflow lint | CI actionlint step | Checks GitHub Actions workflow syntax |

## How to run

```sh
npm ci
npm run verify
bash supabase/tests/run.sh
```

The database runner needs a local PostgreSQL instance and `PGUSER`. GitHub Actions runs the repository checks on pushes and pull requests; inspect the actual run rather than assuming it passed.

## Shared fixtures and real-data evidence

- `tests/fixtures/sales-total-cases.json` is shared by browser maths and database tests for Sales TOTAL calculations.
- The historical Sales import covered 2,379 days. The project record says 2,378 totals reproduce exactly under the signed rule; 79 of 80 monthly totals matched, with the documented September 2026 difference of 5,674.
- Closing uses hand-worked fixtures in `tests/fixtures/closing-cases.json` and `closing-period-cases.json`; database and JavaScript calculations are compared against those fixtures.
- Manager credit maths uses `tests/fixtures/manager-credit-cases.json` in both SQL and browser tests.
- Inventory's delta-feed tests include paging, permissions, tombstones, removal guard, heartbeat and unique sequence counters. The 17 Nov additions are `tests/unit/inventory-xlsx.test.js` (the Excel writer: zip checksums, XML, text-never-a-formula, leading zeros, Unicode, sheet names), `tests/unit/inventory-export.test.js` (file names, export kinds, print limit and number formatting), the Excel / PDF cases in `tests/unit/inventory-screens.test.js`, and the Stock row cases in `tests/unit/cover.test.js`. The database test for `0307` is `supabase/tests/0307_inventory_apply_body_test.sql`. See `docs/modules/inventory.progress.md`.

## Live verification recorded

- Inventory migrations 0301–0304 and Edge Function v14 were applied and verified on DuaPharmaPlus on 12 Nov 2026, with hourly sync checks and a full first-install feed test. Migrations 0305–0306 followed. On 17 Nov 2026 `0307` and Edge Function v23 were applied; the live function body matches the file (same length and hash), the function is granted to the service role only, and five scheduled syncs in a row succeeded afterwards. The `0307` database test file has **not** been run against a database yet (no local Postgres was available when it was written); run `bash supabase/tests/run.sh` before treating it as passed.
- Manager progress reports migrations 0101–0103 applied and checked live on 13 Nov 2026.
- Foundation progress reports the first successful encrypted Drive backup on 13 Nov 2026.
- A local backup restore round-trip passed 39/39 checks. This does **not** prove restoration from an actual Drive backup into a separate Supabase project.

## Not yet proven / gaps

- A complete real-device acceptance pass for the newest Sales, Manager and Closing pages.
- Real Gmail sending from the deployed origin with the owner's Google account.
- A restore drill from a real encrypted Drive backup into a separate, empty Supabase project.
- Load, long-running, offline and low-memory behaviour on the actual pharmacy phones.
- Full browser end-to-end automation (Playwright) and production error monitoring (Sentry).
- Inventory's full screen set and local-copy flow; the live feed alone does not mean the Inventory module is complete.

A test passing in jsdom or local PostgreSQL is evidence for that test scope only. It is not evidence of real-device usability, Google integration, production restore or every live permission path.
