# Manager — progress

## Session M-A (12 Nov 2026): DONE, waiting for PHONE #1

**Built (branch `module/manager`, nothing applied to the live project):**

| Step | What | Evidence |
|---|---|---|
| A0 | Brief: rules R1–R26 read from the old code, decisions MGR-5 to MGR-21, structure, permission design | `docs/modules/manager.md` |
| A1 | `0101_mgmt_staff.sql`: 11 new permissions, idempotency store, staff details, private details (own table + key), notes (immutable, soft delete), owner-gated reads `mgmt_staff_list` / `mgmt_staff_get`, `mgmt_staff_save`, `mgmt_note_add` / `mgmt_note_remove` | 79 DB checks; 4 mutation checks all caught |
| A2 | `0102_mgmt_credit.sql`: append-only `mgmt_credit_openings` and `mgmt_credit_entries`; `mgmt_credit_add`, `_reverse`, `_set_deduction`, `_set_opening`, `mgmt_credit_month` (the one definition of the credit maths) | 104 DB checks incl. 14 shared fixture cases; 7 mutation checks all caught |
| A3 | Module skeleton, `domain/credit.js` + `domain/staff.js`, `data/api.js`, shared fixture `tests/fixtures/manager-credit-cases.json` (same cases run in SQL and in the browser) | 28 unit tests incl. guards (every permission key used is seeded; no Manager key in any role preset; no national-ID field; no direct table writes from the page code) |
| A4 | `/manager/staff` (list, card: Details · Credit · Payslip placeholder · Notes) and `/manager/credit` (month picker, per-person block, add entry, reverse, deductions, opening balance) | 23 jsdom page tests; 3 UI mutation checks all caught |

**Totals:** `npm run verify` green (29 files, 294 tests; was 242). `bash supabase/tests/run.sh`: 385 checks, 0 failures (was 195).

**Decisions made while building (all in the brief §8):** MGR-18 permission design (editing implies reading; 14 keys), MGR-19 (deductions are ledger rows; a reversal is dated like the original; an entry cannot predate the opening month), MGR-20 (Manager's "active" is the payroll list, not the login), MGR-21 (names are read through Manager's own functions; core policies untouched).

**Things the next session / owner should know:**
- Core `staff` is readable only by the person themselves, so every Manager screen reads names through owner-gated functions. If Users & Access later needs the same, promote them (SESSIONS §5 F8).
- Dialog and toast styles are in `css/sales.css`; Manager keeps its own `ui/parts.js` copies of the helpers. **Promotion candidates:** toast, dialog, reason prompt, print helper.
- A person added in Manager becomes a core `staff` row **without a login**. Giving them a login stays in Users & Access.
- Salary advance (M-B) must be the signed sum of the month's `kind = 'entry'` rows, shown read-only with a breakdown (MGR-16). `mgmt_credit_month` already returns that figure as `entries_total`.
- **Open for M-C:** the sign meaning of each ledger (Expense, Jazz Cash, Petty) must be confirmed with an owner example before building (MGR-17).
- The local DB runner needs PostgreSQL; I installed it in my sandbox only. Nothing in the repo changed for it.

## Applied to the live project (DuaPharmaPlus, 13 Nov 2026, by hand, repo versions, RUNBOOK §4)

| Version | File | sha256 (first 12) | Recorded in `schema_migrations` |
|---|---|---|---|
| 0101 | `0101_mgmt_staff.sql` | `60c622cd4ab2` | yes (`0101 mgmt_staff`) |
| 0102 | `0102_mgmt_credit.sql` | `ae93c1e2c763` | yes (`0102 mgmt_credit`) |
| 0103 | `0103_mgmt_hardening.sql` | `783074e3bbc7` | yes (`0103 mgmt_hardening`) |

**Checked live after applying:** RLS on all 6 `mgmt_` tables, 5 read policies and 0 write policies, no `anon` table grants, `authenticated` holds SELECT only, `anon` can execute 0 Manager functions, `authenticated` exactly the 10 whitelisted, no Manager key in any role preset, 0 rows in the new tables. A read-only run as the owner (simulated MFA) lists the 2 staff and returns the credit month; the senior (even with MFA) and `anon` are refused; with no identity the function answers `42501 not allowed`.

**Found while applying (and fixed):** (1) two trigger functions kept Postgres's default public execute on the live project: revoked in `0102`, with a guard test that fails for any Manager function outside a whitelist. (2) Security advisor: those two trigger functions had no fixed `search_path`: fixed in `0103`, with a guard test.

**Security advisor, left as is:** `mgmt_save_keys` "RLS enabled, no policy" and the 10 Manager RPCs "callable by signed-in users" are by design (service-only table; each RPC checks its permission inside), exactly like `sales_save_keys` and `sales_save_day`.

**Not Manager's, reported to the owner:** `closing_lock_children()` and `rls_auto_enable()` are executable by `anon` as SECURITY DEFINER; Auth "leaked password protection" is off.

## PHONE #1: what to try (the migrations are live; the screens appear after the owner merges `module/manager` into `main`: Pages publishes in about a minute)
1. Open **Manager → Staff Registry**. Add a person (name, designation). Check the code appears (EMP-001 style).
2. Open the card, add private details (father's name, blood group) and save. Reopen: they are there.
3. Notes tab: add a note, remove it (reason optional). It disappears from the list.
4. **Manager → Staff Credit**, this month: open that person, **Set opening balance** (this month, an amount, a reason).
5. Add an advance (e.g. `2,000`), then a repayment (`-500`). Check the net: opening + 2,000 − 500.
6. Go to the previous month with ‹, then back. Confirm the balance carries correctly into the new month.
7. Set a **Salary deduction** and a **Less generic**. Net should drop by both.
8. **Reverse** the 2,000 advance with a reason. Both lines stay (one struck through); the net returns to what it was.
9. Sharing check: in Users & Access, Allow **only** `credit.view` for a test person. They should see Staff Credit read-only (no add, no reverse), and nothing else in Manager.
