# PROJECT_PROGRESS
| Date | Task | Done | Tested | Failed | Next |
|---|---|---|---|---|---|
| 2026-11-05 | Phase 0 business rules from old code | yes (draft) | n/a | — | owner approval; answer ASK items |
| 2026-11-05 | Phase 1 design docs | yes | n/a | — | approved by owner |
| 2026-11-05 | Owner answers: Candela source of truth, till_float, Re 1/customer, history import as separate job | yes | n/a | — | owner approval of docs, then Phase 2 |
| 2026-11-05 | Phase 2 database: core tables, RLS, permissions, MFA rule, logged admin functions | yes | 48 DB security checks pass (local Postgres 16) + mutation check | — | run on real staging |
| 2026-11-05 | Phase 2 app shell: login (staff/admin/MFA/request/claim), router, lazy modules, access module | yes | 42 unit/jsdom tests, lint, secret scan, vendor hash | — | try in a real browser on staging |
| 2026-11-05 | Phase 2 Edge Functions (staff-login, request-access, claim-account, admin-users) | yes | type-checked with Deno; shared logic unit tested | not yet run against a live project | deploy to staging and run SETUP.md step 9 |
| 2026-11-05 | Not done in Phase 2 | — | — | — | offline outbox (Phases 6/7), Sentry, daily Drive backup workflow (needed before Phase 3 data), Playwright login test |
| 2026-11-05 | Pushed Phase 2 to GitHub main; Supabase integration applied 0001_core to DuaPharmaPlus | yes | live check: 11 tables, 0 without RLS, 25 permissions, anon has 0 grants | — | functions, auth settings, first admin |
| 2026-11-05 | Phase 2 accepted by owner | yes | owner ran request, approve, PIN, login, lockout on staging; DB log matches | — | — |
| 2026-11-05 | Phase 3 study: old Sales app mapped; backup of 2,379 days checked against formula | yes | 8 unit tests for the checker; real-data run: 2,378/2,379 totals reproduce with signed rule | 111 mismatches under old formula, explained | owner decisions D-24, April 2022, 25 Sep 2026 |
| 2026-11-05 | Phase 3a database: payment methods, daily sales, revisions, save/last-day functions, monthly view | yes | 91 DB checks (incl. shared formula cases vs browser), mutation check on sales.edit rule | — | live apply, then Entry/Data pages |
| 2026-11-05 | One-time sales import tooling: 0003 helper (token + batch insert), import-sales function, shared lib, payload builder | yes | 109 DB checks, 66 unit tests, Deno type-check | not yet run live | owner uploads backup to private bucket; dry run; confirm decisions; apply; remove helper |
| 2026-11-05 | Sales history imported (2,379 days) and verified against original monthly totals | yes | 79/80 months exact; Sep 2026 differs by the flagged 5,674; every day's total = sum of its lines | — | review 25 Sep 2026; remove uploaded backup file; Entry and Data pages |
| 2026-11-05 | Temporary import helper removed (migration 0004, function folder deleted) | yes | 91 DB checks | — | confirm function and bucket file are gone on Supabase |
| 2026-11-05 | Phase 3a UI: Sales module with Add Entry, Daily Data, Index, Diff Report, Cash to Deposit, Last Day (staff); page-level permissions and submenu in shell; report view migration 0005 | yes | 97 unit/jsdom tests (incl. Entry page driven in jsdom), 95 DB checks | not yet seen on a real phone | owner try-out; then Day/Sale report (copy HTML, Gmail), Daily Check List, then dashboard 3b |
