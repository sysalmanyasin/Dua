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
