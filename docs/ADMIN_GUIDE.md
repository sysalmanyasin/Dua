# Administrator Guide

For the owner. Everything here is done inside the app unless it says "Supabase" or "Google".

## 1. People and permissions (Users & Access)
- **Access requests:** a new person asks for access; nothing happens until you approve. **Approve as Junior** or **As Senior** (the two are identical today; they are only starting templates). The one-time **setup code** appears **once**: give it in person. It works once and expires in 24 hours.
- **Reset PIN:** the old PIN stops working immediately and you get a new setup code.
- **Disable / Enable:** a disabled person cannot sign in and an open session loses access at once.
- **Permissions:** open *Permissions* on a person. Each permission is *Role default*, *Allow* or *Deny*. Deny always wins. The role preset only gives a starting set: closing entry, audit counting, inventory search, last-day sale, STR create.
- **Owner account:** needs MFA; it is created in Supabase (Authentication → Users) and made owner once with `bootstrap_first_admin`. It cannot be changed from the app.
- Every change is written to the activity log with who, when, old value and new value.

### Permission keys
| Key | Meaning |
|---|---|
| `activity.view` | View activity log |
| `audit.count` | Count assigned audit items |
| `audit.manage` | Create and assign audits |
| `audit.review` | Review audit variances |
| `backup.run` | Run backups |
| `checklist.fill` | Fill in, edit and send the daily check list |
| `checklist.manage` | Change checklist items, defaults and dropdown lists |
| `checklist.view` | View daily check lists |
| `closing.correct` | Correct a submitted closing |
| `closing.enter_own` | Enter own shift closing |
| `closing.review` | Review closings |
| `closing.settings` | Change closing settings |
| `closing.view_all` | View all closings |
| `credit.view` | See credit balances |
| `inventory.search` | Search inventory |
| `inventory.sync` | Trigger an inventory sync by hand and see sync errors |
| `inventory.view_cost` | See cost prices |
| `mgmt.petty_cash` | Petty cash |
| `mgmt.salary` | See and edit salaries |
| `reports.view` | View reports |
| `sales.edit` | Correct daily sales |
| `sales.enter` | Enter daily sales |
| `sales.view_history` | See sales history |
| `sales.view_last_day` | See the most recent closed day total |
| `settings.manage` | Change settings |
| `str.approve` | Approve stock transfer requests |
| `str.create` | Create stock transfer requests |
| `targets.manage` | Manage sales targets |
| `users.manage` | Manage users, roles and permissions |

## 2. Current module availability\n- **Sales:** implemented; see the User Guide for available pages.\n- **Manager:** Staff Registry and Staff Credit are implemented. Migrations 0101–0103 are live. Owner phone acceptance and later slices (including payslips and petty cash) remain outstanding. See `docs/modules/manager.progress.md`.\n- **Closing:** partially implemented. The guided ledger is in progress; remaining sections, submit flow, ledgers and print are not complete. See `docs/modules/closing.progress.md`.\n- **Inventory:** Candela feed is live; enhanced feed migrations 0301–0304 and Edge Function v14 are reported live, but their source changes still need integration into `main`. Inventory screens/local copy are incomplete. Do not reapply those live migrations.\n\n## 3. Sales settings
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
