# f13: Stage 7, testing and hardening (26 Nov 2026)

Nothing in this stage changed the live database. The live work was read-only, or ran inside transactions that were rolled back (checked afterwards: no test rows left). No code feature was added.

## 1. What was run, and the result

| Check | Result |
|---|---|
| Unit suite, lint, format, secrets, vendor | Pass: 183 files, 2,816 tests |
| Database: replay of all 127 migrations on PostgreSQL 16 (pgcrypto available, nothing skipped) and every `supabase/tests/*_test.sql` | Pass: 111 test files, 4,305 passing checks, 0 failures, 0 errors. This includes the security guards 0199, 0749, 1299 and 1399 |
| Live security advisor | 3 findings, none new in kind (section 2) |
| Live performance advisor | 4 kinds of finding, all performance only (section 2) |
| Every `SECURITY DEFINER` function has `search_path=public` | 357 definer functions live; 356 pass. The one exception is `rls_auto_enable`, a platform function (search_path `pg_catalog`, nobody can call it) |
| Closed tables stay closed | All 139 public tables have RLS on. None is readable or writable by `anon`. Every table with RLS and no policy has no grant to `anon` or `authenticated` |
| Who can call what | Live and the local replay agree exactly on who can run each function (285 for signed-in users, 4 for `anon`) |
| Hash check (D-47) of every live public function against the replay | First run (421 live functions): 389 byte-identical, 31 differ only by comment lines or spacing, 1 exists only live (`rls_auto_enable`). The Task Master, Inbox, Operations and Sales functions (Stages 3 and 4) were byte-identical. Second run after `0310` and `0419` were applied, with comments and spacing removed: all 30 function groups match, including the new audit and inventory functions |
| Tables, columns, constraints, indexes (139 tables) | Identical to the replay (checked before `0310` and `0419`; not rechecked after) |
| Wrong-role test, live, rolled back | A Junior and a Senior called 40 read functions. Owner-only data (salary, staff, petty cash, credit, attendance list, all tasks, team overview, rules, push rules) was refused or empty for both. What they could read was allowed by permissions the Owner granted (section 3) |
| Task flow, live, rolled back | All 17 steps behaved correctly (section 4) |
| Small screen | The sign-in page fits 360 px and 320 px wide with no sideways scroll and no tiny buttons. Signed-in screens could not be opened (no login here); the unit tests render them in jsdom |
| Offline | After Emergency Billing has been opened once on a phone, the app starts with no connection (375 files cached). Before that, nothing works offline (by design) |
| Slow connection (400 kbps, 400 ms delay, cache off) | The sign-in page loads in about 11 seconds and moves 452 KB. Cache was off, so a phone that has loaded it before will be faster |

The 31 functions that differ only in comments: `app_device_register`, `mgmt_attendance_check_in`, `audit_barcode_disable`, `audit_barcode_enable`, `audit_barcode_register`, `audit_engagement_create`, `audit_expiry_log`, `audit_finalize`, `audit_round_next`, `audit_scan_batch`, `candela_keep_credit`, `candela_keep_payments`, twelve `closing_*` (`apply_carry`, `apply_payload`, `build_input`, `calc`, `change_mode`, `lock_closing`, `patch_draft`, `period_agg`, `save_draft`, `start_opening`, `submit`, `write_result`), `ebill_refund_lines`, `ebill_save_invoice`, `invoice_desk_amount_words`, and four `workspace_*` (`create_document`, `folder_remove`, `member_remove`, `note_node_ok`). I compared them after removing comment lines and spacing, and all 31 matched.

## 2. Advisor findings (read-only; nothing changed)

- Signed-in users can run 272 `SECURITY DEFINER` functions. By design: each one checks `has_perm()` itself, and the guards confirm the list matches what is allowed.
- 29 tables have RLS on and no policy. By design: these are the closed tables.
- Leaked-password protection is off in Supabase Auth. Dua signs in with a username and PIN, so this matters little; it is a dashboard setting for the Owner.
- 145 foreign keys without an index, 22 unused indexes, 5 policies that re-evaluate `auth.uid()` per row (`staff`, `profiles`, `user_permissions`, `user_prefs`, `closings`), 1 table with two permissive read policies (`payment_methods`). Performance only; the data is small. Not fixed (no features or migrations in this stage).
- 4 pure text helpers in the Invoice Desk (`invoice_desk_amount_words`, `invoice_desk_under_thousand`, `invoice_desk_validate_amount_words`, `invoice_desk_validate_line_product`) can be run by `anon`. They touch no tables. Low risk; revoking is a small migration for you to approve.

## 3. For the Owner to confirm (permissions found live)

These are personal grants and denials on named people. I changed none of them.

1. One Senior holds a personal `tasks.manage` grant. That permission is described as owner-only (create, assign and cancel tasks, see every task and the team overview). D-53 and D-52 talk only about `tasks.verify`. Is this intended?
2. One Junior has a personal deny of `tasks.view_own`, so that person cannot see or accept their own tasks. Is this intended?
3. Both Juniors hold personal grants of `closing.view_all`, `closing.review` and `closing.correct`. That lets them read the closing book, the credit ledger and the misc ledger, and correct closings. Is this intended?
4. One Senior has `closing.enter_own` granted and `closing.view_all`, `closing.correct` and `inventory.search` denied. Looks deliberate; please confirm.

## 4. The live task flow that was checked (rolled back)

Using a real Owner login (second step on) and a real Junior with no denies: the Owner created and assigned a task; the Junior accepted and started it; handing in without a note was refused; the Junior could not verify their own work; sending back without a reason was refused; the Owner sent it back with a reason; the Junior got 2 notices and the bell showed 2; the Junior handed in again and the Owner verified (status completed); the Junior asked for a deadline change and could not decide it; the Owner approved (new date 5 days ahead); the overdue reminder reached the Junior once and did not repeat when run again; Mark all as read took the bell to 0. Afterwards there were no test rows, and the registry still had its rows.

## 5. Phone test script for the Owner

Do these on your phone with the real app. Use a test task with the title starting "TEST" so you can cancel it afterwards. "Live checked" means I ran the same steps against the live database in a rolled-back transaction; it does not mean the screen was seen.

| # | Do this | You should see | Live checked? |
|---|---|---|---|
| 1 | Sign in as Owner (username, PIN, then the second step) | Home opens; bell is in the top bar | Login not checked |
| 2 | Tasks, then New task: title "TEST count shelf", Evidence: A note, assign to a Junior, deadline in 3 days, Save | Task appears as Assigned | Yes |
| 3 | On a second phone or after signing out, sign in as that Junior | Bell shows 1; Inbox says a task was assigned to you | Yes (notice count) |
| 4 | Junior: open the task, Accept, then Start | Status moves to Accepted, then In progress | Yes |
| 5 | Junior: Hand in with the note left empty | Refused: a note is needed | Yes |
| 6 | Junior: Hand in with a note | Status Handed in | Yes |
| 7 | Junior: look for a Verify button | There is none | Yes (refused) |
| 8 | Owner: bell shows a new message; open Verification, take the task, Send back with no reason | Refused: a reason is needed | Yes |
| 9 | Owner: Send back with the reason "Two shelves missed" | Status Returned | Yes |
| 10 | Junior: bell shows the message; Start, Hand in again with a note | Handed in | Yes |
| 11 | Owner: take it and Verify | Status Completed; the Junior is told | Yes |
| 12 | Junior: make a second task, Accept, Ask to change deadline (reason, new date) | Request is waiting | Yes |
| 13 | Junior: try to approve own request | No such button, or refused | Yes |
| 14 | Owner: Change requests, Approve | New date shows on the task | Yes |
| 15 | Overdue reminder: wait until the next morning, 08:00 Pakistan time, with a task that is overdue | One message "Overdue task", not repeated that day | Rule checked, 08:00 timing only on a phone |
| 16 | Bell: note the number; the tab title shows it; open Inbox, Mark as read; then Mark all as read | Number drops to 0 | Yes (counts) |
| 17 | Inbox on a weak signal: switch to airplane mode, open Inbox | Clear "could not be loaded" message, no old number shown as current | Only a phone |
| 18 | Sales, Sale Book: pick this month, Build | Table with a total; Print or Save as PDF works | Not checked (new route) |
| 19 | Sale Book: choose a year, then All time | Months in order with year totals; compare one month with Sale Report | Not checked |
| 20 | Sales, Targets: set a target for this month | Saved; Sale Report card uses it | Not checked |
| 21 | Sales, Manage Fields: rename a field, switch it back | Saved; old figures unchanged | Not checked |
| 22 | Attendance (Android app): check in at the shop | Accepted or a clear reason | Not part of this stage |
| 23 | Cancel the TEST tasks | Status Cancelled | Yes (rule) |
| 24 | Rotate the phone and use the smallest text size | No sideways scrolling, buttons easy to tap | Only a phone |
| 25 | Close the app, turn on airplane mode, open it (only after Emergency Billing was opened once on this phone) | App opens; screens that need data say they could not load | Offline start checked; screens only a phone |

Things only a person on a phone can check: the sign-in with the second step, every screen look, printing and PDF, the 08:00 reminder, push alerts, the Android app, and the real Gmail send.

## 6. Close-out

### Still open
- Two more live migrations arrived from another session while this stage ran, registered with timestamp versions again: `0419 audit_live_balances` and `0310 inventory_deactivated`. I renamed them to their repo numbers after a backup (`schema_migrations_backup_20261126_regrename`, 127 rows). The live registry now has 127 rows and none with a timestamp version. This keeps happening; see the follow-up about asking the other session to register by repo number.
- The Sales pull request (#93) is merged. This stage's docs are on a new pull request.
- The Owner confirmations in section 3.
- The three Sales pages and everything in section 5 marked "Not checked" or "Only a phone".
- Existing acceptance gaps from earlier stages (real-phone PDF, Gmail send, printers, restore drill) are unchanged.
- The backup tables `schema_migrations_backup_20261125_regrename` and `schema_migrations_backup_20261126_regrename` can be dropped when you are happy with the registry.

### Defaults I chose that you have not confirmed (all "for the Owner to confirm")
- D-70 as written: reports stay in each module; the AI assistant is deferred; Targets and Manage Fields permissions are `targets.manage` and `settings.manage` (the ones the database already checks).
- The three registry renames (`0110`, `1401`, `0226`) were done at your request. The two on 26 Nov (`0419`, `0310`) I did on my own, on the same pattern; undo is a restore from the backup table. The 31 comment-only differences were accepted as the same logic.

### Follow-ups I chose not to do (no features in this stage)
- Add indexes for the 145 foreign keys; fix the 5 per-row policy evaluations and the double read policy on `payment_methods`.
- Revoke `anon` on the four Invoice Desk helper functions.
- Re-apply the 31 functions with exact repo text so the hash check is byte-for-byte (low value; the logic matches).
- Turn on leaked-password protection in Supabase Auth, if your plan allows.
- Ask the Android session to register migrations by repo number (not `apply_migration`), reserve ranges before applying, and say so when a migration is applied live.
- Stage 5 (AI assistant) if you want it later; D-59 and range `0800`–`0899` stay reserved.

### Reminder
Revoke the GitHub token you gave me. It was shared in this chat and I only used it as an HTTP header; nothing was stored.
