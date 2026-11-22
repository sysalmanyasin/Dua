# Administrator Guide

For the owner. Everything here is done inside the app unless it says "Supabase" or "Google".

## 1. People and permissions (Users & Access)
- **Create a login:** Manager → Staff Registry → open the person → **Login**. Choose a username, **Junior** or **Senior** (starting templates), and a 4-digit PIN, then tell the person both. The PIN is permanent, cannot be shown again, and is refused if weak (0000, 1234, 1212, a year like 1990). The person must be on the payroll list and can have one login only. The registry shows **No login** next to anyone without one.
- **Set PIN:** Users & Access → *Set PIN*. The old PIN stops working immediately.
- **Unlock:** five wrong PINs lock a login for 1 hour. It shows *locked* here; tap **Unlock** to let them try again at once.
- **Disable / Enable:** a disabled person cannot sign in and an open session loses access at once.
- **Permissions:** open *Permissions* on a person. Permissions are grouped by module (Audit, Closing, Manager…); tap a group to open it. A ticked box means the person can do it. A *Custom* tag marks a box that differs from the role preset, and *Reset to role* removes those personal settings. Each tick is saved on its own. Search finds a permission by name, and the *Allowed* and *Custom* buttons narrow the list. *Allow all* and *Allow none* on a group need a second tap. Under the hood a tick is a personal *Allow* or *Deny* and deny always wins. The role preset only gives a starting set: closing entry, audit counting, inventory search, last-day sale, STR create.
- **Owner account:** needs MFA; it is created in Supabase (Authentication → Users) and made owner once with `bootstrap_first_admin`. It cannot be changed from the app.
- Every change is written to the activity log with who, when, old value and new value.

### Permission keys

The live permission catalog contained **70 keys** on 21 November 2026. Descriptions below are copied from the live `public.permissions` catalog; the database remains authoritative.

| Key | Meaning |
|---|---|
| `activity.view` | View activity log |
| `audit.assign` | Assign, move and revoke audit assignments |
| `audit.barcode_admin` | Resolve barcode conflicts, disable or reassign a barcode |
| `audit.barcode_register` | Register and verify barcodes, report conflicts |
| `audit.barcode_scan` | Scan barcodes while counting |
| `audit.compile` | Compile audit rounds and generate the next round (Individual Audit rounds compile themselves on submit and do not need it) |
| `audit.count` | Count assigned audit items |
| `audit.expiry_log` | Log near-expiry stock |
| `audit.expiry_manage` | Manage racks, rack assignment and locked expiry entries |
| `audit.finalize` | Create the audit Final Snapshot |
| `audit.individual` | Start own Individual Audits |
| `audit.manage` | Create and assign audits |
| `audit.reopen` | Reopen a submitted audit assignment |
| `audit.report` | Export audit reports |
| `audit.review` | Review audit variances |
| `audit.suggest` | Propose a corrected audit count with a reason |
| `audit.templates` | Create and edit audit templates |
| `audit.view` | See audit engagements, rounds, progress and compiled results |
| `backup.run` | Run backups |
| `candela.today_total` | See today's Candela sales total only (one number) |
| `candela.view` | See Candela sales history, payment breakdowns and customer credit summaries (owner) |
| `checklist.fill` | Fill in, edit and send the daily check list |
| `checklist.manage` | Change checklist items, defaults and dropdown lists |
| `checklist.view` | View daily check lists |
| `closing.correct` | Correct a submitted closing |
| `closing.enter_own` | Enter own shift closing |
| `closing.review` | Review closings |
| `closing.settings` | Change closing settings |
| `closing.view_all` | View all closings |
| `credit.view` | See credit balances |
| `ebill.discount_override` | Give Emergency Billing discounts above the staff limit |
| `ebill.export` | Export Emergency Billing reports (CSV, Excel, PDF) |
| `ebill.history_all` | See every Emergency Billing invoice |
| `ebill.manage` | Emergency Billing manager: devices, staff discount limits, refunds and corrections |
| `ebill.set_pin` | Set Emergency Billing finalize PINs (owner) |
| `ebill.use` | Use Emergency Billing: create and save invoices and see your own history |
| `inventory.search` | Search inventory |
| `inventory.sync` | Trigger an inventory sync by hand and see sync errors |
| `inventory.view` | See inventory sales figures and run the inventory reports |
| `inventory.view_cost` | See cost prices |
| `invoice_desk.manage` | Manage Invoice Desk invoices and product suggestions |
| `mgmt.close_month` | Close a monthly manager sheet |
| `mgmt.credit_manage` | Add staff credit entries, reversals and deductions |
| `mgmt.inbox_file` | See the Credit Inbox and file lines into ledgers |
| `mgmt.incentive` | See and edit the incentive calculator |
| `mgmt.ledgers` | See and edit the expense, Jazz Cash and misc ledgers |
| `mgmt.notes` | Read, add and remove private staff notes |
| `mgmt.openings` | Set opening balances |
| `mgmt.petty_cash` | Petty cash |
| `mgmt.rates` | Change the generic, incentive and commission rates |
| `mgmt.salary` | See and edit salaries |
| `mgmt.salary_view` | See salary, generic and payslip sheets (read only) |
| `mgmt.staff_edit` | Add and edit staff details |
| `mgmt.staff_private` | See and edit private staff details (father name, address, blood group) |
| `mgmt.staff_view` | See the staff registry: names, codes, designations, phone |
| `notifications.view` | See and acknowledge owner alerts (owner only; admins hold every permission, nobody else is granted it) |
| `reports.view` | View reports |
| `sales.edit` | Correct daily sales |
| `sales.enter` | Enter daily sales |
| `sales.view_history` | See sales history |
| `sales.view_last_day` | See the most recent closed day total |
| `settings.manage` | Change settings |
| `str.approve` | Approve stock transfer requests |
| `str.create` | Create stock transfer requests |
| `str.view` | See stock transfer requests, their reports and the zero-dispatch list |
| `targets.manage` | Manage sales targets |
| `tools.view` | Open the owner Tools tab: notifications, backups, feed status (owner only; admins hold every permission, nobody else is granted it) |
| `users.manage` | Manage users, roles and permissions |
| `workspace.create` | Create new Workspace notes and workbooks and share them |
| `workspace.use` | Open Dua Workspace and work on notes and sheets shared with you |

## 2. Current module availability (21 November 2026)

All 13 modules are integrated and registered in the application. Automated CI passed on main commit `9669497`; real-device and owner acceptance are still separate gates.

- **Home:** Home 2.0 is integrated with permission-filtered business/stock summaries, daily progress, attention links and device-local favourites. Owner phone acceptance remains.
- **Sales:** dashboard, daily entry/correction, monthly history, reports, checklist, targets/fields, deposit and Gmail-send flow are integrated. Owner phone acceptance and one real Gmail send from the deployed origin remain.
- **Manager:** Staff Registry, Staff Credit, Salary, Generic, Incentive, Petty Cash, Expenses, Jazz Cash, Misc, Balance Tally, Credit Inbox and reports are integrated. Staff Credit, Salary and Generic use gridded numbered tables. Migrations 0101–0108 are live. Owner phone try-outs #2–#4 and a real Closing Credit Inbox check remain. Attendance is deferred.
- **Users & Access:** owner-managed staff login creation, PIN reset, lock/unlock, enable/disable, roles and per-person Allow/Deny permissions are integrated. No self-sign-up. Keep owner/staff sign-in acceptance and access-security review on the checklist.
- **Tools:** owner-only alerts, backup status, restore-drill status and Inventory feed health are integrated. A real restore from an encrypted Drive backup into a separate empty Supabase project is still required.
- **Closing:** 14-section ledger, shared drafts/live sync, submit/reopen, Credit and Misc ledgers, Manager feed, Closing Book/PDF, histories, Review and Settings are integrated. Migrations 0201–0214 are repo-numbered in the live registry; 0215–0217 and the refresh migration are timestamp-registered. Owner phone try-out #5 and the Inventory Audit gate decision remain.
- **Inventory:** six screens, Home stock summary, feed and Excel/PDF/CSV exports are integrated. Migrations through 0309 are live; 0309 is timestamp-registered; the sync Edge Function is v24. Real-phone PDF acceptance and sync monitoring/fallback cleanup remain.
- **STR:** list, detail, report, Zero Dispatch, archive and overdue notification workflows are integrated; migrations 0500–0504 and scheduled jobs are live. Owner phone try-outs #1/#2, supplier/pack metadata follow-up and acceptance remain.
- **Candela Sales:** owner history/customer-credit screens and the staff-safe daily-total pill are integrated; migration 0900 is live. Owner phone acceptance and hourly history-capture monitoring remain.
- **Emergency Billing:** offline POS, sync, holds, history, corrections, full/partial refunds, receipt settings/printing, Search receipt, reports and exports are integrated. Automated Phase 6 testing is documented complete; migrations through 0642 are live. The owner must grant intended `ebill.*` permissions, complete receipt settings and test actual devices/printers.
- **Audit:** Audit 2.0 command centre, counting/outbox, Individual Audit, compile/review/corrections/conflicts, Final Snapshot, reports, expiry/racks and Barcode are integrated. Individual Audit rounds compile themselves when the person submits (no manual compile; no conflicts between individual rounds). Migrations 0401–0412 are live (0409–0412 timestamp-registered). PHONE 1/2/3/4, scanner/offline, print/CSV acceptance and security review remain.
- **Invoice Desk:** three business-specific invoice templates, invoice creation/history/product suggestions and 80 mm browser print path are integrated. Migrations 1000–1003 are live under timestamp registry versions. E2E save/product/history/RLS tests, workbook/logo comparison and physical printer acceptance remain.
- **Workspace Notes:** home/search/folders, rich-text editor, autosave, sharing, history/restore, archive/delete are integrated and accepted by the owner after live testing (reported 21 Nov).
- **Workspace Sheets:** database foundation migration 1102 is live; Sheets UI/domain model/data layer/grid and New workbook flow are **not built**. Formulas, formatting/filter/CSV, offline sync/conflict merge and attachments are later phases.

**Important:** 90 repository migration files and 90 live registry rows exist (22 Nov 2026), but 13 rows use timestamp versions instead of their four-digit repository versions. Do not reapply these migrations or insert duplicate rows; follow the migration-registry reconciliation plan before future database batches. See `docs/PROJECT_AUDIT_2026-11-21.md`.

## 3. Sales settings
- **Sales → Fields (Manage Fields):** add your own bank or client column, rename a field, tick whether it appears on the Add Entry page, move it up/down, or **switch it off** (kept in history, not usable for new days). Once a field has saved figures its **type (adds / deducts / info only) and section cannot change**; hide it and add a new field instead.
- **Sales → Targets:** a target for any month (3 months ahead and 23 back). Empty box = remove.
- **Check list dropdown lists:** the pen button beside a dropdown (needs *checklist.manage*).
- **Private check-list defaults** (your name, contact number, competitor figures, doctor name) live in the database, not in Git. See `docs/SETUP.md`.
- Values in the `settings` table not yet editable in the app: `till_float` (Rs 45,000), `per_customer_charge` (Rs 1), `modules_disabled` (a list of module ids to switch off). Change with the logged function `settings_set` in the Supabase SQL editor.

## 4. Google (Gmail sending)
One-time steps are in `docs/SETUP.md` ("Gmail sending"): enable the Gmail API, add the send scope, add `https://sysalmanyasin.github.io` as an authorized JavaScript origin, and add the sending address as a test user if the app is in Testing mode.

## 5. Supabase settings that matter
Authentication → Sign In / Providers: **sign-ups off**, minimum password length **6**, **TOTP MFA on**. Edge Functions → Secrets: `ALLOWED_ORIGIN` (the site address) and `IP_HASH_SECRET` (random). Never put the service-role key anywhere else.

## 6. Security habits
- **Revoke GitHub tokens** after a working session (GitHub → Settings → Developer settings → Tokens). A token pasted in a chat must be treated as exposed.
- Give staff only what they need; use *Deny* for exceptions.
- Delete test accounts (disable them) when done.

## 7. Backups — read this
**Automatic backups are live (13 Nov 2026).** GitHub Actions creates a daily encrypted database backup in Google Drive, verifies the uploaded file by checksum, retains daily and weekly copies, and reports status through owner notifications / the Tools tab. The first successful Drive backup is recorded. **A real restore drill from a Drive file into a separate Supabase project is still pending**; the local 39/39 restore test does not prove that path. Follow `docs/RUNBOOK.md` §6 and `docs/PROJECT_STATUS.md`.

## 8. Sales history import
The 2,379 days (1 Apr 2020 – 4 Nov 2026) were imported once on 5 Nov 2026 and checked against your original monthly totals (79 of 80 match exactly; the exception is the flagged 25 Sep 2026, 5,674 lower). The temporary import tooling was removed. See `docs/DECISIONS.md` D-26.
