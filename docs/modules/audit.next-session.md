# Audit module: handover for the next session

**State on 22 Nov 2026.** Individual Audit rounds now compile themselves on submit (`0412`, live; see "0412" in `audit.progress.md`). Slices A1–C2 are on `main`; Barcode is implemented, not paused. Live registry has `0411_audit_barcode` under its repo number (17 functions; RLS on the three new tables). Next: PHONE 1/2/3, scanner/offline acceptance, print/CSV checks, then D Hardening. Read `docs/modules/audit.md` and `docs/modules/audit.progress.md` first.

## What exists
- **Database** `0401`–`0412` (Audit) and `0308` (Inventory interface), all applied live on project `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`) and registered in `supabase_migrations.schema_migrations`. Every registry row carries its repo version (22 Nov 2026; `0412` was applied with `apply_migration` by mistake and renamed from `20261122035159`). Do not use `apply_migration` for repo-numbered work; follow RUNBOOK §4.
- **App** `js/modules/audit/`: hub, engagements and rounds, counting screen with offline outbox (IndexedDB), Individual Audit (one rolling engagement per month, by template, codes or companies), templates, review and compile screen (Force Submit, corrections, conflicts, next round).
- **Individual rounds (0412):** submit compiles the round in the same transaction through `audit_compile_round_core` (internal, not callable by users); no cross-round conflicts are raised in the individual engagement (AUD-14); reopen is refused while the person has another open self-pick; no `audit.compiled` owner alert for individual rounds. Normal rounds are unchanged.
- **Rules to keep:** every new round takes fresh stock from Inventory and freezes it; no blind counting (AUD-4); counters see system qty, price, variance, value for their own assignment (AUD-5); compile writes a new revision each time; conflicts are never auto-resolved; approved corrections apply at the next compile.

## Check before anything else
1. `main` is at or after `f240711` (19 Nov 2026). It was fast-forwarded by `git push` with no pull request, so confirm the GitHub Actions run on `main` is green (the Deno and workflow jobs were not run locally).
2. The session proxy may not hold a GitHub credential for the repo and the GitHub API may be blocked. The owner supplies a PAT when needed (use it once via `git -c http.extraheader=...`, never store it, ask the owner to revoke it). The repo has moved to `sysalmanyasin/Dua`.

## Next work
- **PHONE 4 (new):** Individual Audit auto-compile on a real phone: submit, see "Your result", tap **Start another audit**. Not done.
- **Registry:** reconciled on 22 Nov 2026; nothing to fix. Backup tables `schema_migrations_backup_20261121` and `..._20261122` can be dropped after review (the 12 Nov one is already dropped).
- **PHONE 1 / PHONE 2:** real-phone tests (counting offline and back online; two people, two rounds, end to end). Not done.
- **B2 is built** and merged (see progress doc). Still to do on it: try Print / Save as PDF and the CSV on a real phone and desktop.
- **C1 is built** and merged (see progress doc; optional later: CSV/print of the register, expiry-by-month summary). **C2 Barcode** is next: Center, register, verify, conflicts, scanner, scan outbox, hybrid counting. It needs the vendored scanner libraries and the Foundation requests (`audit.md` section 7).
- **Foundation request OD-6** is done in C2 (`js/shared/outbox.js`, `js/core/app.js`).
- **Company picker** in the Individual Audit screen can now use `inventory_companies()` (currently a typed list).
- **D Hardening and acceptance** follows C2 (offline end-to-end, accessibility, low-end phone, data-use review, MODULES.md §11).
- Owner decision pending: none open for Audit. AUD-1..13 accepted.

## How to test
- `service postgresql start`, then `bash supabase/tests/run.sh` (must end "ALL DATABASE TESTS PASSED"). It applies all migrations first, then runs every `*_test.sql` in name order.
- `npm run verify` (lint, prettier, vitest, secret and vendor checks). After adding or removing app files run `node tools/sw-precache.mjs`.
- CI jobs: app, database, functions (`.github/workflows/ci.yml`). Pull-request CI runs on the merge with `main`, so merge `main` in and re-run before blaming your own change.

## Gotchas learned
- DB tests run in one transaction, so `now()` is the same everywhere: to test `compile_stale` the test moves a correction's `decided_at` forward by a minute, then back.
- The old failures in `shell.test.js`, `cover.test.js`, `service-worker.test.js` and Prettier were fixed on 19 Nov 2026; a clean `main` should pass all of `npm run verify`. The service-worker tests read the cache name from `sw.js`.
- Audit tests define a stand-in `inventory_products_for_scope`; keep it `create or replace` with the exact columns `(code, name, company, qty, price)`.
- Owner-level calls in DB tests need `aal2`.
- Error hints in 04xx migrations must each have a sentence in `js/modules/audit/domain/errors.js` (a test checks both ways).
- Temp tables inside `audit_round_next` are dropped explicitly (no `ON COMMIT DROP`) so it can run twice in one transaction.
- The stop hook may claim "unpushed commits / no remote branch" when pushing with a token header; trust `git ls-remote`.
- A function that is internal (called only by another security-definer function) needs `revoke all ... from public, anon, authenticated` and no grant back; a test should show a counter gets "permission denied" (no hint code), so use `pg_temp.fails`, not `pg_temp.refused`.
- Counters cannot read `audit_assignments` or `audit_assignment_items` directly in tests; read through `audit_my_assignments()` and `audit_my_items()`.
- An untouched item reads as counted 0, so in a two-item round with one item counted, two rows can show a variance.
