# Testing and verification

**Baseline:** 27 Nov 2026, commit `07e87e4` plus the Audit 0 branch. Commands, results and limits: `docs/AUDIT_0_BASELINE.md`. Per-module matrix: `docs/TEST_ACCEPTANCE_MATRIX.md`. Older module-session counts (1,267, 1,562, 1,891, 1,933, 2,434 and so on) are history and must not be added together or compared with today's totals.

## Current baseline (reproducible)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | pass |
| Formatting | `npm run format:check` | pass (`.md`, `.ts`, `.sql`, `android-app/` are excluded by `.prettierignore`) |
| Unit and page tests | `npm test` | pass: 202 files, 3,601 tests (197 files and 3,514 tests before Audit 0); no `.skip`, `.only` or `.todo` |
| Database tests | `bash supabase/tests/run.sh` (PostgreSQL 16) | pass: 131 migrations applied to an empty database, 119 test files, 3,268 `pass:` lines plus 843 `pass (refused)` lines, 0 FAIL/ERROR (3,209 `pass:` lines before Audit 0) |
| Edge Function types | `deno check --no-lock <fn>/index.ts` for all 7 | pass |
| Edge Function handlers | `tests/unit/edge-*.test.js` | `staff-login`, `admin-users`, `attendance-event`, `widget-today`, `notify-push` secret gate. Not covered: `sync-inventory-from-dropbox`, `notify-ntfy`, `notify-push` delivery |
| Workflow lint | `actionlint` | pass |
| Secrets and vendor | `npm run check:secrets`, `npm run check:vendor` | pass |
| Service-worker precache | `npm run build:sw` | no drift |
| Coverage | `npm run test:coverage` | 87.6% statements, 86.6% branches, 88.1% functions, 87.6% lines over `js/**` and `supabase/functions/**/*.ts` (v8; not a quality gate) (measured, not enforced) |
| Android | `node android-app/scripts/check-shell.mjs` | pass. Gradle unit test and APK build run only in GitHub Actions |

A passing jsdom or local PostgreSQL test proves only its own scope. It does not prove real-device behaviour, Google integration, a production restore, the live database's state, or any owner workflow.


## Test suites

| Suite | Command / location | Coverage |
|---|---|---|
| Front-end unit and page tests | `npm test`; `tests/unit/` | Domain calculations, parsing, permission registry, page interactions in jsdom, save/retry/conflict, view-only states, print/copy and Gmail dialogs |
| Repository checks | `npm run lint`, `npm run format:check`, `npm run check:secrets`, `npm run check:vendor` | Style, unsafe DOM patterns, secret leakage and vendored-file hashes |
| Combined repository verification | `npm run verify` | Runs the repository's configured app checks |
| Database tests | `bash supabase/tests/run.sh` | Rebuilds a clean local PostgreSQL database from repository migrations, then checks RLS, grants, permissions, validation, idempotency, immutable records and module-specific rules |
| Edge Function checks | CI Deno checks in `.github/workflows/ci.yml` (all 7 functions) and handler tests `tests/unit/edge-*.test.js` | Types; for five functions the handler's real code path against fake Supabase clients (`tests/helpers/edgeHarness.js`) |
| Whole-database invariants | `supabase/tests/0999_global_exposure_test.sql` | Every public table has RLS; every SECURITY DEFINER function pins `search_path`; the visitor role runs no function outside a documented list (KI-1) |
| Workflow lint | CI actionlint step | Checks GitHub Actions workflow syntax |

## How to run

```sh
npm ci
npm run verify
bash supabase/tests/run.sh
```

The database runner needs a local PostgreSQL instance and `PGHOST`, `PGUSER`, `PGPASSWORD`; it creates and drops its own database, so never point it at a real project. The workflow also runs Deno and actionlint; local `npm run verify` alone does not prove those jobs passed. Inspect the actual GitHub Actions run.

## Recorded module-specific evidence

- Audit progress records DB tests through migrations 0401–0412 (0412 adds `0412_audit_individual_autocompile_test.sql`, 16 checks; at that change the full database suite and `npm run verify` with 125 files / 1,933 unit tests passed locally on PostgreSQL 16) and unit/page tests for counting, compile, reports, final snapshot, expiry and barcode. Its 19 Nov handover records the full main test suite at 1,562 unit tests and the database suite passing.
- Manager progress records a 2,434-check DB suite and 1,267 unit tests at its 17 Nov snapshot. These are historical module-session totals, not additive to the current main total.
- Closing progress records successive DB and page tests through 0211; its individual session counts are historical snapshots.
- Inventory progress records feed/delta, export, sync and screen tests; individual counts are from earlier snapshots.
- Workspace (Phase 4, 19 Nov 2026): 176 unit tests in eight files (`tests/unit/workspace-*.test.js`: validation, permissions, revisions/documents/data layer, editor model, autosave, editor, pages) and database tests `1100_workspace_core_test.sql` (149 checks), `1101_workspace_notes_test.sql` (115 checks) and the generated `1101_workspace_note_cases_test.sql` (37 cases). The editor tests run the real vendored ProseMirror in jsdom; the page tests mock the data layer. After merging `main`, the full suite was 1,669 unit tests with one failure that also fails on clean `main` (`ebill-page.test.js`, cash-received entry) and 71 database test files passing.
- Invoice Desk is integrated on main and CI #401 passed app/database/functions on the audited commit; dedicated E2E save/product/history/RLS coverage and physical print acceptance remain.
- Workspace Sheets (22 Nov 2026): `tests/unit/workspace-spreadsheet.test.js` (47 tests) and the generated database test `1102_workspace_sheet_parity_test.sql` (85 checks) share `tests/fixtures/workspace-sheet-cases.json`; the model and PostgreSQL must give identical answers. Regenerate with `node tools/workspace-sheet-cases.mjs` (add `--record` to store new model answers).
- Workspace Sheets formulas (24 Nov 2026), 553 tests in 7 files: `workspace-formulas-fixtures.test.js` runs 282 hand-checked cases from `tests/fixtures/workspace-formula-cases.json` (invented numbers; answers follow the rules in `docs/modules/workspace.formulas.md`, written first); `-parse` (lexer, parser, precedence, plain-English errors with positions, limits, A1 helpers, cycle components including a 200,000 chain); `-values` (conversions, comparison, rounding with property checks); `-engine` (what changed, only what is affected is recalculated, cycles forming and breaking, 50,000-formula chain, and 8 seeds x 250 rounds proving incremental recalculation equals recalculating from scratch with an exact changed-cell report); `-rewrite` (insert, delete, copy; inserting rows never changes a number; deleting unread rows never changes a number; round trips); `-sheetcalc` (ids to positions, and a real insert or delete on the sheet model plus the rewrite keeps every number); `-fuzz` (60,000 hostile or damaged formulas: nothing throws, nothing is executed; the formula files contain no eval, dynamic code, network, DOM, storage or timers). Of seventeen deliberate mutations, sixteen were caught and one showed redundant code, which was removed. Real Chromium 153 (harness `formulas.cjs`): results, errors, circular, running totals, recalculation after an edit (about 110 ms), no number cut short; an independent calculation confirmed one displayed average. Not verified: real phone, screen reader, two accounts, formulas against the real database.
- Workspace Sheets cell editing (24 Nov 2026): `tests/unit/workspace-cellinput.test.js` (17: what typing becomes, apostrophe, formulas refused, style kept, round trip of stored text), `workspace-sheet-edit.test.js` (27: save, keep formatting, clear, Enter/Escape, draft guards, locked resend with the same operation id, lost reply is not a self-conflict, Discard, refusals, conflict with Use mine and Keep theirs, deleted row, stylesheet guard) and the updated `workspace-sheet-ui.test.js`. Workspace unit tests: 362 in 14 files. Real Chromium 153 (throwaway harness outside the repo, reference model as the server): edit saved with style kept, formula refused, draft blocks moving, real conflict resolved; this found the always-visible conflict buttons that jsdom could not show. Not verified: real phone, screen reader, two real accounts, edit flow against the real database.
- Workspace Sheets data layer (22 Nov 2026): `tests/unit/workspace-workbooks.test.js` (41 tests) runs `data/workbooks.js` against the reference model as a fake server (paging, a write landing between pages, a restore while opening, a reply lost after the server applied a batch and the same ids resent, refusal and hold, batch cutting, integer-range ids refused before sending, restore point calls). Five mutations of the code were each caught. Workspace unit tests: 264 in ten files. Not verified: a real browser or phone, and the data layer against the real database (no screen calls it yet).
- Workspace Sheets grid (23 Nov 2026): `tests/unit/workspace-grid.test.js` (19: layout, visible range with frozen rows, number, currency, percent and date display, whitelisted styles) and `tests/unit/workspace-sheet-ui.test.js` (35, jsdom: virtualised drawing, scroll, frozen panes, header paint order, selection by tap and keys, refresh, restore reload, failed refresh, Add a sheet, viewer and archived, home New workbook, source guards against innerHTML, cssText and style attributes). Seven mutations were each caught. A one-off check in a real Chromium (throwaway harness, the app's CSP) covered layout, scrolling, touch tap, keyboard, dark mode, landscape and frame cost; it is not part of the suite. Workspace unit tests: 318 in twelve files. Not verified: a real phone, a screen reader.
- Shared fixtures include Sales totals, Closing calculations/periods, Manager credit and Workspace note validation. Browser and SQL rules should remain in parity where fixtures are shared.

## Live verification recorded (not independently re-run here)

- Inventory migrations 0301–0309 are present in the live registry (registered by repo number); `sync-inventory-from-dropbox` is active at Edge Function v24. Real-phone PDF acceptance and sync fallback cleanup remain.
- Manager migrations 0101–0108 are recorded live and registered; Credit Inbox still needs a real Closing-data test.
- Closing migrations 0201–0214 are in the repository and live registry. Later Closing migrations 0215–0218 are registered by repo number too.
- STR migrations 0500–0504 and scheduled archive/overdue jobs are recorded live.
- Emergency Billing 0601/0602, 0610–0612, 0620–0622, 0630–0634 and 0640–0642 are recorded live (0633/0634/0640/0641 on 20 Nov 2026 and 0642 on 21 Nov 2026, each with owner approval; read-only safety checks passed).
- Audit migrations 0401–0412 and Inventory 0308 are in the live registry; all are registered by repo number (`0412` was renamed from `20261122035159` on 22 Nov 2026). Barcode is integrated; phone/scanner acceptance remains.
- Candela Sales 0900 is recorded live.
- Invoice Desk migrations 1000–1003 are live and registered by repo number; exact source files remain in the repository.
- Workspace migrations 1100, 1101, 1102 and 1110 are recorded live (1102 applied and verified 21 Nov 2026); details in its progress file.

These statements come from module progress records. Before production changes, query the actual live migration registry and verify the deployed function bodies.

## Not yet proven / gaps

- Real-device acceptance for current UI across the pharmacy's Android/desktop devices; CI does not cover physical phones, printer drivers, Gmail delivery or owner workflow acceptance.
- Real Gmail send from the deployed origin with the owner's Google account.
- A restore drill from a real encrypted Drive backup into a separate empty Supabase project.
- Load, long-running, offline and low-memory behaviour on actual pharmacy phones.
- Invoice Desk full save/product/history/RLS E2E tests and physical printer output.
- Emergency Billing real-device and real-printer acceptance (owner checklist in `docs/modules/ebill-phase6.md` section 3) and live granting of `ebill.*` rights.
- Workspace Notes real-phone and two-account acceptance: accepted by the owner after live testing (21 Nov 2026, reported in chat). Automated tests remain jsdom only.
- Playwright browser end-to-end automation and Sentry production monitoring.
- Handler tests for `sync-inventory-from-dropbox` and `notify-ntfy`; database tests for the migrations listed in `docs/KNOWN_ISSUES.md`; Invoice Desk page tests.
- PostgreSQL 17 (the live version per older documents); the suite runs on 16 (KI-7).

A passing jsdom or local PostgreSQL test proves only its test scope. It does not prove real-device usability, Google integration, production restore, or every live permission path.
