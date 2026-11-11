# Manager — plan for the next session

Written 11 Nov 2026, after re-reading `main` (`e635e23`) and the old BT-Sale-Data2 `js/manager/` and `js/ledger/` code.
Read `docs/SESSIONS.md`, `docs/MODULES.md` and `docs/modules/manager.md` first. This file is the **work order**; the brief is the **specification**.
"Manager domain (staff and finance)" means the owner-only module: Staff Registry, staff credit, salary, generic sheet, incentive, payslip, petty cash, expenses, misc sections, Jazz Cash, and the Credit Inbox.

---

## 1. Where things stand

| Item | State |
|---|---|
| Brief | `docs/modules/manager.md`, status **Briefed**, awaiting the owner's approval. Decisions MGR-1 to MGR-4 accepted; MGR-5 and MGR-6 open |
| Branch | `module/manager` does **not** exist yet; create it from `origin/main` |
| Built | **Nothing.** No migration, no manifest, no screens, no tests |
| Reserved in core (`0001_core.sql`) | Permissions `mgmt.salary`, `mgmt.petty_cash`, `credit.view`. No role preset holds them. Core `staff` table exists: `id`, `full_name`, `phone`, `joined_on`, `active`, `notes` |
| Migration range | `0100`–`0199`. Table and function prefix `mgmt_`; permission prefix `mgmt.` and `credit.` |
| Depends on | Closing's `closing_credit_feed(p_after)` **only for the Credit Inbox (M6)**. Everything else can be built today |
| Rules read so far | R1–R14 are in the brief (from a first read). **R15 (Jazz Cash, Misc Sections, expense ledger) has not been read by anyone** |

### What the old app really is (read before designing)

- The old Manager keeps its whole state as **one JSON document** (`bt_salesdata`, row `main`, `payload.manager.credit["<Month Year>"]` and similar) plus browser keys (`BT_ManagerWork_v1`, `mw_incentive_<month>`, `mw_custom_sections_v1`). Months are text keys such as "November 2026". Dua needs **relational tables** with a real `month` date and append-only ledgers; do not copy the JSON shape.
- A database trigger (`bt_fold_staff_credit_inbox`) folds credit entries from an inbox straight into the staff-credit month array. That automatic folding is **dropped** (MGR-2): filing is manual in the new Credit Inbox.
- Old files and sizes (lines): `manager-attendance.js` 787 (later), `manager-credit.js` 551, `manager-staff.js` 432, `manager-salary.js` 359, `manager-export.js` 322, `manager-reports.js` 277, `manager-petty.js` 253, `manager-shared.js` 249, `manager-payslip.js` 245, `manager-page.js` 218, `manager-generic.js` 151, `manager-unmatched.js` 150, `manager-incentive.js` 145, `custom-sections.js` 122, `staff-notes.js` 115; `js/ledger/`: `ledger-page.js` 549, `jazz-cash.js` 482, `ledger-store.js` 393, `quick-add.js` 299, `ledger-quick-add.js` 273.

---

## 2. Before writing any feature code (housekeeping)

1. `git fetch && git switch -c module/manager origin/main`, then `npm ci && npm run verify` and `bash supabase/tests/run.sh`. Both must pass; if not, tell the owner and stop.
2. Session start protocol of MODULES.md §0.1 (10-line summary, wait for "go").
3. Check which Supabase project your tools are connected to: it must be `DuaPharmaPlus`. Do not apply migrations to the live project unless the owner says so; when he does, RUNBOOK §4 (by hand, register under the repo number, never a tool-made timestamp).
4. Ask whether the GitHub token pasted in earlier chats was revoked. Never store one in a file. This environment cannot push without a token; list every changed file at the end (MODULES.md §0.2).
5. Clone the old repo (public) and read **in this order**: `js/manager/README.md`, `manager-shared.js`, `manager-staff.js`, `staff-notes.js`, `manager-credit.js`, `manager-salary.js`, `manager-generic.js`, `manager-incentive.js`, `manager-payslip.js`, `manager-petty.js`, `custom-sections.js`, `manager-unmatched.js`, `manager-reports.js`, `manager-export.js`, then `js/ledger/` (all). Write what you learn into the brief's **Rules** table, tagged KEEP / IMPROVE / DROP / ASK, **before** proposing tables.
6. Study `js/modules/sales/` and `supabase/migrations/0002_sales.sql` (RPC, idempotency key, revisions) and `0006_checklist.sql` (conflict handling).

---

## 3. Questions for the owner (ask first, in one message; do not guess money rules)

Open from the brief:

| ID | Question | Why it matters |
|---|---|---|
| MGR-5 | **Incentive rates.** The old Generic sheet takes **4%** of generic sale (`manager-generic.js`, `_genIncentive`); the old Incentive calculator takes **4.5%** (`manager-incentive.js` line ~72) and **0.5%** of sale value for sale commission (line ~71). Which is right, and are all other figures (pilferage, till short, cash-target bonus, excess fine, plus fine, paper fine, panel fine, owner's half and tax) correct as the old code has them? The session lists every constant it finds and the owner confirms each | Money; the old code hard-codes them |
| MGR-6 | Keep the pre-filled WhatsApp text link on the payslip? | Privacy and habit |

New from this review (suggested defaults in the last column):

| ID | Question | Suggested default |
|---|---|---|
| MGR-7 | **Sensitive staff fields.** The old staff form holds: staff code, name, father's name, **national ID number**, phone, address, **blood group**, designation, joining date, active. Core `staff` already has name, phone, joining date, active, notes. Which extra fields do you want stored? The ID number, address and blood group are personal data, in a public-repo project on the Free plan (no guaranteed backups until F7) | Store designation, staff code, father's name, address, blood group; **ask** before storing the ID number; all owner-only; never in seeds or tests |
| MGR-8 | **Salary sheet.** What does "HO salary" mean exactly, why is the default 31 days, who defines the **custom columns** (names and add/subtract sign) and do they carry to next month (old `custom-sections.js`, "Copy to Next Month")? Rounding of the net? | Custom columns are owner-defined per month, copied forward as **definitions only** |
| MGR-9 | **Opening balances** (no data import, MGR-4): which month do the ledgers start, and which opening values are needed (staff credit balance per person; petty cash balance; others)? | One admin-only, logged "set opening" per person per ledger, effective on the first day of the start month |
| MGR-10 | **Credit Inbox targets.** When filing a Closing credit line the owner picks a ledger: staff credit (with a person), expense, other. Is that the full list? If the Closing record is corrected after filing, show "changed after filing" and let the owner decide, or block until reversed? | Full list as stated; show the mark and let the owner decide (nothing automatic) |
| MGR-11 | **PDF.** Payslips and sheets: browser **Save as PDF** from a print layout (as Sales Reports, no new library), or add a PDF library? Same answer as Closing's CLS-9 | Print layout, no new library |
| MGR-12 | **Month closing.** Sheets are working documents during the month. D-12 says posted rows are immutable. Should the owner press **Close month** per sheet, after which any change is a correction with a reason (new revision, original kept)? | Yes; credit ledger entries are always append-only, salary/generic/incentive/petty sheets become immutable at "Close month" |
| MGR-13 | **Staff who left** are hidden from monthly sheets "unless they still carry money" (R2). What counts as carrying money: a non-zero credit balance, unpaid salary, anything else? | Non-zero credit balance or an unclosed salary row |
| MGR-14 | **Reports.** The old app has many print/export views (`manager-reports.js`, `manager-export.js`). Which ones do you actually use? | Rebuild only what he names |
| MGR-15 | Do any staff ever see **their own** payslip or credit balance in the app? (MGR-1 says no `mgmt.*` for any preset.) | No; owner prints and hands over |

---

## 4. Review (what the old code teaches; fix in this order)

| # | Severity | Finding | What to do |
|---|---|---|---|
| G1 | High | Two incentive rates in the old code (4% vs 4.5%) | MGR-5: do not build Generic or Incentive until answered |
| G2 | High | Whole state in one JSON blob, text month keys, edited in place | Relational tables, `month date` (first of month), append-only credit ledger, revisions for closed sheets |
| G3 | High | Credit entries fold into the ledger **automatically** (trigger) | DROP (MGR-2). Record the trigger's behaviour in the brief as history so nobody re-adds it |
| G4 | Medium | Month maths exists in the browser; the saved result must come from the database | Pure `domain/` functions + SQL functions + **one shared fixture file** (like `tests/fixtures/sales-total-cases.json`) tested from both sides to the paisa |
| G5 | Medium | Running balances were copied month to month ("Copy to next month") | Balance = opening + sum of entries (derived); keep the monthly view only |
| G6 | Medium | Staff identity data mixed into the registry | Core `staff` stays the single identity; `mgmt_staff_details` adds only what the owner approves (MGR-7). Never delete a staff row |
| G7 | Medium | Jazz Cash, Misc Sections and the expense ledger have **not been read** | Read `js/ledger/` fully; write R15 rules before M5 |
| G8 | Low | Old reports have almost no tests | Hand-worked golden fixtures; ask the owner for 3 to 5 real printed sheets (invented figures are fine) as extra cases |
| G9 | Low | Sales `print.js` cannot be imported by Manager | Copy what you need inside `js/modules/manager/ui/`; Gmail and the mail dialog are shared and importable (`js/core/gmail.js`, `js/shared/mailDialog.js`) |
| G10 | Info | Attendance is later (MGR-3) and staff phones will write check-ins | Keep `staff.id` as the only key; give attendance its own permission later, not a Manager one |

---

## 5. Slice plan

Each slice ends with `npm run verify`, `bash supabase/tests/run.sh`, files listed, progress file updated. **PHONE** = the owner tries it on a real phone before the next slice.

### Session M-A: rules, structure, staff and credit

| Step | Scope | Done when |
|---|---|---|
| A0 | Housekeeping (§2), owner answers (§3), old-code reading (§2.5) written into the brief's Rules | brief updated; owner approves the structure |
| A1 | **`0101_mgmt_staff.sql`**: seed the new permissions (`mgmt.staff_view`, `mgmt.staff_edit`, `mgmt.notes`, `mgmt.credit_manage`, `mgmt.incentive`, `mgmt.ledgers`, `mgmt.inbox_file`); `mgmt_staff_details`, `mgmt_staff_notes`; save functions with idempotency keys and `log_activity`; tests (§5.5 of MODULES.md: refused without permission, `anon` reads nothing, direct writes refused, same key twice = one row, **a junior with every normal permission still sees nothing**, owner without MFA has nothing) | tests green; mutation check on the permission rule |
| A2 | **`0102_mgmt_credit.sql`**: `mgmt_credit_openings`, append-only `mgmt_credit_entries` (signed amounts, `source` manual / closing_inbox, reversal link, reason), month read function, "set opening" (admin, logged), reversal function | tests: balance = opening + entries; reversal keeps the original; nothing can be edited or deleted |
| A3 | Module skeleton: `manifest.js` (id `manager`, nav order 20, **page-level permissions**), `css/manager.css` + one `<link>`, `data/api.js` (`fetchAll` pattern), `domain/credit.js` (+ unit tests and shared fixture) | repo-consistency test passes |
| A4 | Screens `/manager/staff` (list, staff card tabs Details · Credit · Payslip placeholder · Notes) and `/manager/credit` (month picker, per-person block, add entry, reversal) | page tests in jsdom (see `tests/unit/sales-entry-page.test.js`) |
| **STOP** | **PHONE #1:** add a person, a note, an opening balance, entries across two months, a reversal | |

### Session M-B: salary, generic, payslip
`0103` tables (`mgmt_salary_rows`, `mgmt_generic_rows`, custom column definitions), SQL month functions, **parity fixtures** · `domain/salary.js`, `domain/generic.js` · screens `/manager/salary`, `/manager/generic` · Close month (MGR-12) · Payslip print (copy the print approach inside the module; MGR-6 and MGR-11 decide the extras) · **PHONE #2**.

### Session M-C: incentive and the finance ledgers
`0104` incentive month table and functions (**only after MGR-5**) with the shared fixture · `0105` petty cash, expenses, misc sections, Jazz Cash (shape decided after reading `js/ledger/`, then owner approval) · screens `/manager/incentive`, `/manager/petty`, `/manager/expenses`, `/manager/misc`, `/manager/jazzcash` · **PHONE #3**.

### Session M-D: Credit Inbox, reports, acceptance
`0106` `mgmt_credit_filings` (the Closing line id stored as a **plain uuid, no foreign key**) and `mgmt_credit_file` (idempotent; creates the ledger entry and the filing row in one transaction; a mistake is a reversal) · `/manager/inbox` with Unfiled / Filed tabs and the "changed after filing" mark · nav badge (unfiled count) · build and test against a **stub of `closing_credit_feed` defined inside your own test file**, with the same columns as Closing's design (below); wire the real feed when Closing ships it · reports (MGR-14) · definition of done (MODULES.md §11) · owner marks Accepted · **PHONE #4**.

---

## 6. Facts the next session must not have to rediscover

### 6.1 Core things you may use (do not recreate)
`staff` table (above), `profiles` (login to staff link), `settings` and `settings_set`, `user_prefs` via `js/core/prefs.js`, `activity_log` via `public.log_activity(action, entity, entity_id, before, after, reason)`, `has_perm('key')` (the **admin gets every permission only when MFA is satisfied**, so owner tests must run as `aal2`), `my_context()`, the shell's page-level permission routing, `js/shared/format.js` (`₨ 12,345`), `js/shared/html.js` (escaped templates), `js/core/gmail.js` and `js/shared/mailDialog.js` for Send via Gmail.

### 6.2 Closing's credit feed (what Manager will receive; copy these columns into your stub)
`closing_credit_feed(p_after timestamptz default null)`: read-only, needs `credit.view`. Columns: `line_id`, `business_date`, `slot_kind`, `slot_seq`, `kind` (named / tier / free / adjustment), `label`, `amount`, `closing_id`, `revision`, `submitted_at`, `changed_after_first`, `removed`, `account_id`. Lines only, never balances. A correction re-emits the lines it touched (its `submitted_at` is newer). Filing state is **yours**, not Closing's. This shape is Closing's proposal (its work order §7) and needs the owner's nod there; if it changes, only your stub changes.

### 6.3 Rules from the brief to keep in mind
Everything is by month · each monthly sheet lists every active staff member, blank rows added automatically · staff credit net = previous balance + signed entries − salary deduction − "less generic" deduction · salary net = HO salary − advance + generic ± custom columns · advance comes from the positive entries of that month's credit ledger (confirm) · generic comes from the Generic sheet's Final column · posted entries are never edited; a reversal with a reason fixes mistakes · staff notes are owner-only and never shown to staff.

### 6.4 Phone and design rules
Text ≥ 0.8 rem, targets ≥ 44 px, status never colour-only, `₨ 12,345`, no `innerHTML`, tokens only (navy `#101B2D`, teal `#18A999`, amber `#F2B84B`), safe-area padding, fresh container per page. Money in JS is integer paisa; in the database `numeric(14,2)`. **Public repo: no real staff names, phone numbers, ID numbers, salaries or balances in code, seeds, tests, fixtures or docs** (use "Test Person A", invented amounts).

### 6.5 Read-policy tip (measured)
Write read policies as `using ((select public.has_perm('mgmt.salary')))`; the bare form runs once per row (see `docs/SESSIONS.md` §3.9).

---

## 7. Definition of done for the module
MODULES.md §11, plus: G1–G7 resolved; a full invented month (opening balances, credit entries across two months, a reversal, salary and generic with custom columns, an incentive, petty cash, an inbox filing and a reversal of a filing) walks through the screens and matches hand-worked numbers; **no preset role can read a single `mgmt_` table** (a test per table); the owner has tried each STOP on a phone; the brief's Handoff is current.

---

## 8. Paste this at the start of the next session

```text
You are building the "manager" module of the Dua pharmacy app (branch module/manager, create it from origin/main).
Read docs/SESSIONS.md, docs/MODULES.md completely, then docs/modules/manager.md and
docs/modules/manager.next-session.md (this is your work order). Then read docs/ARCHITECTURE.md,
docs/SECURITY_MODEL.md, docs/DATABASE_DESIGN.md, docs/DECISIONS.md, docs/BUSINESS_RULES.md and
docs/RUNBOOK.md §4, and study js/modules/sales as the finished example.
Step 0: run `npm ci && npm run verify` and `bash supabase/tests/run.sh`; both must pass before you change anything.
Then tell me in about 10 lines what you will do in Session M-A (steps A0-A4), which questions in section 3 you
need me to answer, and what you will not touch. Wait for my "go".
Do not guess money rules; ask. Stay inside MODULES.md §3.1 and §3.2 and migrations 0100-0199. Do not apply
migrations to the live project unless I say so. No real staff names, ID numbers, salaries or balances anywhere in
the repo. Check which Supabase project you are connected to: it must be DuaPharmaPlus.
At the end follow MODULES.md §0.2 and list every file you changed.
The old apps are references only: sysalmanyasin/BT-Sale-Data2 (main, js/manager and js/ledger), sysalmanyasin/Closing,
sysalmanyasin/Random. Do not import any data from them.
```
