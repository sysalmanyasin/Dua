# Testing and verification

**Status snapshot:** 19 November 2026. This document separates automated test evidence from live deployment and real-device acceptance.

## Latest recorded verification

The 19 Nov 2026 Audit handover records the following local result on the merged main tree:

- `npm run verify`: lint, format, secret and vendor checks passed; **1,562 / 1,562 unit tests passed**.
- `bash supabase/tests/run.sh`: full local PostgreSQL database suite passed.
- Deno Edge Function type checks and workflow lint were **not run locally** in that session.

This is dated repository evidence, not a test run performed by this documentation update. The GitHub commit-status endpoint returned no status entries for the inspected main HEAD, so a fresh green GitHub Actions run is not independently confirmed here. Before release, run the full workflow on current main and inspect each job.

As of 21 Nov 2026 on `main`: 1,891 unit tests in 121 files pass; database test files: 77. Do not add module-specific test counts from different dates/branches. They overlap and are not a current global total.

## Test suites

| Suite | Command / location | Coverage |
|---|---|---|
| Front-end unit and page tests | `npm test`; `tests/unit/` | Domain calculations, parsing, permission registry, page interactions in jsdom, save/retry/conflict, view-only states, print/copy and Gmail dialogs |
| Repository checks | `npm run lint`, `npm run format:check`, `npm run check:secrets`, `npm run check:vendor` | Style, unsafe DOM patterns, secret leakage and vendored-file hashes |
| Combined repository verification | `npm run verify` | Runs the repository's configured app checks |
| Database tests | `bash supabase/tests/run.sh` | Rebuilds a clean local PostgreSQL database from repository migrations, then checks RLS, grants, permissions, validation, idempotency, immutable records and module-specific rules |
| Edge Function checks | CI Deno checks in `.github/workflows/ci.yml` | Type-checks the Edge Functions listed in the workflow |
| Workflow lint | CI actionlint step | Checks GitHub Actions workflow syntax |

## How to run

```sh
npm ci
npm run verify
bash supabase/tests/run.sh
```

The database runner needs a local PostgreSQL instance and `PGUSER`. The workflow also runs Deno and actionlint; local `npm run verify` alone does not prove those jobs passed. Inspect the actual GitHub Actions run.

## Recorded module-specific evidence

- Audit progress records DB tests through migrations 0401–0410 and unit/page tests for counting, compile, reports, final snapshot and expiry. Its 19 Nov handover records the full main test suite at 1,562 unit tests and the database suite passing.
- Manager progress records a 2,434-check DB suite and 1,267 unit tests at its 17 Nov snapshot. These are historical module-session totals, not additive to the current main total.
- Closing progress records successive DB and page tests through 0211; its individual session counts are historical snapshots.
- Inventory progress records feed/delta, export, sync and screen tests; individual counts are from earlier snapshots.
- Workspace (Phase 4, 19 Nov 2026): 176 unit tests in eight files (`tests/unit/workspace-*.test.js`: validation, permissions, revisions/documents/data layer, editor model, autosave, editor, pages) and database tests `1100_workspace_core_test.sql` (149 checks), `1101_workspace_notes_test.sql` (115 checks) and the generated `1101_workspace_note_cases_test.sql` (37 cases). The editor tests run the real vendored ProseMirror in jsdom; the page tests mock the data layer. After merging `main`, the full suite was 1,669 unit tests with one failure that also fails on clean `main` (`ebill-page.test.js`, cash-received entry) and 71 database test files passing.
- Invoice Desk progress records initial domain and SQL amount-words tests, but explicitly says full repository verification, full DB suite and E2E/RLS coverage still need to be run with the integrated main tree.
- Shared fixtures include Sales totals, Closing calculations/periods, Manager credit and Workspace note validation. Browser and SQL rules should remain in parity where fixtures are shared.

## Live verification recorded (not independently re-run here)

- Inventory migrations 0301–0308 and Edge Function v23 are recorded live; hourly sync has recorded successful runs. Real-phone PDF acceptance and sync fallback cleanup remain.
- Manager migrations 0101–0108 are recorded live and registered; Credit Inbox still needs a real Closing-data test.
- Closing migrations 0201–0211 are recorded live in progress notes. A live-only 0214 migration is reported by Manager progress but has no matching repository migration file; resolve this drift before further database work.
- STR migrations 0500–0504 and scheduled archive/overdue jobs are recorded live.
- Emergency Billing 0601/0602, 0610–0612, 0620–0622, 0630–0634 and 0640–0642 are recorded live (0633/0634/0640/0641 on 20 Nov 2026 and 0642 on 21 Nov 2026, each with owner approval; read-only safety checks passed).
- Audit migrations 0401–0410 and Inventory 0308 are recorded live.
- Candela Sales 0900 is recorded live.
- Invoice Desk migrations 1000–1003 are recorded live in its progress file.
- Workspace migrations 1100 and 1101 are recorded live in its progress file.

These statements come from module progress records. Before production changes, query the actual live migration registry and verify the deployed function bodies.

## Not yet proven / gaps

- Fresh green GitHub Actions run on current main, including Deno and actionlint jobs.
- Complete real-device acceptance for the current UI across the pharmacy's Android/desktop devices.
- Real Gmail send from the deployed origin with the owner's Google account.
- A restore drill from a real encrypted Drive backup into a separate empty Supabase project.
- Load, long-running, offline and low-memory behaviour on actual pharmacy phones.
- Invoice Desk full save/product/history/RLS E2E tests and physical printer output.
- Emergency Billing real-device and real-printer acceptance (owner checklist in `docs/modules/ebill-phase6.md` section 3) and live granting of `ebill.*` rights.
- Workspace Notes real-phone and two-account acceptance (jsdom only so far: layout, touch selection, on-screen keyboard, bottom-sheet dialogs and the Content-Security-Policy are unverified in a real browser).
- Playwright browser end-to-end automation and Sentry production monitoring.

A passing jsdom or local PostgreSQL test proves only its test scope. It does not prove real-device usability, Google integration, production restore, or every live permission path.
