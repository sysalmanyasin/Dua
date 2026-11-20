# Audit module: handover for the next session

**State on 20 Nov 2026.** Slices A1–C1 are on `main`. **C2 Barcode is built and tested on branch `module/audit-c2`** (not yet merged). Migration `0411` is written and passes the DB suite but its live apply was blocked (the Supabase tool timed out waiting for the owner to approve a prompt); **check `select * from supabase_migrations.schema_migrations where name like '%0411%'` and the three tables before assuming it is live**. Next: confirm 0411 live, PHONE 1/2/3, then D Hardening. Read `docs/modules/audit.md` (design, AUD-1..13) and `docs/modules/audit.progress.md` first.

## What exists
- **Database** `0401`–`0410` (Audit) and `0308` (Inventory interface), all applied live on project `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`) and registered in `supabase_migrations.schema_migrations`. Live migrations are applied with the Supabase `apply_migration` tool (0409 was) or by hand with `execute_sql` plus a registry insert; the file in `supabase/migrations/` is the source.
- **App** `js/modules/audit/`: hub, engagements and rounds, counting screen with offline outbox (IndexedDB), Individual Audit (one rolling engagement per month, by template, codes or companies), templates, review and compile screen (Force Submit, corrections, conflicts, next round).
- **Rules to keep:** every new round takes fresh stock from Inventory and freezes it; no blind counting (AUD-4); counters see system qty, price, variance, value for their own assignment (AUD-5); compile writes a new revision each time; conflicts are never auto-resolved; approved corrections apply at the next compile.

## Check before anything else
1. `main` is at or after `f240711` (19 Nov 2026). It was fast-forwarded by `git push` with no pull request, so confirm the GitHub Actions run on `main` is green (the Deno and workflow jobs were not run locally).
2. The session proxy may not hold a GitHub credential for the repo and the GitHub API may be blocked. The owner supplies a PAT when needed (use it once via `git -c http.extraheader=...`, never store it, ask the owner to revoke it). The repo has moved to `sysalmanyasin/Dua`.

## Next work
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
