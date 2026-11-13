> **Status note (13 Nov 2026):** Manager is implemented on `main` for Staff Registry and Staff Credit. Migrations 0101–0103 are reported applied and verified live. Payslips, petty cash and other remaining brief scope are not complete; see `docs/modules/manager.progress.md` and `docs/PROJECT_STATUS.md`.\n\n# Manager — brief

Status: **Building** (Session M-A done; 0101–0103 applied to the live project 13 Nov 2026; awaiting merge and PHONE #1) · Owner approval: **yes, 12 Nov 2026** ("GO, all defaults")
Branch: `module/manager` · Migration range: `0100–0199` · Prefix: `mgmt_` · Permissions: `mgmt.*`, `credit.*` · Route prefix: `/manager` · Nav order: 20

> **Work order:** `docs/modules/manager.next-session.md`. Coordination: `docs/SESSIONS.md`. Progress: `docs/modules/manager.progress.md`.
> Read `docs/MODULES.md` first. This brief only adds what is specific to Manager.

## 1. Scope

**Manager is for the owner only. Staff never see it.** The owner's private workspace for people and money:

- Staff Registry (the staff card: details, private details, notes, credit, payslip)
- Staff Credit ledger (monthly view over an append-only ledger)
- Salary sheet, Generic working sheet, Incentive calculator, Payslip
- Petty cash, Expense / Jazz Cash / Misc Section ledgers, Jazz Cash Balance Tally
- **Credit Inbox:** credit recorded by staff in Closing, filed by hand into the right ledger (MODULES.md §8.2)
- Print views of the above

**Not in this module (yet):** Attendance (later, with the Android app, MGR-3). **Never:** shift closing (Closing), sales (Sales), stock (Inventory).

## 2. Old-app source (read 12 Nov 2026)

BT-Sale-Data2 `js/manager/` (all files except attendance) and `js/ledger/` (all). Old Supabase migration `20261015175500_serialize_staff_credit_inbox_fold.sql` for history.

## 3. Rules (read from the old code; tags KEEP / IMPROVE / DROP; owner answers recorded in §8)

Figures are rules, not data. "Whole rupee" = rounded with JavaScript `Math.round` (halves toward +∞, also for negatives); SQL must match exactly.

| # | Rule (old behaviour, plain words) | Tag |
|---|---|---|
| R1 | Everything is organised **by month**; each sheet shows one month; the month list is continuous (blank months do not disappear) up to the current month | KEEP |
| R2 | Each monthly sheet lists every **active** staff member in **Sr# order**; a missing row is added blank. Sr# is the registry's display order and is unique | KEEP (Sr# becomes `sort_order`) |
| R3 | **Credit net** = previous balance + all dated entries − salary deduction − "less generic" deduction. Entries are signed (advance +, repayment −). All figures whole rupees | KEEP |
| R3a | The credit sheet's **Salary** and **Less Generic** deductions are two typed numbers per person per month, not linked to the Salary sheet | KEEP, flag a mismatch with the salary advance on screen (MGR-16) |
| R4 | "Copy to next month" copies each net into next month's previous balance | IMPROVE: balance = opening + sum of ledger rows (derived). No copy step |
| R5 | **Salary net** = HO salary − advance + generic + Σ custom columns (each + or −). `days` (default 31) affects **no** calculation | KEEP (days informational, MGR-8) |
| R6 | Salary **advance** = the **signed sum of ALL that month's credit entries** (not only positive ones: the brief was wrong). It auto-fills until the first save; an Auto-fill button overwrites it | KEEP (MGR-16) |
| R7 | Salary **generic** = the Generic sheet's Final, refreshed live | KEEP |
| R8 | **Generic sheet:** incentive = round(whole-rupee generic sale × **4%**); Final = incentive + extra. The 4% is also written into the payslip label, print header, dashboard and export | KEEP as a setting (MGR-5) |
| R9 | **Incentive calculator** (one set of figures per month for the whole branch): sale commission = round(sale value × **0.5%**); generic incentive = round(generic sale × **4.5%**); commission = sale commission − pilferage − till short; bonus = cash target (typed); generic part = generic incentive − excess fine; grand = commission + bonus + generic part; less plus-fine and paper-fine; then less panel fine = net incentive; **owner's share** = round(net ÷ 2) − tax (tax is a typed amount). A field `unapproved` is stored but never used | KEEP, rates as settings (MGR-5) |
| R10 | **Payslip:** one slip per person and month from their Salary, Credit and Generic rows; printable. A WhatsApp pre-filled message existed | KEEP print; DROP WhatsApp (MGR-6) |
| R11 | **Petty Detail:** monthly, several groups (each with a period text and rows of description + amount), printable per group; has totals only, **no balance**. "Copy to next month" clones all groups | KEEP |
| R12 | Staff notes: timestamped log per person, owner only; notes could be deleted | KEEP; soft delete, logged |
| R13 | Old **Unmatched** tab and the database trigger `bt_fold_staff_credit_inbox` (on every insert into the old credit inbox it locked the one JSON row and appended an entry to that person's credit month, creating the row if missing; no owner step) | **DROP** (MGR-2). Recorded here as history so nobody re-adds it |
| R14 | Entries, rows, notes and sections could be edited or deleted freely (with sync "tombstones") | IMPROVE: append-only ledgers, reversals with a reason, notes soft-deleted (D-12, MGR-12) |
| R15 | **Ledger engine** (`js/ledger`): a ledger = opening balance + entries; each entry has a positive amount, and the **category** carries the sign; balance = opening + Σ(sign × amount). Built-in ledgers: Jazz Cash (categories Received +, Patty Incentive −, Generic Incentive −, Strips/Adjustments −, Transfer −; has a shift field Morning/Evening/Night/Both/Off), Expense (Bill, Fuel/HO, Soap/Tissue, Refreshment, Extra, Guard Incentive all +; Patty H/O received −), and a Petty ledger (one category "Expense" −). Owner-defined **Misc Sections** are extra ledgers with owner-defined categories and signs. Date-range filter and group-by-category views. A past "sign flip" migration shows sign meaning has been confused before | KEEP the engine; sign meaning to be confirmed with an owner example (MGR-17) |
| R16 | Each ledger has **one undated opening balance**, editable at will | IMPROVE: dated, append-only, logged (MGR-9) |
| R17 | **Jazz Cash Balance Tally:** a daily count of accounts (defaults: Jazz Cash Balance (ledger, locked) = −(ledger balance), My Jazz Cash App, ABL, Bank Alflah, Easypaisa, Pharmacy Cash, Cash in Hand; owner can add/rename/remove accounts) against the total the "expense app" shows; difference = total − app total, labelled Balanced / Extra Cash / Short. One snapshot per date, overwritten on save | KEEP; snapshots keep revisions (MGR-17) |
| R18 | Old **Quick Add / Add to Ledger** from a Closing line: pick ledger (Staff Credit, Jazz Cash, Petty, Expense, any Misc Section) and category yourself; amount, date and description editable; a "mark" was written back into Closing | KEEP the manual choice; filing state is Manager's own (`mgmt_credit_filings`), amount/date locked (MGR-10) |
| R19 | "Dismiss (no ledger entry)" on an unmatched line | KEEP with a reason, logged (MGR-10) |
| R20 | Staff who left: Credit keeps any row with a non-zero previous balance, entry, salary or less-generic; Salary and Generic drop inactive staff entirely | IMPROVE (MGR-13) |
| R21 | Per-person "hide from print" toggle on Credit and Salary rows | KEEP (print slice) |
| R22 | Reconciling sheets to the registry matched rows by id **or name** and, on duplicates, **added their numbers together** | DROP: rows are keyed by `staff_id` only |
| R23 | Old staff form fields: Sr#, staff ID (EMP-###), name, designation, father's name, **CNIC**, blood group, phone, joining date, address, active. A "set staff login with 4-digit PIN" button | CNIC: **not stored** (MGR-7). Login: DROP (Users & Access owns it) |
| R24 | Reports: Credit (detailed, summary), Salary detail, Generic, Incentive detail, Payslip, Petty group, Manager Dashboard print, Manager Summary export (one page of sales + manager + alerts, with a 0.95 "on pace" test) | Rebuild the first six; skip Dashboard and Summary export (MGR-14) |
| R25 | Three different "balances": credit sheet (prev + entries − deductions), Manager Summary (prev + entries only), dashboard | One definition only: R3 |
| R26 | Print headers hard-code the business name and branch | IMPROVE: from a setting |

## 4. Structure (approved with the defaults)

All tables: RLS on, `anon` nothing, **no direct writes** (RPC only), read policies in the wrapped form `((select public.has_perm(..)))`. Money `numeric(14,2)`. Ledger and sheet rows are append-only or revisioned.

| Table | Purpose | Slice |
|---|---|---|
| `mgmt_save_keys` | Idempotency keys for every Manager RPC (service only) | M-A |
| `mgmt_staff_details` | Per core `staff` row: `staff_code`, `designation`, `sort_order` (non-private) | M-A |
| `mgmt_staff_private` | Father's name, address, blood group (own table, own permission). **No CNIC** | M-A |
| `mgmt_staff_notes` | Notes: body immutable, soft delete | M-A |
| `mgmt_credit_openings` | Append-only opening balance per person with effective month and reason; latest row wins | M-A |
| `mgmt_credit_entries` | Append-only signed rows. `kind` = `entry` / `salary_deduction` / `generic_deduction`; `source` = `manual` / `closing_inbox`; `reverses_id` (unique) | M-A |
| `mgmt_salary_rows`, `mgmt_salary_columns`, `mgmt_generic_rows`, `mgmt_month_closes` | Sheets, custom columns, Close month, revisions | M-B |
| `mgmt_incentive_months` (+ rates used) | Incentive inputs and the rates each month used | M-C |
| `mgmt_petty_groups`, `mgmt_petty_rows` | Petty Detail | M-C |
| `mgmt_ledgers`, `mgmt_ledger_categories`, `mgmt_ledger_openings`, `mgmt_ledger_entries`, `mgmt_jazz_tally` | One ledger engine for Expense, Jazz Cash, Misc Sections + the tally | M-C |
| `mgmt_credit_filings` | Credit Inbox record; the Closing line id is a plain uuid, **no foreign key** | M-D |

**Why RPC reads for names:** core `staff` is readable only by the person themselves (policy `staff_self_read`, `0001_core.sql`). Manager does **not** change core. Its screens read names through owner-gated RPCs (`mgmt_staff_list`, `mgmt_staff_get`, `mgmt_credit_month`).

**Credit maths (SQL = JS, one shared fixture):** for month M: `prev` = opening amount (if M is on/after the opening's month, else 0) + Σ all rows dated before M; month entries = Σ rows of kind `entry` in M; `salary_deduction` = −Σ salary_deduction rows in M; `generic_deduction` likewise; **net = prev + entries − salary_deduction − generic_deduction**. A reversal is a new row (same person, kind and **date as the original**, opposite sign, mandatory reason), so the month reads as if the mistake never happened while both lines stay visible.

## 5. Permissions (designed so the owner can share one thing at a time)

Rule: **a key that edits also reads what it edits.** No role preset (junior / senior) gets any key. Only the owner (admin with MFA) holds them until he grants a key **to one person** by hand in Users & Access (Allow). Every Manager function checks its key in the database; the menu is cosmetic.

| Key | Allows | Typical share |
|---|---|---|
| `mgmt.staff_view` | See the registry list and non-private details (code, designation, phone, joined) | a senior who needs the roster |
| `mgmt.staff_private` | See father's name, address, blood group (and, with `staff_edit`, edit them) | owner only |
| `mgmt.staff_edit` | Add and edit staff details; set active/inactive | |
| `mgmt.notes` | Read, add and remove private staff notes | owner only |
| `credit.view` *(existing)* | See credit balances and entries | |
| `mgmt.credit_manage` | Add credit entries, reversals, deductions | |
| `mgmt.openings` | Set opening balances (credit, later ledgers) | owner only |
| `mgmt.salary_view` | See Salary, Generic and Payslip (read only) | |
| `mgmt.salary` *(existing)* | See **and edit** Salary, Generic, Payslip | |
| `mgmt.incentive` | See and edit the Incentive calculator (includes the owner's share) | owner only |
| `mgmt.petty_cash` *(existing)* | See and edit Petty Detail | a manager who keeps petty cash |
| `mgmt.ledgers` | See and edit the Expense, Jazz Cash and Misc ledgers | |
| `mgmt.inbox_file` | See the Credit Inbox and file lines. Filing **also** needs the target's own key (`mgmt.credit_manage` for staff credit, `mgmt.ledgers` for a ledger) | |
| `mgmt.close_month` | Close a monthly sheet | owner only |

## 6. Screens (phone first)

Routes under `/manager`; each page lists who may open it (`anyOf`).

1. `/manager/staff` — Staff Registry (this slice). List with code pill, name, designation, active chip; "Show inactive"; **+ Add person** (needs `mgmt.staff_edit`). Tap → card dialog with tabs **Details · Credit · Payslip · Notes**.
2. `/manager/credit` — Staff Credit (this slice). Month picker; one block per person (previous, entries, salary deduction, less generic, net); add entry; reverse (reason); opening balance (needs `mgmt.openings`).
3. `/manager/inbox`, `/manager/salary`, `/manager/generic`, `/manager/incentive`, `/manager/petty`, `/manager/expenses`, `/manager/misc`, `/manager/jazzcash` — later slices.

## 7. Interfaces

- **Consumes:** `closing_credit_feed(p_after)` (Closing work order §7) for the inbox only, built against a stub inside Manager's own tests until Closing ships it.
- **Provides:** nothing yet.
- **Foundation requests:** (1) none blocking. (2) Promotion candidates when a second module needs them (SESSIONS §5 F8): print helper, toast/dialog parts, IndexedDB. Manager keeps local copies in `ui/parts.js` meanwhile.

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| MGR-1 | Manager is owner-only; no preset role gets `mgmt.*` / `credit.*` | Accepted (9 Nov) |
| MGR-2 | Credit Inbox: manual filing, no auto-matching | Accepted (9 Nov) |
| MGR-3 | Attendance later with the Android app | Accepted (9 Nov) |
| MGR-4 | No data import; opening balances entered by the owner | Accepted (9 Nov) |
| MGR-5 | Rates: reproduce the old numbers (generic sheet **4%**, incentive calculator generic **4.5%**, sale commission **0.5%**, owner's share **÷ 2**) as admin-editable **settings** with a logged reason; each saved month stores the rate it used, so a change never alters past months. Built in M-B / M-C | Accepted (12 Nov, default) |
| MGR-6 | No WhatsApp link; print and hand over | Accepted (12 Nov, default) |
| MGR-7 | Store designation, staff code, father's name, address, blood group, Sr#. **CNIC is never stored.** Private fields in their own table and permission; never in seeds, tests or logs | Accepted (12 Nov, default) |
| MGR-8 | `days` informational only (no proration); HO salary and custom-column definitions carry to next month (amounts 0); whole-rupee net | Accepted (12 Nov, default) |
| MGR-9 | Start month chosen by the owner by setting each opening (dated, logged, append-only). Openings for credit per person; for each ledger later. Tally needs none | Accepted (12 Nov, default) |
| MGR-10 | Inbox targets: Staff Credit, Jazz Cash, Petty, Expense, any Misc Section, or Dismiss (with reason, logged). Amount and date locked; description editable; "changed after filing" shown, owner decides | Accepted (12 Nov, default) |
| MGR-11 | PDF = print layout, browser Save as PDF, no library | Accepted (12 Nov, default) |
| MGR-12 | Credit and ledger rows append-only forever; Salary, Generic, Incentive, Petty editable until **Close month**, then revisions with a reason | Accepted (12 Nov, default) |
| MGR-13 | Staff who left show on Credit while the balance is non-zero or they have rows that month; on Salary only while that month's row is open | Accepted (12 Nov, default) |
| MGR-14 | Reports rebuilt: Credit (detailed, summary), Salary, Generic, Incentive, Payslip, Petty group, ledger filters. Skipped: Dashboard print, Summary export | Accepted (12 Nov, default) |
| MGR-15 | Staff never see their own payslip or credit in the app | Accepted (12 Nov, default) |
| MGR-16 | Salary advance = signed sum of that month's `entry` rows (read-only, with breakdown); credit deductions stay typed per month; mismatch flagged | Accepted (12 Nov, default) |
| MGR-17 | One ledger engine for Expense, Jazz Cash, Misc Sections; old Petty ledger skipped unless used; Tally kept as daily snapshots with revisions. **Sign meaning of each ledger to be confirmed with an owner example before M-C** | Accepted (12 Nov, default); sign question stays open |
| MGR-18 | Permission design of §5 (11 new keys + 3 existing), built for sharing one capability at a time | Accepted (12 Nov, "set permissions so I can share") |
| MGR-19 | Credit deductions are ledger rows (`kind`), set by a delta row; a reversal is dated like the original; entries cannot predate the person's opening month; amounts keep up to 2 decimals and sums are exact | Accepted (12 Nov, design) |
| MGR-20 | Manager's `active` flag means "on the payroll list"; it does **not** disable a login (Users & Access does) | Accepted (12 Nov, design) |
| MGR-21 | Manager reads staff names through its own RPCs; no change to core policies | Accepted (12 Nov, design) |

## 9. Slices

1. **M-A** (done): A0 brief · A1 `0101_mgmt_staff` · A2 `0102_mgmt_credit` · `0103_mgmt_hardening` (advisor fix, not planned) · A3 skeleton + `domain/credit.js` + shared fixture · A4 screens `/manager/staff`, `/manager/credit` · **PHONE #1**.
2. **M-B:** `0104` Salary + Generic + custom columns + Close month, rates as settings, parity fixtures, Payslip print · PHONE #2.
3. **M-C:** `0105` Incentive; `0106` Petty + ledger engine + Tally (after the sign examples) · PHONE #3.
4. **M-D:** `0107` Credit Inbox (+ stub of `closing_credit_feed`), nav badge, reports, acceptance · PHONE #4.

## 10. Handoff

_(filled at the end of each session; see `docs/modules/manager.progress.md`)_
