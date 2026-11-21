# Administrator Guide

For the owner. Everything here is done inside the app unless it says "Supabase" or "Google".

## 1. People and permissions (Users & Access)
- **Create a login:** Manager → Staff Registry → open the person → **Login**. Choose a username, **Junior** or **Senior** (starting templates), and a 4-digit PIN, then tell the person both. The PIN is permanent, cannot be shown again, and is refused if weak (0000, 1234, 1212, a year like 1990). The person must be on the payroll list and can have one login only. The registry shows **No login** next to anyone without one.
- **Set PIN:** Users & Access → *Set PIN*. The old PIN stops working immediately.
- **Unlock:** five wrong PINs lock a login for 1 hour. It shows *locked* here; tap **Unlock** to let them try again at once.
- **Disable / Enable:** a disabled person cannot sign in and an open session loses access at once.
- **Permissions:** open *Permissions* on a person. Each permission is *Role default*, *Allow* or *Deny*. Deny always wins. The role preset only gives a starting set: closing entry, audit counting, inventory search, last-day sale, STR create.
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
| `audit.compile` | Compile audit rounds and generate the next round |
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

## 2. Current module availability
- **Sales:** implemented; see the User Guide for available pages.
- **Manager:** Staff Registry and Staff Credit are implemented. Migrations 0101–0103 are live. Owner phone acceptance and later slices (including payslips and petty cash) remain outstanding. See `docs/modules/manager.progress.md`.
- **Closing:** partially implemented. The guided ledger is in progress; remaining sections, submit flow, ledgers and print are not complete. See `docs/modules/closing.progress.md`.
- **Inventory:** live and complete. The Candela feed syncs every hour (migrations 0301–0307, Edge Function v23). Screens: Overview, Stock Ledger, Reorder, Excess Working, Health, Sync. Home shows a Stock row to people with `inventory.view`. Reports export to Excel, PDF and CSV. Do not reapply the migrations. The sync schedule is a pg_cron job (`inventory-hourly-sync`); see `docs/RUNBOOK.md`.

- **Workspace (Notes):** live. No role carries `workspace.use` or `workspace.create`: grant them per person in Users & Access. A person needs `workspace.use` to open Workspace and see what is shared with them, and `workspace.create` to start notes and share them. Your own admin account holds both (at the second factor) but, by design, sees a colleague's note only if it was shared with you. Remove someone's access to Workspace by denying `workspace.use`; they lose every note at once. Sheets are not built yet. Details: `docs/modules/workspace.md`.

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
