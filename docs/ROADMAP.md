# Roadmap: what is left, in order

## A. Before relying on the system
1. **Automatic backups.** Built and tested locally (12 Nov 2026, D-38). **Owner setup remaining** (RUNBOOK §6): age key, Google refresh token, GitHub `backup` environment, merge to `main`, first run, then the restore drill. Interim: manual weekly dump.
2. **Owner try-out on a real phone** of the newest pages (Dashboard, Reports, Fields, Targets, Gmail, Cover) and fixes.
3. **Google Cloud origin step** for Gmail (`SETUP.md`).
4. **Revoke GitHub tokens** used in chat.
5. **Reconcile the migration registry** (`RUNBOOK.md` §4): Foundation owner.
6. **Tidy-up on Supabase:** delete the now-inactive `import-sales` Edge Function and the uploaded backup file in Storage → `imports` (it holds salaries), then the empty folder.
7. **Separate production project** and config; keep staging for tests.

## B. Sales leftovers
| Item | Waiting for |
|---|---|
| Payments page (card/bank payment summaries) | Candela feed screens (data tables exist from the feed session) |
| Daily Check List auto-fill (opening/closing stock, receives, returns, customers) | Candela inventory feed, then a rule-by-rule port |
| "Total Credit" status pill | the credit ledger (Closing / Manager) |
| Bar Race animation, "since you last looked", rule alerts and e-mail briefing | owner's decision; not ported from the old dashboard |
| Differentiate Senior and Junior | owner's decision |
| Screens for `till_float`, `per_customer_charge`, `modules_disabled` settings | with Closing |

## C. Next modules (see `docs/MODULES.md` and `docs/modules/*.md`)
Manager (staff records, salary, payslips, petty cash, credit) → Closing (shifts, cash counting, Closing Book, Register Book, credit ledger, COD) → Inventory & STR screens → Audit Hub (offline counting) → Emergency billing → unified Reports → read-only assistant (numbers stay deterministic) → Android widgets (last).

## D. Quality and operations
Playwright login and Add Entry tests · Sentry error reporting · general offline outbox (closing, audit) · accessibility pass · performance check on a low-end phone · security review before launch · restore drill each quarter.

## Decisions waiting for the owner
Senior vs Junior differences · whether to port Bar Race and the briefing e-mail · whether Attendance/geofencing comes back (parked until the Android phase) · who owns migration reconciliation.
