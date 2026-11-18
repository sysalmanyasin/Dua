# Audit module: handover for the next session

**State on 18 Nov 2026.** Branch `module/audit-a5` (merged into `main` on 18 Nov 2026 and kept as the working branch; the old `module/audit` branch was deleted) (A5, B1, 0408 fresh stock, 0308 Inventory interface, plus formatting of 16 files `main` left unformatted). Read `docs/modules/audit.md` (design, AUD-1..13) and `docs/modules/audit.progress.md` (what each slice did) first.

## What exists
- **Database** `0401`–`0408` (Audit) and `0308` (Inventory interface), all applied live on project `DuaPharmaPlus` (`sdsynzsflubdxnelgthh`) and registered in `supabase_migrations.schema_migrations`. Live migrations are applied by hand with `execute_sql` plus a registry insert; the file in `supabase/migrations/` is the source.
- **App** `js/modules/audit/`: hub, engagements and rounds, counting screen with offline outbox (IndexedDB), Individual Audit (one rolling engagement per month, by template, codes or companies), templates, review and compile screen (Force Submit, corrections, conflicts, next round).
- **Rules to keep:** every new round takes fresh stock from Inventory and freezes it; no blind counting (AUD-4); counters see system qty, price, variance, value for their own assignment (AUD-5); compile writes a new revision each time; conflicts are never auto-resolved; approved corrections apply at the next compile.

## Check before anything else
1. Merged into `main` on 18 Nov 2026. `main`'s `app` job was red on Prettier (fixed) and on 15 unit tests in cover, service-worker and shell that are not Audit's; see `docs/PROJECT_STATUS.md`.
2. Commit `0308` + test changes are the last local work; confirm `git ls-remote origin module/audit-a5` equals local HEAD. If not, push.
3. The session proxy may not hold a GitHub credential for the repo; the owner supplies a PAT when needed (use it once via `git -c http.extraheader=...`, never store it, ask the owner to revoke it).

## Next work
- **PHONE 1 / PHONE 2:** real-phone tests (counting offline and back online; two people, two rounds, end to end). Not done.
- **B2:** Final Snapshot, reports with print/PDF, audit-trail view, owner alerts.
- **Foundation request OD-6** (outbox / sign-out guard) is still outstanding.
- **Company picker** in the Individual Audit screen can now use `inventory_companies()` (currently a typed list).
- Owner decision pending: none open. AUD-1..13 accepted.

## How to test
- `service postgresql start`, then `bash supabase/tests/run.sh` (must end "ALL DATABASE TESTS PASSED"). It applies all migrations first, then runs every `*_test.sql` in name order.
- `npm run verify` (lint, prettier, vitest, secret and vendor checks). After adding or removing app files run `node tools/sw-precache.mjs`.
- CI jobs: app, database, functions (`.github/workflows/ci.yml`). Pull-request CI runs on the merge with `main`, so merge `main` in and re-run before blaming your own change.

## Gotchas learned
- Audit tests define a stand-in `inventory_products_for_scope`; keep it `create or replace` with the exact columns `(code, name, company, qty, price)`.
- Owner-level calls in DB tests need `aal2`.
- Error hints in 04xx migrations must each have a sentence in `js/modules/audit/domain/errors.js` (a test checks both ways).
- Temp tables inside `audit_round_next` are dropped explicitly (no `ON COMMIT DROP`) so it can run twice in one transaction.
- The stop hook may claim "unpushed commits / no remote branch" when pushing with a token header; trust `git ls-remote`.
