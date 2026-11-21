# Testing and verification

**Status snapshot:** 21 November 2026. This document separates automated test evidence from live deployment and real-device acceptance.

## Latest recorded verification

Historical local baseline (19 Nov 2026):

- `npm run verify`: lint, format, secret and vendor checks passed; **1,562 / 1,562 unit tests passed**.
- `bash supabase/tests/run.sh`: full local PostgreSQL database suite passed.
- Deno Edge Function type checks and workflow lint were **not run locally** in that session.

Fresh GitHub Actions verification is available for `main` commit `96694979e65242f5ee24eb86f215630686b552c8`: CI run #401 passed all three jobs (app, database, functions) and Pages deployment #226 succeeded. This is workflow evidence for that exact commit, not a substitute for device acceptance.

As recorded for the 21 Nov 2026 `main` snapshot: 1,891 unit tests in 121 files; 77 database test files. The latest CI run on the same commit is green. Do not add module-specific test counts from different dates/branches.

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

- Inventory migrations 0301–0309 are present in the live registry (0309 timestamp-registered); `sync-inventory-from-dropbox` is active at Edge Function v24. Real-phone PDF acceptance and sync fallback cleanup remain.
- Manager migrations 0101–0108 are recorded live and registered; Credit Inbox still needs a real Closing-data test.
- Closing migrations 0201–0214 are in the repository and live registry. Later Closing migrations 0215–0217 and `closing_refresh_existing_drafts` are registered under timestamp versions; reconcile the registry mapping before future migration batches.
- STR migrations 0500–0504 and scheduled archive/overdue jobs are recorded live.
- Emergency Billing 0601/0602, 0610–0612, 0620–0622, 0630–0634 and 0640–0642 are recorded live (0633/0634/0640/0641 on 20 Nov 2026 and 0642 on 21 Nov 2026, each with owner approval; read-only safety checks passed).
- Audit migrations 0401–0411 and Inventory 0308 are in the live registry; 0409–0411 are timestamp-registered. Barcode is integrated; phone/scanner acceptance remains.
- Candela Sales 0900 is recorded live.
- Invoice Desk migrations 1000–1003 are live under timestamp registry versions; exact source files remain in the repository.
- Workspace migrations 1100, 1101, 1102 and 1110 are recorded live (1102 applied and verified 21 Nov 2026); details in its progress file.

These statements come from module progress records. Before production changes, query the actual live migration registry and verify the deployed function bodies.

## Not yet proven / gaps

- Real-device acceptance for current UI across the pharmacy's Android/desktop devices (CI is green on the audited main commit).
- Complete real-device acceptance for the current UI across the pharmacy's Android/desktop devices.
- Real Gmail send from the deployed origin with the owner's Google account.
- A restore drill from a real encrypted Drive backup into a separate empty Supabase project.
- Load, long-running, offline and low-memory behaviour on actual pharmacy phones.
- Invoice Desk full save/product/history/RLS E2E tests and physical printer output.
- Emergency Billing real-device and real-printer acceptance (owner checklist in `docs/modules/ebill-phase6.md` section 3) and live granting of `ebill.*` rights.
- Workspace Notes real-phone and two-account acceptance: accepted by the owner after live testing (21 Nov 2026, reported in chat). Automated tests remain jsdom only.
- Playwright browser end-to-end automation and Sentry production monitoring.

A passing jsdom or local PostgreSQL test proves only its test scope. It does not prove real-device usability, Google integration, production restore, or every live permission path.
