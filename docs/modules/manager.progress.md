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

**Totals:** `npm run verify` green (29 files, 294 tests; was 242). `bash supabase/tests/run.sh`: 378 checks, 0 failures (was 195).

**Decisions made while building (all in the brief §8):** MGR-18 permission design (editing implies reading; 14 keys), MGR-19 (deductions are ledger rows; a reversal is dated like the original; an entry cannot predate the opening month), MGR-20 (Manager's "active" is the payroll list, not the login), MGR-21 (names are read through Manager's own functions; core policies untouched).

**Things the next session / owner should know:**
- Core `staff` is readable only by the person themselves, so every Manager screen reads names through owner-gated functions. If Users & Access later needs the same, promote them (SESSIONS §5 F8).
- Dialog and toast styles are in `css/sales.css`; Manager keeps its own `ui/parts.js` copies of the helpers. **Promotion candidates:** toast, dialog, reason prompt, print helper.
- A person added in Manager becomes a core `staff` row **without a login**. Giving them a login stays in Users & Access.
- Salary advance (M-B) must be the signed sum of the month's `kind = 'entry'` rows, shown read-only with a breakdown (MGR-16). `mgmt_credit_month` already returns that figure as `entries_total`.
- **Open for M-C:** the sign meaning of each ledger (Expense, Jazz Cash, Petty) must be confirmed with an owner example before building (MGR-17).
- The local DB runner needs PostgreSQL; I installed it in my sandbox only. Nothing in the repo changed for it.

## Ready to apply to the live project (owner says when; RUNBOOK §4, by hand, repo version, in this order)
1. `supabase/migrations/0101_mgmt_staff.sql`
2. `supabase/migrations/0102_mgmt_credit.sql`

Both are additive (new tables, functions and 11 permission rows). They change no existing table and no existing policy. Nothing is seeded with data.

## PHONE #1: what to try (owner, after the two migrations are applied and the branch is merged or previewed)
1. Open **Manager → Staff Registry**. Add a person (name, designation). Check the code appears (EMP-001 style).
2. Open the card, add private details (father's name, blood group) and save. Reopen: they are there.
3. Notes tab: add a note, remove it (reason optional). It disappears from the list.
4. **Manager → Staff Credit**, this month: open that person, **Set opening balance** (this month, an amount, a reason).
5. Add an advance (e.g. `2,000`), then a repayment (`-500`). Check the net: opening + 2,000 − 500.
6. Go to the previous month with ‹, then back. Confirm the balance carries correctly into the new month.
7. Set a **Salary deduction** and a **Less generic**. Net should drop by both.
8. **Reverse** the 2,000 advance with a reason. Both lines stay (one struck through); the net returns to what it was.
9. Sharing check: in Users & Access, Allow **only** `credit.view` for a test person. They should see Staff Credit read-only (no add, no reverse), and nothing else in Manager.
