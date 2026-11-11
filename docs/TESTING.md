# Testing

## Suites
| Suite | Where | Count (10 Nov 2026) | What it proves |
|---|---|---|---|
| Front-end unit and page tests | `tests/unit/*.test.js` (27 files) | **242** | Calculations (totals, dashboard KPIs, check-list figures, reports), parsing, permissions in the registry, and each page driven in a simulated browser: typing, saving, retry, conflict, view-only, copy, print, Gmail dialog, charts (library mocked), escaping of hostile text |
| Database security tests | `supabase/tests/*_test.sql` (7 files) | **195 checks** | Row-level security, permissions, MFA rule, validation, idempotency, revisions, immutability of the log, views, field rules — run against a real Postgres 16 with all migrations applied in order |
| Edge Function type-check | `deno check` | 4 + feed function | The server functions compile; shared logic (PIN rules, codes, lockout) is unit-tested from Node |
| Repo checks | `npm run check:secrets`, `check:vendor`, ESLint, Prettier | — | No secrets, no unsafe DOM calls, vendored files unchanged |

## Shared test cases
`tests/fixtures/sales-total-cases.json` holds the TOTAL cases. The browser maths and the database function are both tested against **the same file**, so they cannot drift apart. The Sale Report maths is tested against the owner's screenshot of 4 Nov 2026 (net cash 589,533, net credit 25,225, grand total 614,758, difference 24,977).

## Real-data checks done
- The old formula was run over all **2,379** real days: 2,378 totals reproduce exactly with the signed rule; the old "absolute value" formula would have changed 110 historical days (see D-24).
- After import, **79 of 80** monthly totals match the original app exactly; the exception is the flagged day (25 Sep 2026, 5,674).
- Live database: every day's cash + banks + credit equals its total; monthly grand total 890,769,482 = days 879,587,129 + the April 2021 monthly figure.

## Tests that were proven able to fail (mutation checks)
Removing the MFA rule, the "sales.edit needed to correct" rule, and the first versions of several handlers made the matching tests fail, then they were restored. A bug (Cover cards built eagerly) and several wrong expectations were caught by tests before release.

## How to run
```
npm ci
npm run verify          # lint, formatting, front-end tests, secret scan, vendor hashes
bash supabase/tests/run.sh   # needs a local Postgres (PGUSER set); builds a clean database from all migrations, then runs the SQL tests
```
GitHub runs the same on every push.

## Not covered (be honest about this)
- A real browser on a real phone (layout, touch, print dialogs, Google sign-in window). The owner tried the earlier pages (login, request/approve, PIN, lockout, Add Entry) on a phone on 5–6 Nov 2026; **the Dashboard, Reports, Fields, Targets, Gmail sending and the newest design have not been seen on a phone by anyone yet.**
- Real Google sending (needs the origin added in Google Cloud).
- Load, long-running and low-memory behaviour.
- The inventory feed's live sync is tested by its own session.
