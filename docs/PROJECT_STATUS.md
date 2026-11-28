# Project status

**Snapshot:** 27 Nov 2026, commit `07e87e4` on `main` plus the Audit 0 branch. **Method:** every statement below was checked against the source or by running the check; `docs/AUDIT_0_BASELINE.md` lists the commands. The previous status text (22 Nov) was replaced because it contradicted the code in many places; it remains in git history. Other dated documents (`PROJECT_PROGRESS.md`, `CHANGELOG.md`, `PROJECT_AUDIT_*`, `modules/*.progress.md`) are history, not current status.

**Repository:** https://github.com/sysalmanyasin/Dua. **Live site:** https://sysalmanyasin.github.io/Dua/.

<!-- repo-facts -->
- Migration files: 137
- Database test files: 123
- Registered modules: 15
- Edge Functions: 8
<!-- /repo-facts -->

The block above is checked by `tests/unit/docs-consistency.test.js`. Update it when you add a migration, a database test file, a module or a function. (Raised on 28 Nov 2026 after merging newer work into `main`; the pass/fail results quoted below were measured on 27 Nov at 131 migrations, 119 test files and 7 Edge Functions and have not been re-run at the new counts.)

## What the words mean

- **Verified (automated)**: the code exists on `main` and its automated tests passed in this audit. It is **not** the same as accepted.
- **Accepted**: the owner or a real device has confirmed it. This audit cannot grant it; no module is marked accepted here.
- **Recorded live**: an older document says it was applied to the live Supabase project. **Not re-checked by this audit.**

## 1. Implemented and verified (automated only)

Fifteen modules are registered in `js/modules/index.js` and their automated tests pass: **home, sales, manager** (including attendance), **access, tools, closing, inventory, str, candela-sales, ebill** (Emergency Billing), **audit** (counting, compile, expiry, barcode, outbox), **invoice-desk, workspace** (notes and sheets), **tasks, inbox**. Behind them: 131 migrations that apply cleanly to an empty PostgreSQL 16, 7 Edge Functions that type-check, a service worker whose precache list is current, and an Android shell that passes its consistency check. See `docs/TEST_ACCEPTANCE_MATRIX.md` for each module's tests and what is still missing.

## 2. Implemented but not fully tested

- **Every Edge Function handler except what Audit 0 added.** Handler tests now cover `staff-login`, `admin-users`, `attendance-event`, `widget-today` and the secret gate of `notify-push`. `sync-inventory-from-dropbox`, `notify-ntfy` and `notify-push` delivery have none.
- **Invoice Desk:** domain and database integrity tests only; no page or end-to-end tests; no physical-printer check.
- **Tasks:** 7 routes, 3 unit-test files.
- **Workspace:** editor and sheets are tested in jsdom only.
- **Closing, Audit, Inventory, Emergency Billing, STR, Manager:** automated tests pass; owner/device acceptance remains, and some migrations have no test of their own (see `docs/KNOWN_ISSUES.md`).
- **Android app:** compiles in GitHub Actions per the Actions API (logs not read here); no device test recorded in this audit.
- **Gmail send and Drive backup upload:** need real Google accounts; not exercised here.

## 3. Incomplete features

- **Workspace sheets:** built: workbooks, virtual grid, cell editing with conflict handling, a formula engine, sheet management (add, rename, reorder, delete). Not built, per `docs/modules/workspace.design.md`: cell formats beyond display, row and column structure changes, CSV, offline editing and synchronisation, attachments.
- **Emergency Billing:** the `ebill.*` permissions are recorded as not yet granted to anyone live.
- **Separate production environment:** does not exist; production uses the staging project (`js/core/config.js:3-7`).
- **Browser end-to-end tests and error monitoring:** not present.
- **Unified Reports, assistant/AI:** not started.

## 4. Known defects

See `docs/KNOWN_ISSUES.md`: KI-1 (five functions callable by the visitor role, low severity), KI-2 (malformed amount in words below one rupee), and the release-path risks KI-3 to KI-8.

## 5. Future roadmap

`docs/ROADMAP.md` is the ordered list of remaining work. Audit 0 adds the items at the end of `docs/KNOWN_ISSUES.md`.

## Evidence

Run on this branch (see `docs/AUDIT_0_BASELINE.md` for the baseline before Audit 0 and for what could not be run):

| Check | Result |
|---|---|
| `npm run lint`, `format:check`, `check:secrets`, `check:vendor` | pass |
| `npm test` | pass: 202 files, 3,601 tests (197 files and 3,514 tests before Audit 0) |
| `bash supabase/tests/run.sh` (PostgreSQL 16) | pass: 131 migrations, 119 test files, 3,268 `pass:` lines plus 843 `pass (refused)` lines, 0 FAIL/ERROR (3,209 `pass:` lines before Audit 0) |
| `deno check` (7 functions), `actionlint`, `build:sw` (no drift) | pass |
| `npm run test:coverage` | 87.6% statements, 86.6% branches, 88.1% functions, 87.6% lines over `js/**` and `supabase/functions/**/*.ts` (v8; not a quality gate) |

Not run or not verifiable here: Gradle unit tests and APK build, live Supabase state, real devices, Gmail, Drive restore, owner acceptance.

## Where to look next

`docs/TEST_ACCEPTANCE_MATRIX.md` (per-module tests and gaps), `docs/KNOWN_ISSUES.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/DATABASE_DESIGN.md`, `docs/TESTING.md`, `docs/RUNBOOK.md`, `docs/SETUP.md`, `docs/MODULES.md`, `docs/ROADMAP.md`.
