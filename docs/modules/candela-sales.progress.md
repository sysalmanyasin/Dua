# Candela Sales — progress

Last updated: 22 Nov 2026
Branch: `module/candela-sales` merged to `main`.
Status: Integrated; migration `0900` is live and registered; four owner screens and staff-safe daily total pill are present. Owner phone acceptance and ongoing hourly history-capture monitoring remain.

## Done

- Migration 0900 (permanent history tables, triggers, `candela_today_total()`, permissions) and database test `0900_candela_history_test.sql`.
- Domain helpers (paisa maths, month roll-ups, customer merge, comparisons) with unit tests.
- Read-only data layer, four owner screens, status pill.
- Status bar refresh lifecycle and shell change so staff with only today's total get the pill.
- Registry row and range in `docs/MODULES.md`.

## Tested

On 14 Nov 2026, before merging to `main`: `npm run verify` passed (lint, format, 740 unit/jsdom tests, secret scan, vendor hashes) and `bash supabase/tests/run.sh` passed on local Postgres 16 (36 Candela checks plus the whole existing suite).

## Not done / pending

- Owner try-out on a real phone.

## Live apply log

- 14 Nov 2026: `0900 candela_history` applied by hand to DuaPharmaPlus (`sdsynzsflubdxnelgthh`) and registered as version `0900`. Checked: 4 payment days (11–14 Nov) and 8 customer/day rows captured on first apply; RLS on all three tables; `anon` has no grants and cannot execute `candela_today_total()`; both triggers present; no role preset carries a Candela permission.
