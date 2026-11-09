# Manager — brief

Status: **Briefed** (awaiting owner approval) · Owner approval: no
Branch: `module/manager` · Migration range: `0100–0199` · Prefix: `mgmt_` · Permissions: `mgmt.*`, `credit.*` · Route prefix: `/manager` · Nav order: 20

> Read `docs/MODULES.md` first. This brief only adds what is specific to Manager.

## 1. Scope

**Manager is for the owner only. Staff never see it.** It is the owner's private workspace for people and money:

- Staff Registry (the staff card: details, notes, credit ledger, payslip)
- Staff Credit ledger (monthly)
- Salary sheet, Generic working sheet, Incentive calculator, Payslip
- Petty cash / expenses, misc sections, Jazz Cash ledger
- **Credit Inbox:** where the owner sees credit recorded by staff in Closing and files each line by hand into the correct ledger (MODULES.md §8.2)
- Print / copy reports for the above

**Not in this module (yet):** Attendance. It is built later, together with the Android app, inside Manager (MODULES.md §8.3).
**Not in this module ever:** shift closing (Closing), sales (Sales), stock (Inventory).

## 2. Old-app source

- BT-Sale-Data2: `js/manager/` (staff, salary, generic, credit, petty, incentive, payslip, reports, notes, unmatched), `js/ledger/` (expense ledger, misc sections, Jazz Cash), `js/manager/README.md`.
- Old tabs: Staff Registry · Attendance · A. Staff Credits · B. Petty/Expenses · C. Misc Sections · Jazz Cash · a. Salary · b. Generic · c. Petty Detail · d. Incentives. Staff card has tabs: Details · Credit Ledger · Payslip · Notes.
- Old Supabase migrations for context only: `*staff_credit*`, `*attendance*`.

## 3. Rules (seen in the old code — the session must re-read and confirm each one)

Tags: KEEP / IMPROVE / DROP / ASK. Figures below are rules, not data.

| # | Rule (plain words) | Tag |
|---|---|---|
| R1 | Everything is organised **by month**. Each sheet shows one month at a time | KEEP |
| R2 | Each monthly sheet shows a row for every **active** staff member from the registry; missing rows are added blank; staff who left are not shown unless they still carry money | KEEP |
| R3 | **Staff credit, per person per month:** Net = previous balance + all dated entries − salary deduction − "less generic" deduction. Entries are signed (advance positive, repayment negative) | KEEP |
| R4 | "Copy to next month" rolls each person's Net into next month's opening balance | IMPROVE: in the new design the running balance is derived from an append-only ledger plus opening balances, so no copy step is needed. Keep the monthly view |
| R5 | **Salary, per person per month:** Net = HO salary − advance + generic, then every custom column is added or subtracted by its own sign | KEEP |
| R6 | Salary **advance** is pulled automatically from the positive entries of that month's credit ledger | KEEP (confirm) |
| R7 | Salary **generic** is pulled automatically from the Generic sheet's Final column | KEEP |
| R8 | **Generic sheet:** Incentive = a percentage of that person's Generic Sale; Final = Incentive + Extra. The old sheet says 4%, the Incentive calculator uses 4.5% | **ASK** (two different rates in the old code) |
| R9 | **Incentive calculator (month):** sale commission 0.5% of sale value; generic incentive 4.5% of generic sale; commission = sale commission − pilferage − till short; bonus = cash target; generic part = generic incentive − excess fine; grand = commission + bonus + generic part; less plus-fine and paper-fine; then less panel fine = net incentive; owner's share = half of net, less tax | **ASK** (confirm every rate and the split; the old code hard-codes them) |
| R10 | **Payslip:** one combined slip for a person and month, built from their Salary, Credit and Generic rows; can be printed; the old app also opened a pre-filled WhatsApp message for the owner to send manually | KEEP print; ASK whether to keep the WhatsApp text link |
| R11 | **Petty cash:** monthly, grouped (several named groups, each with rows), with a printable report | KEEP |
| R12 | Staff notes: timestamped personal log per staff member, owner only, never shown to staff | KEEP |
| R13 | Old "Unmatched" tab and automatic folding of staff credit into the ledger | DROP in favour of the Credit Inbox (§5, MODULES.md §8.2) |
| R14 | Posted entries are never edited; a mistake is fixed with a reversal entry and a reason | IMPROVE (D-12) |
| R15 | Jazz Cash and Misc Sections: **not yet read.** The session must read `js/ledger/` and write the rules here before building them | ASK |

## 4. Structure (proposed; the session finalises it and gets approval before writing the migration)

All tables RLS-on, owner-only, written only through RPC.

| Table | Purpose |
|---|---|
| `mgmt_staff_details` | Extra registry fields for a core `staff` row (designation, staff code, joining details…). The session lists the exact fields from the old staff form. **No identity numbers or personal data in seed files or tests (public repo)** |
| `mgmt_staff_notes` | Timestamped notes per staff |
| `mgmt_credit_entries` | Append-only signed entries per staff: date, description, amount, `source` (`manual` or `closing_inbox`), reversal link |
| `mgmt_credit_openings` | Opening balance per staff (the starting point, because there is no data import) |
| `mgmt_salary_rows` | Per staff per month: days, HO salary, advance, generic, custom extras |
| `mgmt_generic_rows` | Per staff per month: generic sale, extra |
| `mgmt_incentive_months` | One row per month with the calculator inputs |
| `mgmt_petty_groups`, `mgmt_petty_rows` | Petty cash |
| `mgmt_expense_entries`, `mgmt_misc_sections`, `mgmt_jazz_entries` | Shape decided after reading `js/ledger/` |
| `mgmt_credit_filings` | The Credit Inbox record: `closing_line_id` (plain uuid, **no foreign key**), where it was filed, by whom, when, reversed or not |

Functions (RPC): save/reverse entry, file inbox line (`mgmt_credit_file`, idempotent), month saves for salary/generic/incentive/petty, opening balance set (admin, logged). The month calculations exist **twice** (JS `domain/` for live preview, SQL for the saved result) with a parity test (MODULES.md §9 step 4).

## 5. Permissions

Existing, reserved here: `mgmt.salary`, `mgmt.petty_cash`, `credit.view`. New keys the session adds in its migration (suggested): `mgmt.staff_view`, `mgmt.staff_edit`, `mgmt.notes`, `mgmt.credit_manage`, `mgmt.incentive`, `mgmt.ledgers`, `mgmt.inbox_file`.
**No role preset (junior/senior) gets any of them.** Only the admin (owner, with MFA) has them unless the owner grants a key to one person by hand.

## 6. Screens (layout, phone first)

Old order is the guide. Routes under `/manager`:

1. `/manager/staff` — Staff Registry list; tap a person → staff card with tabs Details · Credit · Payslip · Notes.
2. `/manager/credit` — month picker; one block per person (previous balance, entries, deductions, net); add entry; reversal.
3. `/manager/inbox` — **Credit Inbox:** list of unfiled Closing credit lines (date, shift, label, amount). Tap a line → choose the target ledger (staff credit with a staff picker, expense, other) → confirm. Filed lines move to a "Filed" tab; a line whose Closing record was later corrected shows a "changed after filing" mark.
4. `/manager/salary`, `/manager/generic`, `/manager/incentive` — monthly sheets with live totals, Print.
5. `/manager/petty`, `/manager/expenses`, `/manager/misc`, `/manager/jazzcash` — ledgers.
6. Reports: print/copy views for each sheet (reuse the Sales print and copy helpers through a Foundation request, MODULES.md §6.5).

Show a small badge on the Manager nav item when the Credit Inbox has unfiled lines.

## 7. Interfaces

- **Consumes:** `closing_credit_feed(p_after)` from Closing (§8.1). Until Closing ships it, the inbox shows "nothing yet"; build and test the inbox against a **test stub** in your own tests.
- **Provides:** nothing yet.
- **Foundation requests:** (none yet — the session adds here).

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| MGR-1 | Manager is owner-only; no preset role gets `mgmt.*` / `credit.*` | Accepted (owner, 9 Nov 2026) |
| MGR-2 | Credit Inbox: manual filing of Closing credit lines, no auto-matching | Accepted (owner, 9 Nov 2026) |
| MGR-3 | Attendance comes later with the Android app, inside Manager | Accepted (owner, 9 Nov 2026) |
| MGR-4 | No data import; opening balances are entered by the owner | Accepted (owner, 9 Nov 2026) |
| MGR-5 | Incentive and generic rates (R8, R9) | **Open: ask the owner** |
| MGR-6 | Keep the WhatsApp payslip text link? | **Open: ask the owner** |

## 9. Slices (each finished and tried on a phone before the next)

1. **M1** Staff Registry + staff card (details, notes). Migration, permissions, DB tests.
2. **M2** Staff Credit ledger with opening balances and reversals; month view.
3. **M3** Salary + Generic + Payslip (print). Parity tests for the month maths.
4. **M4** Incentive calculator (after MGR-5 is answered).
5. **M5** Petty cash, expenses, misc sections, Jazz Cash (after reading `js/ledger/`).
6. **M6** Credit Inbox (when Closing's feed exists; before that, build against the stub).
7. **M7** Reports/print polish.
8. *Later, separate project:* Attendance with the Android app.

## 10. Handoff

_(empty — the session fills this in at the end)_
