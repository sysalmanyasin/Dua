# Changelog (everything built so far)

Dates are 2026. Counts are as of the end of each step.
## 28 Nov — Audit: Live progress popup shows the products, differences and Force Submit (migration `0420`)
- The **Live progress** popup on Monthly Overview and Rounds & Progress now lists every product of the round **A to Z**, with what was counted, the system quantity, the difference and its value. Filters: **All**, **Differences**, **Counted**, **Not counted** (each with its count). Totals at the top add the number and value of differences.
- **Force submit** is in the popup for each counter who has not submitted, for people with `audit.compile`: leave the rest uncounted, or mark them as matching the system (kept flagged as assumed), with a reason. The list behind it reloads afterwards.
- Fixed: the progress bars in the popup were drawn empty (the fill colour was only defined inside the page, not in the popup). A counter submitted for "as matching" is now counted correctly in the popup (the earlier read counted only live count events).
- **Database:** `0420_audit_round_live` adds `audit_round_live(p_round)` (read only; same gate as the compile overview, so a counter cannot see system quantities) and re-creates `audit_force_submit` with one addition: an Individual Audit compiles itself after a forced submit, like a normal submit (`0412`), so the round is not left open. Other rounds behave exactly as before. Test: `supabase/tests/0420_audit_round_live_test.sql` (27 checks).
- **Web:** `audit/domain/roundLive.js`, `audit/ui/roundProgress.js` (rewritten), `audit/data/api.js` (`roundLive`), CSS in `css/audit.css`. Tests: `audit-round-progress` (rewritten) and `audit-round-live`.

## 28 Nov — Audit 0 follow-up: handler tests for all 8 Edge Functions, more database tests, facts re-measured
- New handler tests for `attendance-health`, `notify-ntfy`, `sync-inventory-from-dropbox` (all 8 Edge Functions now covered against fake clients). New database tests `0004`, `0310`, `0212` (Closing book), `1000` (Invoice Desk save). Each was mutation-checked.
- Facts re-measured on `main` at `fb462f8` (137 migrations, 8 functions, 141 tables, 127 database test files); docs, runbook cron list and acceptance matrix updated. No application code, migration, workflow or existing test changed.

## 27 Nov — Audit 0: code and documentation reconciliation, test baseline
- Documentation rewritten to match the code: `README.md`, `docs/PROJECT_STATUS.md` (replaced), `ARCHITECTURE`, `SECURITY_MODEL`, `DATABASE_DESIGN`, `TESTING`, `SETUP`, `RUNBOOK`, `ANDROID_ARCHITECTURE`, `ROADMAP` (header). New: `docs/KNOWN_ISSUES.md`, `docs/TEST_ACCEPTANCE_MATRIX.md`, `docs/AUDIT_0_BASELINE.md`. Older status documents carry a historical banner. `README.tmp` removed.
- New tests (nothing existing changed or weakened): database `0999` (whole-schema exposure), `0014`, `0226`, `0505`, `1002`; handler tests for `staff-login`, `admin-users`, `attendance-event`, `widget-today` and the `notify-push` secret gate; `docs-consistency`; a known-defect marker for KI-2. New `npm run test:coverage` (measured, not enforced).
- Findings recorded, not fixed: KI-1 (five functions callable by the visitor role), KI-2 (amount in words below one rupee). No migration was applied and nothing was deployed.


## 27 Nov — Home: Owner-only Latest closing summary (migrations `0227` and `0704`)
- New card on Home, above the Action Centre, for the Owner only (`ops.view` with the second factor): the latest submitted closing named like "2026-11-22 — Closing 1 — Night", with **Carried CC**, **Total Deposits**, **Book Bills**, **Manual Returns** and **MEDIQ Collected**. Book Bills, Manual Returns and MEDIQ are totals since the last Final Closing (the Final's own figures included, the same rule as the Final page; if the latest closing is a Final it shows only its own). Deposits are the latest closing's cumulative Total Cash Deposits; Carried CC is what that closing carried in. MEDIQ is the extra MEDIQ collected, as the Final page adds it up.
- **Database:** `0227_closing_ops_summary` (Closing range, internal only, adds stored values, no money rule changed) and `0704_ops_closing_summary` (the Owner door, returns null without `ops.view`). The Ops exposure guard `0749` now whitelists `ops_closing_summary` (seven functions). Test: `supabase/tests/0227_closing_ops_summary_test.sql` (25 checks, including a match with `closing_final_breakdown`).
- **Web:** `home/domain/closing-summary.js` (words and boxes), `home/ui/closing-summary.js` (section, own realtime channel, keeps the last figures when a refresh fails), CSS in `css/home.css`; `watchClosings` takes an optional channel name.
- Tests: 14 new unit tests plus a gating test (the card is shown to the Owner only and is never requested for anyone else).

## 26 Nov — Audit tab chips about 60% of their old size
- The two rows of tabs on the Audit pages (Overview / Team Audit / Individual Audit / Tools, and the screens under them such as Monthly Overview, Rounds & Progress, Review) were tall and wide. Height, side padding and text are now about 60% of before (tabs 44 px to 26 px, screens 40 px to 24 px). CSS only (`css/audit.css`). Not yet seen on the owner's phone.

## 27 Nov — Automatic attendance, Phase 6: tracking can't be switched off silently (staff are not blocked)
- Decision: staff keep using Dua as normal; no block screen. There is no opt-out tick (the owner's switch applies to everyone with the check-in right). Phase 6 makes sure the owner always knows when tracking is off.
- **Phone (needs a new APK).** Every 15 minutes the phone reports its own tracking state (which problem, how many events are waiting; no location) to a new Edge Function `attendance-health` with its device key.
- **Server (migration `1404`).** The phone's state is stored; while recording is on every change is kept in an append-only log and the owner is alerted (`attendance.tracking_off`). A scheduled check (pg_cron, every 15 minutes) alerts for a phone that stopped reporting for an hour (07:00–22:00 Pakistan), for tracking still off (daily reminder) and for a check-in open over 14 hours (`attendance.checkout_missed`). New owner reads `mgmt_attendance_health` (who is at work, each phone's state) and `mgmt_attendance_gaps`. Alerts carry dates only.
- **Web.** Owner: "Who is at work" card and "Times a phone was not tracking" under the day's records. Staff: a red strip at the top of Dua with the one thing to fix, linking to Attendance (never blocks anything). New alert wording for the two alert kinds.
- Tests: 51 new database checks (3,260 total), 88 new unit tests (3,543 total: parser, alert wording, strip, owner cards, wording helpers), 3 new Java logic tests (16, run locally); shell check pins the health address to the events address. The Android classes compile in CI only (PR debug build).

## 27 Nov — Attendance page: three fixes from the first look at the new page (web only, no new APK, no migration)
- A **check-out** refused because you are not at the pharmacy no longer says "Check in when you arrive"; it says the check-out was not recorded.
- Journal lines show the time with the day small underneath (older lines no longer wrap the title); a week row with nothing to show no longer carries an empty "—" chip.
- An **older copy of the app** (built before Phase 4) is now left alone when the owner switches recording on: the page no longer registers the geofence again on every visit or asks for a key that app cannot use. It still receives place changes.
- Seen in that screenshot (not a bug): recording was still OFF, so the 27 Nov 00:23 manual check-out from home (15 km away) was refused, as designed (a manual check-out must be at the pharmacy), and the 26 Nov check-in stays open until the owner closes it or recording is on. Re-registering the geofence after an app update produced one extra "Arrived" (16:04), as documented.

## 27 Nov — Automatic attendance, Phase 4: the phone records arrivals and leaving itself (off until the owner switches it on) + a tidier Attendance page
- **Server (migration `1403`, app range, after `1401`).** Owner switch `auto_enabled` (default OFF) with `mgmt_attendance_auto_set` (reason, idempotent, logged); per-device attendance secret (`app_device_attendance_enroll`, hash only, cleared when the phone changes hands); `app_attendance_event` (service role only) measures the distance itself, refuses mock/weak/no-place/wrong-side, ignores harmless repeats (already in, not in, older than the last record, over a day old, in the future), never records one event id twice, handles one person at a time, and checks the person's current `attendance.check_in` every time; `mgmt_attendance_auto_events` keeps every event with its outcome (append-only). Recorded rows are ordinary `mgmt_attendance` rows with source `auto` (new reason `still_inside`). New Edge Function `attendance-event` (public, secret-checked; added to the CI type-check list).
- **Phone (needs a new APK).** After a stay inside: fresh GPS fix, then queue an "in"; after leaving: wait the stay time, fresh fix, still outside then queue an "out" (back inside = cancelled). Weak fix: tried again 5 times, then sent so the owner sees the refusal. Encrypted queue (50), sent when there is a network, also by the 15-minute check. The endpoint is pinned to our own function; the secret is never logged.
- **Web.** Owner checkbox "Record arrivals and leaving automatically" (Test mode / On); the page tells the phone the switch and key; the journal shows what happened to each event (recorded, refused, not needed, cancelled, waiting); refused automatic attempts are marked "Automatic".
- **Attendance page redesigned**: status blocks, clean row lists instead of cramped tables (staff days, owner day, owner week grouped by day), a tick grid for the phone checklist, normal-sized checkboxes, consistent spacing; checked at phone width in light and dark.
- Tests: 50 new database checks (3,209 total), 3,455 unit tests (parser, bridge, page, wording), 13 Java unit tests run locally, shell check pins the new endpoint.
- **Live (27 Nov, after merge of PR #104)**: `1403` applied (registry row `1403 app_attendance_auto_events`, by the Supabase GitHub integration; objects, grants, triggers and the unchanged `auto_enabled = false` checked against the repo) and `attendance-event` v1 deployed (`verify_jwt` off; its code matches the repo). A live database check refused an unknown device and stored nothing. Not checked: the function's URL from outside (the authoring environment cannot reach it). The new APK is untested on a phone; recording is still OFF.

## 26 Nov — Fix: the phone now learns about a place added after Dua was opened (web only, no new APK, no migration)
- Found from a screenshot of the first real phone test: the place existed and a manual check-in worked, but the Automatic attendance card said "The owner has not added the pharmacy place yet". The phone fetched places only when Dua started, and "Check again" only re-read the phone's own status.
- Now the Attendance page asks the server for the places when it opens, on **Check again**, and after the owner saves a place or limits. Nothing is registered again when the phone already watches the same places (registering restarts the stay timer).
- A refused attempt with no measured distance no longer reads "(— from the nearest place)".
- Limit that remains: a staff phone learns of a changed place only when that person opens Dua. Phase 5 (a device key the phone can use while Dua is closed) removes it.
- Tests: 2,849 unit tests.

## 26 Nov — Automatic attendance, Phase 3 (native geofencing, detection only) — needs a new APK; migration 0112 not applied live
- The Android app registers the pharmacy's geofence with Google Play services (DWELL after the stability period, and EXIT). It keeps watching with Dua closed and the screen locked, is registered again after a restart or an app update, and is checked every 15 minutes. The person is told once if location, "all the time" permission or background use is taken away. Detections go to a local journal on the phone and are shown on the Attendance page as **test mode**: **nothing is recorded as attendance yet** (Phase 4).
- New permissions `ACCESS_BACKGROUND_LOCATION` and `RECEIVE_BOOT_COMPLETED`; new native classes `AttendanceGeofence`, `GeofenceReceiver`, `BootReceiver`, `AttendanceWatchdogWorker`, `AttendanceStore`, `AttendanceLogic` and six plugin methods. The shell check pins the new permissions, the unexported receiver, the mutable PendingIntent and DWELL with a loitering delay. CI runs `AttendanceLogicTest`.
- Migration `0112_mgmt_attendance_auto_setup`: `stable_seconds` setting (default 120, owner-set 30–600 via `mgmt_attendance_stable_set`, reason required and logged), `mgmt_attendance_my_site` (the narrow read a staff phone uses: active places, stay time, accuracy limit), and `mgmt_attendance_setup` also reports the stay time.
- Web: *Automatic attendance* card (shown only inside the app with the new APK) with a checklist and repair buttons; the owner's *Limits* gain the stay time; sign-in hands the places to the phone, sign-out and a lost right clear them. An older APK ignores all of it.
- Tests: 28 new database checks (exposure whitelist now 54 functions), 31 logic assertions run here, 22 new unit tests. **Not tried on a real phone and the Android code has not been compiled yet** (the pull request build does that).

## 26 Nov — Status bar no longer widens the page on a phone (D-71)
- The strip of pills at the top (Latest sale, Credit inbox, Stock, Candela today, time) was wider than a phone and made the whole page slide sideways. It now scrolls inside its own bar and the page stays at screen width. CSS only (`css/components.css`); new test `status-bar-css`. Not yet seen on the owner's phone.

## 26 Nov — Stage 7: testing and hardening (f13)
- Full unit suite, lint, format, secrets and vendor checks pass (183 files, 2,816 tests). The whole database set passes on a PostgreSQL 16 replay of all 127 migrations (111 test files, 4,305 checks, security guards 0199, 0749, 1299 and 1399 included).
- Live read-only audit: advisors, `search_path` on every definer function (356 of 357; the exception is the platform function `rls_auto_enable`), closed tables closed, who-can-call-what identical to the replay, tables identical, functions identical apart from 31 comment-only differences. Wrong-role and task-flow checks ran live in rolled-back transactions and passed.
- Found, not changed (written up for the Owner in `docs/ops/f13-stage7-audit-and-phone-test.md`): a Senior with personal `tasks.manage`, a Junior denied `tasks.view_own`, Juniors holding closing grants, four Invoice Desk helpers callable by `anon`, performance advisor items, leaked-password protection off.
- Live registry: `0419 audit_live_balances` and `0310 inventory_deactivated` were registered with timestamp versions by another session; renamed to their repo numbers after a backup. No other live change.
- New: the phone test script and close-out list in the f13 doc. No code or feature change.

## 26 Nov — Automatic attendance, Phase 2 (Attendance module) — built and tested; migration 0111 NOT applied live
- Attendance has its own side-menu entry (`nav.links`). A person whose only Manager page is Attendance sees a single entry named **Attendance** (`navLinks` no longer lists one page twice).
- Staff see **My last two weeks** (per day: first in, last out, time at work, refused attempts). The owner sees **the week up to the chosen day** (one line per person per day, time at work, refused count, a "No check-out" flag for a past day left open) next to the existing day view, places and limits.
- Migration `0111_mgmt_attendance_views`: `mgmt_attendance_my_history` (own rows only, `attendance.check_in`), `mgmt_attendance_summary` (everyone, `attendance.view_all`) and the internal `mgmt_attendance_days` (not callable). A night shift counts on the day it started; the "out" after midnight makes no row for the next day. Read-only; 0110 is unchanged.
- Fixed a test that only passed on 25 Nov (its fixture used a fixed date; the page opens on today).
- Tests: `0111_mgmt_attendance_views_test` (25 checks), the exposure whitelist (52 functions), 9 new unit tests (2,797 in all); full database suite passes (3,124 checks). Not tried on a real phone. No role preset carries an attendance permission (unchanged: the owner grants it per person).

## 25 Nov — Sales Sale Book, Targets and Manage Fields routed; Stage 6 closed (D-70)
- Three Sales pages were written on 9 Nov but no route pointed to them, so they could not be opened. They now have routes under Sales: **Sale Book** `/sales/reports` (monthly report, a year, all time; print or save as PDF; permission `sales.view_history`), **Targets** `/sales/targets` (`targets.manage`) and **Manage Fields** `/sales/fields` (`settings.manage`). The permissions are the ones the database already checks. Calculations unchanged; one clean-up (the monthly report is calculated once, not twice).
- Stage 6 (Unified Reports) is **closed**: reports stay in each module, and the owner needs no other reports in other modules (D-70). No new module, range or migration.
- Tests: new `sales-reports-page` (8): routes and permissions, monthly, year and all-time views, empty period, failed load shows "Could not load", failed build shows an error. No database change.
- Not verified: the three pages on a real phone.

## 25 Nov — Menu and bell (D-69)
- Bell in the top bar with the unread number, tab-title number `(3) Page · Dua`, app badge where supported, and an in-app notice for each new message (checked every minute and whenever the app is shown again; a failed check clears the number). Inbox left the side menu.
- Team is a side-menu entry under Tasks (Owner only); Tasks and Inbox have their own icons. Pure helper `navLinks`; manifests may use `nav.links`, `nav.hidden` and `bell`.
- Tests: new `nav-bell` (9). No database change.

## 25 Nov — Operations Redesign, Stage 4 (Inbox and reminders) — built, tested and applied live (1300, 1301, 1204); merge pending
- New module `inbox` (`/inbox`, permission `ntf.view_own`): a person's own messages with Open, Mark as read, Mark all as read and a New filter. Home gets a **Messages** section (count and the newest three). Staff messages: task assigned to you, sent back for correction, your request decided, deadline changed or task cancelled. Verifiers and the Owner: work handed in. Owner: new change requests. Overdue reminders: one each morning at 08:00 Pakistan time while a task stays overdue. In-app only (D-58). Decision D-68.
- Migrations `1300_ntf_core` (closed table, server-only `ntf_send`, daily prune), `1301_ntf_reads` (four browser functions), `1204_task_notices` (trigger on the task history table plus the reminder job, in the Task Master range; no lifecycle function changed). Tests `1300`, `1301`, `1204`, and the new guard `1399_ntf_exposure_test.sql`; `0001_core_test.sql` now expects a Junior to hold 7 permissions. Apply and rollback: `docs/ops/f12-stage4-apply-and-rollback.md`.
- Verified locally: all database tests that can run without pgcrypto, and the unit suite. Not verified: anything on the live database, and the screens on a real phone.

## 25 Nov — Audit: four-tab layout (UI and navigation only; no database change)
- Four persistent tabs (Overview, Team Audit, Individual Audit, Tools) on every Audit page except counting. Spec: `docs/modules/audit-tabs.md`.
- Overview rewritten to exactly five sections (Quick actions, Product search, Pending actions, Individual audit, Active team audit). Pending actions include approved corrections not yet recompiled and Team rounds ready to finalize. The `/audit/attention` page is removed; product search no longer repeats on the Team audits page.
- Team Audit: Compile & Review and Corrections are separate screens (`/audit/corrections` is new); the audit and round are shown on every Team screen. Finalization shows a checklist that mirrors the database's refusals and blocks the button before the click. Reports gained the round-wise combined variance report (any or all compiled rounds, each with its own totals) and a Missing counts CSV.
- Individual Audit: Monthly Overview, Rounds & Progress, Review & Corrections (no compile button, conflicts, next round or final), Reports (per round, per person, combined month). The month picked is kept across the screens.
- Variance is never added across rounds: the summary export no longer has an "All rounds" row.
- Individual rounds lists (Rounds & Progress, Reports): one list newest first (default) with a Group by people switch, each round showing its template or companies; Reports shows the combined variance report first. Migration `0418_audit_individual_overview_scope` (read function gains `template_name`, `companies`). The tab bar's own class names no longer clash with the Expiry and Barcode tabs (it was wrapping onto two rows on a phone).
- Tests: hub-layout tests replaced; new `audit-overview`, `audit-workspace`, `audit-reports-combined`, `audit-final-checks`. `npm run verify`: 171 files / 2,647 tests pass. Database tests were not run (no database change). Not yet run on a real phone (PHONE 5 to 7 in `audit.phone-tests.md`) and the Team screens have not been exercised on real Team audit data (the live database held only Individual audits).

## 25 Nov — Closing start page and saved-closing view (owner review of the audit)
- **Start page:** the Opening closing card is hidden as soon as an opening exists (any saved closing, or an opening draft). The day panel shows only the draft to *Continue* for the chosen day, or, when there is none, the slot to start; saved closings are no longer repeated there (they are listed once, under Saved records). Every record shows **Responsible: name** and, once saved, its **Variance** in words (a Final shows its Final variance, any other closing its own shift variance).
- **Saved closing (view):** ends with the **Aggregated Final Closing** card (target, net cash available, Plus/Less for the full period since the last Final), as on the ledger's last section. Not shown for the opening closing.
- **Migration `0225_closing_list_variance`** (range 0200–0299): additive, read-only. `closing_saved_list` and `closing_my_recent` keep their names, arguments and grants and gain `shift_variance` / `final_variance`. **Applied to the live project (DuaPharmaPlus) on 25 Nov 2026 and registered as `0225` (`closing_list_variance`).** Registry backup first: `supabase_migrations.schema_migrations_backup_20261125_pre_list_variance` (119 rows; 120 after). Applied by hand with `execute_sql` in one transaction. Checked live: both functions were byte-identical to the repo's previous versions before, and their `md5(pg_get_functiondef)` equals the local replay after; `anon` cannot execute, signed-in users can; closing counts unchanged (31 closings, 30 results); called as the Owner in a rolled-back transaction, all 24 saved closings returned the new keys. Rollback: put back the 0214 `closing_saved_list` and 0217 `closing_my_recent` bodies and delete registry row `0225`. Test: `supabase/tests/0225_closing_list_variance_test.sql`.
- **Fragile code fixed:** a real code error (`TypeError`) is no longer reported as "No connection" (only a network message, or the browser being offline, is); the restore-after-crash check compares times as times, not as text; a missing opening closing is never re-created as an ordinary closing from the ledger; the `online` listener of a left ledger is removed; the conflict backup is cleared once the typing is saved. `reconciliation()` moved to `domain/compute.js` (shared by the banner, Submit review and saved view).
- Tests: 19 new (`closing-records`, start-page and ledger tests). Verified locally: `npm run verify` and all database tests (migrations replayed on a local Postgres 16).

## 25 Nov — Closing workflow audit (open to submit): four fixes
- **Net Cash Available (Shift):** the Final Audit banner and the Submit review showed net cash + net sale (e.g. Target 100, Available 190, Less 10). A Shift now shows net cash, so target, cash available and Plus/Less add up (BUSINESS_RULES 14–15). Both screens use one helper, `reconciliation()` in `ui/sections-late.js`. Final mode was already right.
- **Submit review** always reads the figures again before it opens (it could show the figures from before the last autosave), says so when they cannot be read, and opens only once if Submit is tapped twice.
- **Back to days / Save as Draft** wait for a save already in flight instead of reporting a failed save or showing no confirmation.
- **After submit** the open-closing target and the conflict backup copy are cleared, so browser Back no longer lands on "Could not load this closing".
- Tests: 7 new ledger page tests (`closing-pages`) and `closing-reconcile` (fixture-driven). No database change. Verified: `npm run verify` (2,653 tests) and all 102 database test files on a local Postgres 16.

## 24 Nov — Operations Redesign, Stage 3b (Task Master screens) — migration 0703 applied live 25 Nov
- New module `tasks` (`js/modules/tasks`: manifest, `domain/`, `data/`, `ui/`). Pages: **My Tasks** (`/tasks`; overdue, urgent, due within two days, other pending, returned, awaiting verification; accept, start, hand in with a note or a tick, ask for a new deadline or another person, comments, history), **To Verify** (`/tasks/verify`; approve, or send back with a reason), **All Tasks** (`/tasks/manage`; create, assign, re-date, cancel, filter), **Requests**, **Schedules** (including Generate now) and **Team** (`/tasks/requests`, `/tasks/schedules`, `/tasks/team`). All data comes from the existing Task Master database functions; no new function was needed.
- Home: staff get **My Work Snapshot** and **My Tasks**; the Owner gets **Staff & Team**. Styles in `css/tasks.css`; `sw.js` regenerated.
- Migration `0703_ops_task_rules` (range 0700–0749): adds the category `tasks`, the rules `task_overdue` and `task_verification_waiting` (both on, no settings) and replaces `ops_action_items()` with the 0701 body plus two task checks. Test `0703_ops_task_rules_test.sql`; `0700_ops_rules_test.sql` now expects seven rules. Apply and rollback: `docs/ops/f11-stage3b-apply-and-rollback.md`. Decision D-67.
- Tests: 61 new unit tests (`tasks-domain`, `tasks-pages`, `tasks-manifest`, `home-tasks-sections`, three more in `home-ops-gating`). No attendance and no notifications (D-51, D-58).
- Verified locally: lint, format, secrets and vendor checks, the full unit suite, and every non-eBill database test against a local Postgres 16 replay. 0703 was applied by hand on 25 Nov 2026 (backup `schema_migrations_backup_20261125_pretask_rules`, 115 rows; hash matches a local replay; live Owner and Junior checks pass). Not verified: the screens on a real phone.



## 24 Nov — Workspace Sheets: formula engine (Phase 6)
- New `docs/modules/workspace.formulas.md`: the rules, written before the code (values, errors, conversions, comparison, rounding, circular references, how structure changes rewrite formulas).
- New pure code in `js/modules/workspace/domain/formulas/` (no DOM, no network, no `eval`, no `new Function`): `a1.js`, `lexer.js`, `parser.js`, `values.js`, `functions.js`, `evaluator.js`, `dependencies.js`, `engine.js` (incremental recalculation by position), `rewrite.js` (insert, delete and copy rewriting of formula text) and `sheetCalc.js` (maps a sheet's stable ids to the engine). 11 functions (`SUM AVERAGE MIN MAX COUNT COUNTA IF AND OR ROUND ABS CONCAT`), 5 error values (`#REF! #VALUE! #DIV/0! #NAME? #CIRC!`), same-sheet references and ranges, `+ - * / ^ & = <> < > <= >=`. Circular references are found from the dependency graph (so `=IF(TRUE,1,A1)` in A1 is circular), with an iterative algorithm: a chain of 50,000 formulas does not overflow the stack.
- In the app: a formula cell shows its calculated result (with the cell's number format), the bar shows the formula and "Shows: result", errors show in red, a number too wide for its column shows `####` instead of being cut short, and typing `=` stores a formula (a formula that cannot be read is refused with a plain reason and place; text that must start with `=` takes an apostrophe). Results are never stored.
- Tests (553 for formulas, in 7 files; Workspace unit tests 927 in 21 files; whole suite 3,139): `tests/fixtures/workspace-formula-cases.json` (282 cases with invented numbers and hand-checked answers), parser and lexer, value rules with property checks, engine (incremental recalculation always equals recalculating from scratch, over random sheets and edits with cycles; the report of changed cells is exact; 50,000-formula chain; 10,000 dependents), rewrite (inserting rows never changes a number; deleting rows nobody reads never changes a number; round trips), sheet adapter, and a fuzz test (60,000 hostile or damaged formulas: nothing throws, nothing is executed) with a static guard that the formula files contain no eval, dynamic code, network, DOM, storage or timers. Seventeen deliberate mutations of the code were tried: sixteen were caught, and the seventeenth showed a redundant pass in the engine, which was removed.
- Bugs found by the tests and fixed: the engine's "what changed" report named a cell twice-edited in one batch as changed and could miss a cell (found by the property test; the bookkeeping was rewritten and a redundant pass removed); text numbers, rounding and comparison rules were fixed in the brief before coding.
- Checked in a real Chromium 153 (harness, about 1,900 formulas, reference model as server): results with number formats, `#DIV/0!` red and centred, a circular pair showing `#CIRC!`, running totals, the bar, an edit that recalculated its dependents (about 110 ms to save and redraw), scrolling as before, no CSP or script errors, and no number cut short. `ROUND(SUM/COUNT,2)` over 1,499 rows (602,566) was checked against an independent calculation. The real browser also showed a number cut as "170,0…", which is now `####`.
- Not verified: a real phone, a screen reader, two real accounts, the editing of formulas against the real database. Nothing calls `rewrite.js` yet: the row and column screens (Phase 5, increment 7) must store the rewritten formula text in the same batch as the structure change.

## 24 Nov — Workspace Sheets: cell editing (Phase 5, increment 5)
- New `domain/cellInput.js` (pure): `parseCellInput`, `editState`, `buildCellEdit`. Only a plain number becomes a number (`00123`, `1e5`, `1,200` stay text); `TRUE`/`FALSE` become booleans; a leading apostrophe forces text; empty clears the content and keeps the cell's formatting; text starting with `=` is **refused for now** (formulas are Phase 6) with a message; text over 32,767 characters is refused. A cell write replaces the cell's whole state, so every edit resends the cell's existing `style_id` (leaving it out would strip the formatting).
- New `ui/cellEditor.js`: the edit bar above the grid. A draft is never dropped silently (moving to another cell, switching sheet, leaving the page or closing the tab with unsaved text is refused or asked about). The base of a save is the version the edit STARTED from, so a change by someone else that arrives while typing is still met as a conflict. A save with no answer is kept and resent with the SAME operation id and the box is locked until answered; "Discard" is explicit. A conflict shows both versions with "Use mine" or "Keep theirs"; if the row or column was deleted meanwhile the typed text is kept in a message. A viewer, an archived workbook, and cells that cannot be reproduced from typed text (formulas, numbers too large or precise) are shown but not editable.
- `ui/sheet.js` now owns the sender and wires the editor; `css/workspace.css` has the edit bar rules, including one that makes the `hidden` attribute win inside the bar.
- Tests: `workspace-cellinput.test.js` (17), `workspace-sheet-edit.test.js` (27), `workspace-sheet-ui.test.js` (35). Workspace unit tests: 362 in 14 files; whole suite and the database suite (3,870 checks) pass on the working tree before the PR.
- **Found only in a real browser (Chromium 153, throwaway harness):** the "Use mine" and "Keep theirs" buttons were visible all the time, because `.ws-edit-choice { display: flex }` overrode the `hidden` attribute. jsdom cannot show this (it applies CSS in source order and ignores specificity and `!important`), so a test now guards the rule in the stylesheet text, and removing the fix makes it fail. Re-checked in the browser: after a tap only the cell name shows; Save and Cancel appear only with unsaved text.
- Also checked in the real browser: tap a styled price cell, type 777, Enter: the cell shows `PKR 777`, the server cell keeps its style id, a formula entry is refused with nothing sent, a draft blocks moving to another cell with a clear message, and a real conflict (another person changes the cell while typing) leaves the server value untouched, shows both versions, and "Keep theirs" resolves it. No CSP or script errors.
- Not verified: a real phone (soft keyboard over the bar, tap targets, IME), a screen reader, two real accounts, the edit flow against the real database (the browser harness uses the reference model as the server; the data layer was seen working live only for creating the first sheet).

## 23 Nov — Foundation: `rls_auto_enable()` no longer executable by signed-in users (migration 0017, applied live)
- New `supabase/migrations/0017_foundation_rls_auto_enable_revoke.sql` (guarded: does nothing where the platform function does not exist, such as CI) revokes `EXECUTE` on `public.rls_auto_enable()` from `PUBLIC`, `anon` and `authenticated`. This was the one security advisor warning that was not by design. The function body is unchanged (md5 `846ec2fb…` before and after).
- Why it is safe: the earlier note said `authenticated` had to keep execute for an event-trigger reason. Re-tested on PostgreSQL 16: tables made by a role without execute, by a signed-in role, by the owner and by a superuser (including `CREATE TABLE AS`) all still get row level security. On the live project a probe table created after the change received row level security and was dropped; nothing was left behind.
- Test `supabase/tests/0017_foundation_rls_auto_enable_revoke_test.sql` (11 checks; builds a stand-in function and event trigger inside a transaction and rolls back). A mutation (migration doing nothing) is caught. Whole database suite: 3,870 checks pass.
- Applied live by hand as one batch ending with the registry row (`0017`, D-35); not through `apply_migration`. Rollback: `grant execute on function public.rls_auto_enable() to authenticated;`.
- What stays in the advisor and why: 231 warnings that signed-in users can call `SECURITY DEFINER` functions (this is how every screen reaches the database; each function checks permissions inside, and the review of them is the open item in `docs/ROADMAP.md`); 23 information notices for tables with row level security and no policy (reached only through those functions); and leaked-password protection, which is a Supabase Auth dashboard switch the owner must turn on (it needs the plan that offers it, and the username/PIN staff login should be checked with it).

## 24 Nov — Fix: Sale Report page showed no report (CSS class collision)
- Cause: `css/ebill.css` defined a bare `.sr` rule (a 1px clipped "screen reader only" box) and, loading after `sales.css`, it overrode the Sale Report container, which also uses `.sr`. The report rendered but collapsed to an invisible 1px box; Copy, Print data and Gmail still worked because they are built from the data, not the screen.
- Fix: Emergency Billing's helper is now `.eb-sr-only` (one use, the Delete column header in `ebill/ui/pos.js`). Test: `css-class-collisions.test.js` fails if any other stylesheet defines a bare `.sr`.

## 24 Nov — Closing: "Carried CC from Previous" is editable on Shift and Final closings (migrations 0223, 0224)
- On every non-opening closing, Shift or Final (new, or reopened for correction), step 8 Card shows Carried CC from Previous as a normal box. Empty = use the carried figure (shown as the placeholder); a typed value, including 0, replaces it.
- Database: `closings.ov_prev_cc` (null = carried). `closing_apply_carry` honours it in both modes (0224 lifted the Final-only limit of 0223), so open, save and the submit-time carry check no longer overwrite it. `closing_apply_payload` / `closing_patch_draft` accept `overrides.prev_cc` (left alone when the key is absent); `closing_reopen` / `closing_correct` copy it to the revision.
- Code: `domain/form.js` (override in form, payload, simple paths, `localTotals` with `carry.final`), `ui/sections-late.js`, `ui/ledger.js`, `data/api.js`. Tests: `closing-form.test.js` (now 19).
- Migrations 0223 and 0224 were applied with the Supabase connector on 24 Nov 2026 (functions rewritten from their live definitions with asserted string replacements).

## 24 Nov — Dua is installable on Android, with two long-press shortcuts (Foundation request 6)
- New `manifest.webmanifest` (name Dua, `start_url` and `scope` `./`, standalone, theme `#142b4a`, background `#f4f7fb` from `css/tokens.css`) and PNG icons made from `assets/icon.svg`: `icon-192.png`, `icon-512.png` and a maskable `icon-maskable-512.png`. Chrome on Android now offers Install, and the installed app opens in its own window.
- Long-pressing the icon offers **Counting** (`./#/audit/count`) and **Individual audit** (`./#/audit/individual`). Both are existing routes; the router still refuses a screen the person has no key for, and a signed-out person sees sign-in. iPhones ignore manifest shortcuts and only get the normal home-screen icon.
- `index.html` links the manifest and the content security policy gains `manifest-src 'self'` (nothing else in it changed). No runtime code, module, sign-in, routing or service worker logic changed.
- `tools/sw-precache.mjs` now also keeps the icons named in the manifest, so `sw.js` was regenerated (cache list 332 → 335 files). Test: `tests/unit/pwa-manifest.test.js` (9).
- Not verified: install and the shortcuts on a real Android phone.

## 23 Nov — Operations Redesign, Stage 3a (Task Master database layer)
- New migrations `1200_task_core`, `1201_task_lifecycle`, `1202_task_schedules`, `1203_task_reads` (applied live and registered on 24 Nov 2026: `docs/ops/f10-stage3a-apply-and-rollback.md`). Design and rules: `docs/DECISIONS.md` D-65.
- New security guard `1299_task_exposure_test.sql`. `0001_core_test` now expects a Junior to hold 6 permissions (adds `tasks.view_own`).
- No screens yet: My Tasks, the Owner's Tasks page, verification and the dashboard sections come in Stage 3b.

## 24 Nov — Sales Add Entry: auto-pull from the evening closing and Candela
- Opening Add Entry on a day with no record now fills itself, and a **Pull / Pull again** card does it on request (also on a saved day, where it overwrites only the fields it fills). It never saves: the person checks the numbers and presses Save.
- Mapping (checked on 23 Nov 2026): Cash Sale = the evening closing's System Cash Sales Total (207,202); Bank Alfalah = its Bank Alfalah machine (46,451); Bank Alfalah 2 = its Keenu machine (116,020); Cash Returns = Cash Sale − Candela cash rounded to the rupee (207,202 − 178,128 = 29,074); COMP SALE = Candela's total rounded (445,410); each credit client = Candela's credit for that customer (Askari 7,360.32, PARCO 4,048.14). Known full names are spelled out in `ALIASES` in `autofill.js` (LDA = Lahore Development Authority, PSO = Pakistan State Oil). A Candela customer with no matching field is listed with its amount, never guessed; nothing is created in Manage Fields.
- Sources are two new read-only published interfaces (docs/MODULES.md §8.1), so Sales still reads no other module's tables: `closing_day_feed` (migration `0222_closing_day_feed`, same read gate as the saved-closings list) and `candela_day_feed` (migration `0901_candela_day_feed`, `candela.view` only). Each source is asked separately: a person who may read only one gets that one, with a note about the other; a person who may read neither sees no card. No permission was widened.
- Code: `js/modules/sales/domain/autofill.js` (pure), `data/api.js` (`autofillSources`), `ui/entry.js`. Tests: `sales-autofill.test.js` (24), `sales-entry-autofill.test.js` (11), database tests `0222_closing_day_feed_test.sql` and `0901_candela_day_feed_test.sql`; the whole database suite passes on PostgreSQL 16. `sw.js` regenerated.
- **Migrations 0222 and 0901 were applied by hand on 24 Nov 2026** (RUNBOOK §4: the file's SQL plus its registry row in one batch, not `apply_migration`) and registered as `0222` and `0901`. Checked afterwards: both functions are `security definer` with `search_path=public`, `anon` and `public` cannot execute them, `authenticated` can; the live function bodies hash identically to the repo files (`closing_day_feed` 49ae45d4…, `candela_day_feed` e21bdb48…); the same queries on live data return the 23 Nov figures (207,202 / 46,451 / 116,020; Candela 178,128.42 / 445,409.81; Askari 7,360.32, PARCO 4,048.14); registry 113 rows, none with a timestamp version. The security advisor shows nothing new (both functions appear only in the generic signed-in-can-execute-SECURITY-DEFINER notice that covers every RPC).
- Not verified: a real phone, and the live data (names of the live credit customers against the live field labels).

## 22 Nov — Operations Redesign, Stage 2b (Business Intelligence, Staff sections, realtime)
- Owner Home: Business Intelligence for 7, 30 or 90 days with fair comparison; closings refresh the lists in real time.
- Staff Home: My Payroll (own closed payslips, read only, per-person permission `payroll.view_own`) and My Recent Activity.
- New migrations `0220_closing_ops_period`, `0702_ops_bi_summary`, `0109_mgmt_my_payslips` (applied live and registered on 23 Nov 2026: `docs/ops/f9-stage2b-apply-and-rollback.md`). New security guard `0749_ops_exposure_test.sql`; `0199` lists `mgmt_my_payslips`. `payroll.view_own` is granted person by person only..

## 22 Nov — Workspace Sheets: migration 1111 applied live
- Applied `1111_workspace_style_validator_fix` to the live project by hand as one `execute_sql` batch (not `apply_migration`, D-35), on the owner's instruction, and registered it as version `1111` in the same batch. Before: registry held `1100`, `1101`, `1102`, `1110`; no sheet, cell or style rows existed.
- Verified live: function body hash equals the repo file (`22dd6078…`); `search_path` pinned to `public`; `anon` and `authenticated` cannot execute it; `size "big"`, `size 8.5`, `weight null`, `numfmt.decimals 2.5`, a null border side and sizes 7 and 73 are refused; a full valid style, `{}` and `numfmt: {}` (type optional) still pass. Only the changed function and the registry were touched; the live Workspace data (2 notes) was not.
- Not re-run live: the database test files (they need a clean PostgreSQL; they passed on PostgreSQL 16 before).

## 23 Nov — Workspace Sheets: read-only grid and New workbook (Phase 5, increment 4; merged as PR #77)
- New route `/workspace/sheet` (`ui/sheet.js`): opens the workbook home chose, shows title, role, sheet tabs, a bar with the content of the selected cell, the grid, and Refresh (pulls what changed; opens again after a restore; also refreshes quietly when the person returns after a minute). A failed refresh never blanks the grid. A workbook with no sheet offers "Add a sheet" to owners and editors (the only write on this screen).
- New grid (`ui/gridView.js` with pure logic in `domain/grid.js`): draws only the rows and columns on screen (a 3,100-row sheet is about 170 cells in the page), native scrolling, frozen rows and columns, A/B/C and 1/2/3 headers, stored row heights and column widths, number formats (number, currency, percent, date), bold, size, colours, alignment and borders, tap or arrow keys to select. Cell text is always set as text. Styles go through `sanitizeStyle` and the DOM style API (the page's policy refuses inline style attributes). The grid always draws on a light sheet so an author's colours are readable in dark mode.
- Home: **New workbook** is enabled (for people with `workspace.create`); workbooks open in the grid. Route registered in `manifest.js`; `sw.js` regenerated (5 files).
- Tests: `workspace-grid.test.js` (19) and `workspace-sheet-ui.test.js` (35); whole suite 2,223 tests (318 Workspace in twelve files). Mutations of the code were each caught. Found by them: numbers over 12 digits were rounded (a barcode lost digits; now exact), and a failed "Add a sheet" message was wiped by the refresh that followed. Found only in a real browser (Chromium, throwaway harness outside the repo): the role pill was white on white, and scrolled column and row headers painted over the frozen ones.
- Not done: editing, formulas (shown as text), copy and paste, resize, accessibility beyond ARIA grid attributes and arrow keys, offline. Not verified: a real phone (grid scrolling, touch feel, iOS Safari), a screen reader. No migration; the live project was not touched.
- Live evidence (23 Nov, read-only look at the database): after the merge two workbooks were created with New workbook (14:04 and 18:46 UTC); each has one sheet and one `add_sheet` operation applied at version 1, so the data layer's sender and `workspace_apply_ops` worked from the real app. Whether the grid was tried on a real phone is not recorded.
- Known at the time, not Workspace: `tests/unit/cover.test.js` failed on `main` itself and `main`'s CI was red before this PR. Since fixed by commit `b60b3ec` (23 Nov 2026); CI on `main` is green again.

## 22 Nov — Workspace Sheets: data layer (Phase 5, increment 3; merged as PR #70 on 23 Nov)
- New `js/modules/workspace/data/workbooks.js`: open a workbook and build the local copy (`openWorkbookFull`: styles and cells page by page, then pull from the `head_version` it opened at so edits made while paging are not missed); `pullAndApply`; `createOperationSender` (batches of at most 200 operations / 3 MB; a batch that was not answered is kept and sent again with the SAME operation ids and content, D-45; a batch the server refuses is held, never dropped; `drain` waits 2 s to 60 s between failures); restore points (`createSnapshot`, `listSnapshots`, `restoreSnapshot`, owner only in the database). Operations are checked before sending (ids in integer range, envelope, size). Every call goes through `data/api.js`; eight new friendly messages added there.
- Tests: `tests/unit/workspace-workbooks.test.js` (41 tests) run the data layer against the JS reference model acting as the server. Five deliberate mutations were each caught. Whole suite 2,043 tests, lint, prettier, secrets, vendor checks and the whole database suite (3,643 checks) pass. No migration written or applied; the live project was only read. Not imported by any screen yet, so `sw.js` was not regenerated. Still no Sheets screens.
- Live read-only check before and after: registry 1100, 1101, 1102, 1110, 1111; all 51 `workspace_*` functions have a pinned `search_path`, none is callable by `anon`, internal helpers are not callable by signed-in users. Advisor: nothing new from Workspace (`workspace_save_keys` and `workspace_sheet_revisions` have row level security and no policy on purpose, reached only through functions); known and not Workspace: `rls_auto_enable()` executable by signed-in users, leaked-password protection off.

## 22 Nov — Operations Redesign, Stage 2a (Owner Action Centre and Recent Activity)
- New migrations `0219_closing_ops_feed`, `0700_ops_rules`, `0701_ops_action_items` (applied live and registered on 22 Nov 2026; procedure, verification and rollback in `docs/ops/f8-stage2-apply-and-rollback.md`).
- Home shows an Action Centre and Recent Activity to the Owner only; new shared refresh service with last-updated time and stale-data warning.
- Decisions D-56 to D-60 recorded (schedules, no evidence storage, in-app notifications, Groq free plan, activity defaults and deposit figure).

## 21 Nov — Operations Redesign, Stage 1 (audit and plan)
- Added `docs/OPERATIONS_REDESIGN_PLAN.md`: audit of the current app, gap analysis against the redesign brief, architecture decisions, Task Master / notifications / AI design, eleven owner decisions, stage-by-stage acceptance. Nothing in the redesign is built yet.
- Added migration `0015_core_trigger_search_path` (pins `search_path` on `set_updated_at` and `activity_log_immutable`, removes their PUBLIC execute right) with test `0015_core_trigger_search_path_test.sql`. Applied live and registered as `0015`.
- Added `tools/check-registry.mjs` (compares migration files with a read-only registry export) and `docs/ops/f7-registry-reconciliation.md` (guarded, reversible procedure for the 12 timestamp-versioned rows). Executed live: 13 rows renamed (incl. `0218`), 0 timestamp versions remain.

## 22 Nov — Workspace Sheets: browser reference model and database parity test (merged to main, PR #66)
- New `js/modules/workspace/domain/spreadsheet.js`: a pure model of the `1102` rules (apply operation batches with the same answers, conflicts, duplicates, log and pull, restore points, a local copy that follows pulled operations, A1 labels, cell input parsing, operation builders).
- New shared fixture `tests/fixtures/workspace-sheet-cases.json` (10 operation sequences) and tool `tools/workspace-sheet-cases.mjs`, which generates `supabase/tests/1102_workspace_sheet_parity_test.sql` (85 checks). Verified on PostgreSQL 16: the database and the model answer identically.
- Finding and fix: the `1102` style validator accepted some malformed styles (for example `size: "big"`). New migration `1111_workspace_style_validator_fix` (with a 20-check database test) refuses them; written on the owner's instruction and now recorded as live migration `1111` (verified in the 22 Nov live registry). No workbook/grid screen exists yet; future UI must use the existing style sanitization rules.
- Tests: 47 new unit tests; whole database suite passes. The live registry now includes `1111`; treat this migration as applied live. The audit query confirmed its registry row; do not reapply it. The reference model and fixtures/tests are merged to main; still no Sheets screens.

## 22 Nov — Migration registry: all versions four-digit; `0412` reconciled
- Read-only check of `supabase_migrations.schema_migrations`: 93 rows, all four-digit; 92 migration files on `main` plus live-only `0015`. The 12 timestamp rows reported by the 21 Nov audit were already numbered.
- Backup `supabase_migrations.schema_migrations_backup_20261122` (92 rows), then the guarded rename `20261122035159` → `0412` (exactly one row or nothing). Afterwards 93 rows, 0 timestamp rows. The 0015 source remains only on `ops-redesign-stage1`; add it to main without reapplying.
- Open: `0015_core_trigger_search_path` is registered live but its file exists only on the unmerged branch `ops-redesign-stage1`. The old backup `..._20261112` was dropped on 22 Nov 2026 at the owner's request; backups `..._20261121` (91 rows, origin not documented) and `..._20261122` (92 rows) remain and can be dropped after review.
- The earlier "13 timestamp rows / 90 files" wording in the entry below and in several docs was wrong and is corrected here.

## 22 Nov — Audit: Individual Audit compiles itself on submit (migration 0412, applied live)
- Migration `0412_audit_individual_autocompile.sql`: an Individual Audit round is compiled in the same transaction as the person's submit, so they can start the next one without waiting for the main auditor. New internal `audit_compile_round_core` (not callable by users); `audit_compile_round` still needs `audit.compile` and still compiles normal rounds by hand.
- No cross-round conflicts are raised in the individual engagement (owner decision AUD-14). `audit_reopen` refuses with `self_pick_open` when the person already has another open Individual Audit. No `audit.compiled` owner alert for individual rounds; the `audit.submitted` alert still fires.
- Screen: after submit the counting screen shows "Your result" (items, differences, value) and **Start another audit**.
- Applied to live DuaPharmaPlus with the Supabase `apply_migration` tool, which registered it as `20261122035159` (the RUNBOOK says to apply by hand under the repo number). The SQL is verified identical to the tested copy (function body hashes, D-47). The row was renamed to `0412` the same day (see the registry entry above).
- Tests: new `0412_audit_individual_autocompile_test.sql` (16 checks); full database suite and `npm run verify` (125 files / 1,933 unit tests) pass. Phone check (PHONE 4) pending.
- Documents updated: Audit brief (R8, AUD-14), progress, handover and phone tests; Audit 2.0 note; USER_GUIDE (new Audit section), ADMIN_GUIDE, BUSINESS_RULES, DECISIONS (D-50), SECURITY_MODEL, RUNBOOK, TESTING, ROADMAP, PROJECT_STATUS, MODULE_PROGRESS_REGISTER, README, PROJECT_PROGRESS.

## 21 Nov — Closing: Owner-only Shift ↔ Final change (PR #60, applied live)
- Migration `0218_closing_mode_change.sql`: `closing_change_mode`, `closing_is_admin_owner`, trigger `closings_mode_guard`. Only an admin at MFA level 2 may change a closing's type; the database refuses every other route, including the ordinary draft save.
- Draft: changes in place, figures and rows kept. Submitted: reopened through the existing `closing_reopen` as a new revision carrying the new type; original kept until the revision is submitted; resubmitted with the ordinary `closing_submit`. CLS-6 and CLS-7 hold. Audit: `closing.mode_changed` in the activity log.
- Screens: Review "Change to Final/Shift", ledger "Type" button (Owner only); other devices follow the change.
- Applied to live DuaPharmaPlus the same day (registry version `20261121182327`); no closing data changed. Owner try-out pending.
- Tests: new `0218_closing_mode_change_test.sql` (all database tests pass), `closing-mode-change.test.js` (18 tests).

## 21 Nov — Full module, CI and live Supabase audit
- Audited main commit `96694979e65242f5ee24eb86f215630686b552c8`: 13 registered modules, 707 repository files, 121 front-end test files / 1,891 recorded unit tests, 77 database test files and 89 migration files.
- Verified GitHub Actions CI run #401 (app, database, functions) and Pages deployment #226 succeeded on the same commit.
- Queried live DuaPharmaPlus: ACTIVE_HEALTHY on PostgreSQL 17.11; 124 public tables all with RLS; 337 public routines; six active Edge Functions, Inventory sync v24.
- Found 12 migrations whose repo four-digit versions are recorded in the live registry under timestamp versions. Corrected the stale claim that Closing 0214 was missing: it exists in both repository and live registry.
- Updated the master register, project status, roadmap, testing, architecture/security/database/runbook references and module progress/handover documents. Added `docs/PROJECT_AUDIT_2026-11-21.md`.
- Added missing Access and Tools module briefs; refreshed the owner guide with all 70 live permission keys and the current state of all 13 modules.
- Remaining work is acceptance, migration-registry reconciliation, security-advisor review, real backup restore, Workspace Sheets UI and operational hardening; see the audit and roadmap.

## 21 Nov — Workspace Sheets database applied live; documents brought up to date
- Migration `1102_workspace_sheets` is applied to the live project and registered as version `1102`. Checked live: 5 Sheets tables with row level security, 15 functions with pinned `search_path`, internal functions not callable by `anon` or `authenticated`, `1100`, `1101`, `1102` and `1110` all registered.
- Workspace Notes accepted by the owner after live testing. The Sheets screens are **not built** yet (domain model, data layer, grid, "New workbook").
- Supabase advisor (live): 14 tables with row level security and no policy (service-role-only by design), 2 unpinned `search_path` functions outside Workspace (`set_updated_at`, `activity_log_immutable`), signed-in-callable SECURITY DEFINER functions (by design, each checks the caller), leaked-password protection off.
- Documentation updated: README, PROJECT_STATUS, MODULE_PROGRESS_REGISTER, ROADMAP, DATABASE_DESIGN, CHANGELOG and the Workspace brief, progress and handover.

## 21 Nov — Branch cleanup and Workspace Sheets database merged
- Reviewed every branch against `main`. 18 were already fully merged and 8 more contributed nothing on trial merge (work already in `main`); all deleted. `module/workspace-sheets` held new work and was merged: migration `1102_workspace_sheets` (sheets, cells, styles, operation log, snapshots, apply/restore) with its 203-check database test. **Not yet applied to the live project.**
- `main` is now the only branch. Verified after merge: 1,891 unit tests (121 files), lint, Prettier, secret and vendor checks pass.
- Documentation updated: branch audit, project status, roadmap, sessions, testing, Workspace handover.

## 21 Nov — Workspace review and search_path follow-up
- Reviewed Workspace (Notes) against the live project: tables, security, permissions and tests match the docs.
- New migration `1110_workspace_guard_search_path` pins `search_path` on the four trigger-guard functions (Supabase advisor warning). No behaviour change; new database test and two tightened checks. Applied to the live project by hand and registered as `1110`.

## 21 Nov — Manager sheets as tables
- Staff Credit, Salary and Generic Sheet are now numbered tables with gridlines, a header row and a TOTALS row, like the old app. Salary and Generic keep the same typing, saving and live totals; Staff Credit opens a person's entries and forms under their row.
- On a phone the table scrolls sideways and the Name column stays in view. Incentive is unchanged.

## 21 Nov — Staff logins created from the Staff Registry (4-digit PIN)
- Owner creates a login from a registry person (username, Junior/Senior, 4-digit PIN); linked to the existing staff row, so no duplicates. Weak PINs refused. Set PIN and Unlock in Users & Access; registry shows who has no login.
- Lockout is now 5 wrong PINs for 1 hour. Older 6-digit PINs keep working until reset.
- Removed self sign-up: `request-access`, `claim-account`, access requests screen, setup codes (tables kept as history).
- Database: `0014_staff_logins_pin4` (one login per person; `access_locked_usernames()`). New server secret `PIN_PEPPER`.

## 21 Nov — Emergency Billing: full-screen audit and fix
- Bug fixed: in full screen the billing key handler swallowed Escape before any popup saw it, so Escape could not close Product Help (F5), held bills, Search receipt or the PIN question.
- Full screen now stays until the cashier presses Exit full screen. If the browser ends it (Esc in Firefox/Safari, a long Esc press, a print window) the full layout stays, an open popup is closed, and real full screen returns on the next click or key press. Removed screens ignore full-screen events.
- Tests: 8 full-screen tests (suite: 1,891 unit tests, all database tests pass) (replacing one that encoded the bug); checked in real Firefox.

## 21 Nov — Emergency Billing: Phase 5 complete and Phase 6 testing
- **Phase 5 (merged 20 Nov, PR #45):** partial-refund dialog (item and quantity, amount preview, retry-safe); receipts in the shop's own slip layout (Primary, Gift, Summary, Secondary; 58/80 mm; Duplicate on reprints and extra copies; offline bills carry a temporary-reference note) with live Print/Copies/Type controls, Search receipt, History reprint and offline printing; Settings > Receipt form with live preview, test slip and logo; reports and CSV/Excel/PDF exports with a pending/failed-invoice warning (files named `-INCOMPLETE`).
- **Database:** migrations `0633`, `0634`, `0640`, `0641` (20 Nov) and `0642` (receipt slip fields STN/NTN, POS number, slip title, footer to 400 characters) applied live by hand with the owner's approval and registered; read-only safety checks passed (no anon/public execute, helpers internal, RLS on).
- **Phase 6 (this entry):** new database test `0650` (300 random invoices, 1,054 random partial refunds add up to net to the paisa); preview-vs-database cross-check of 1,963 refunds found and fixed a 0.01 rounding difference (exact fractions now); large-data tests (30,000 products, 300-line bill, 5,000-invoice report); real Firefox print-engine check of the slips at 58 and 80 mm (found and fixed a pale background behind the slip); screenshot fixes (report totals, print controls spacing). Fixed the billing cash box not clearing when cash entry is switched off, and `css/ebill.css` Prettier.
- Tests: 1,874 unit tests in 120 files; 75 database test files (3,226 checks) pass.
- Remaining (owner): grant `ebill.*` rights (none granted live), fill in Settings > Receipt, real-device and real-printer checklist: `docs/modules/ebill-phase6.md`.

## 19 Nov — Workspace Phase 4: Notes editor, sharing and history
- Workspace Notes are now a registered module (`/workspace`, `/workspace/note`): home with search (titles and note text), Mine / Shared / Archived / Trash tabs and personal folders; rich-text editor (headings, bold, italic, underline, bulleted/numbered/checklists, links, undo/redo); autosave with same-operation-id retry; conflict banner (keep mine / use latest / copy mine); sharing dialog (owner/editor/viewer, transfer ownership, hide history from viewers); history with preview and owner-only restore; archive and delete.
- Vendored ProseMirror bundle (`vendor/workspace/`, nine MIT packages pinned at least 14 days old, reproducible esbuild recipe, licences, SHA-256 in `tools/check-vendor.mjs`). The editor schema is proved equal to the note validators by running the shared cases through the real library.
- `sw.js` file list regenerated (adds Workspace files and two stylesheets `main` had missed).
- Database: no new migration. Live registry: `1100` and `1101` applied by hand on 18 Nov 2026; function bodies verified identical to the tested copy.
- Tests: 176 Workspace unit tests; full suite after merging `main` 1,669 unit tests (one pre-existing failure in `ebill-page.test.js`, fixed 21 Nov), 71 database test files pass.
- Known: the router carries no ids, so the open note id lives in session storage (no deep links); `css/ebill.css` failed Prettier on `main` itself (fixed 21 Nov).
- Handover for the next session: `docs/modules/workspace.next-session.md`; remaining design: `docs/modules/workspace.design.md`.

## 19 Nov — Documentation reconciliation
- Added `docs/MODULE_PROGRESS_REGISTER.md` as the consolidated source for registered modules, backend-only work, live-status evidence, outstanding acceptance and all branch comparisons.
- Corrected stale status in README, canonical project status, roadmap, testing guide, shared module contract and module briefs/progress handovers: Manager 0108, Closing through 0211 (with 0214 live/source drift flagged), STR, Audit C1, Emergency Billing Phase 5, Invoice Desk integration and Workspace Phase 3 backend-only state.
- Reconciled the branch list: nine non-main refs are all 0 commits ahead of `main`; no branch should be merged again. Branch deletion was not performed.
- No application source, migrations, Supabase data, secrets or runtime configuration were changed.

## 4–5 Nov — Plan, rules and design
- Owner's fresh-build plan received; decisions confirmed (GitHub Pages, free Supabase, Candela stays the source of truth, midnight business day, username + PIN for staff).
- **Phase 0:** business rules read from the old code and written down (`BUSINESS_RULES.md`): closing calculation, sales TOTAL/DIFF, carry-forward, Final Closing, STR/audit rules, emergency billing.
- **Phase 1:** architecture, database design, security model, 22 decisions.

## 5 Nov — Phase 2: foundation (accepted by the owner)
- Database: people, roles, permissions (per-person allow/deny), settings with history, append-only activity log; admin MFA enforced in the database.
- Four Edge Functions: staff login with lockout, access requests, one-time setup codes, admin actions.
- App shell, router, module registry, sign-in / request / set-PIN / MFA screens, Users & Access page.
- CI (lint, tests, database tests, function checks); secret scan; vendored Supabase client.
- Live on the owner's new Supabase project; owner tested request → approve → PIN → sign-in → lockout.

## 5 Nov — Sales history
- Old backup studied: 2,379 days + 80 months. The old TOTAL formula reproduced 2,268 days; 110 old days held negative client values that the old app had stored as reductions; 30 days typed as April 2021 were April 2022; one day (25 Sep 2026) had a stale total. Owner decisions applied.
- One-time, token-protected import function; verified; removed.

## 5–6 Nov — Sales, first pages
Add Entry (live total, corrections with reason, safe retries), Daily Data, Index, Diff Report, Cash to Deposit (with 72 mm receipt), Last Day for staff; payment-method table; revisions; page-level permissions and sub-menus.

## 6 Nov — Daily Check List and design
Daily Check List (the owner's priority): all 19 sections and defaults carried over exactly from the old code, autosave, offline copy, conflict check, live stock figures, progress, Preview / Copy / Print / Email, shared dropdown lists. Design refresh: original fonts and logo, status bar, header, tab navigation, teal hero banners. Fixed: pages sharing one event container.

## 7 Nov — Sale Report, Cover, Dashboard, Gmail
- **Sale Report** with Customize Rows (saved per person), Till/Patty, print, copy; Monthly Target card (targets and preferences tables).
- **Cover (home):** greeting, key numbers, Needs attention, tiles per permission.
- **Dashboard:** 11 KPI cards (like-for-like comparisons), insights, Race the forecast, five charts with ranges/compare/year filter, summary table, top 10 days, weekday averages, best/worst months, year calendar. Summary views keep the phone's downloads small.
- **Send via Gmail** for the Sale Report and Daily Check List (send-only permission; recipients remembered).

## 10 Nov — Completing Sales, and documentation
- **Reports:** monthly report and Sale Book (year / all time), landscape print and Save as PDF.
- **Manage Fields, Targets page**, Add Entry opens on the next unrecorded day with a recent-entries list, Index shows target progress.
- Security: unsent drafts are cleared at sign-out.
- Merged with the other session's inventory-feed work; migration numbering and registry problem found, documented and worked around.
- This documentation set.

## Totals at 10 Nov
10 migrations · 33 tables / 6 views / 25 functions · 29 permissions · 5 Edge Functions · ~5,600 lines of JavaScript · 242 front-end tests · 195 database checks.


## 13 Nov — Foundation close-out and current status reconciliation

- Daily encrypted database backup workflow is live; first successful Google Drive backup was recorded on 13 Nov. Owner notifications, retry handling, backup self-diagnosis and the Tools status view are implemented.
- `public.rls_auto_enable()` execute was revoked from `PUBLIC` and `anon`; automatic RLS behaviour was checked. The remaining `authenticated` execute grant is documented as a platform/event-trigger limitation to review if the advisor continues to flag it.
- CI now lints workflow files with actionlint. The latest main project progress entry reports 357 unit/jsdom tests and a full database suite including Closing, Manager and Inventory.
- Manager migrations 0101–0103 are recorded as applied and checked live. Closing has a partial guided ledger UI; its remaining sections and submit/ledger workflows are still pending.
- Inventory's enhanced delta-feed migrations 0301–0304 and Edge Function v14 were applied and verified live on 12 Nov (their source reached `main` with the rest of the module; see the 17 Nov entry below).
- Local backup restore test passed 39/39 checks. A restore from a real Drive backup into a separate Supabase project remains outstanding.

## 17 Nov — Inventory complete
- Migrations 0301–0307 and Edge Function v23 are live, registered and on `main`. All six screens are built: Overview, Stock Ledger, Reorder, Excess Working, Health, Sync.
- `0307` ended the hourly "statement timeout" failures: the sync file now goes to the database as one whole request body instead of a named argument that PostgREST re-parsed (mean 4.8 s of the 8 s limit). Applied by hand and registered. The cron stays at minute 0.
- Home shows a Stock row (stock value, to reorder, not selling, excess) to people with `inventory.view`.
- Stock Ledger, Reorder and Excess Working export to Excel (a small writer, no library, values only), PDF (the browser print dialog, landscape) and CSV.
- Details and evidence: `docs/modules/inventory.progress.md`.

## 18 Nov — Branch consolidation, Audit, Emergency Billing, Workspace
- Merged into `main`: `feat/closing-staff-mobile-ux` (PR #32; its changes already matched `main`), `module/audit-a5` (A5, B1, `0408` fresh stock, Inventory `0308`), and `module/workspace` (brief, `1100_workspace_core.sql` and test; the Home page conflict was resolved in favour of `main` because the workspace change there was formatting only).
- Prettier applied to six Home/shell files that `main` had left unformatted, so the CI format check passes. `npm test` still shows 15 failures (cover, service-worker, shell), identical on `main` before this merge; recorded in `docs/PROJECT_STATUS.md`.
- Branches reduced to `main` plus three: `module/audit-a5`, `feature/backup-emergency-pos`, `module/workspace`. All others were deleted: 12 were fully merged; three held superseded, unmerged work (the 11 Nov session plan, an early inventory-sync design, and the first inventory-feed branch) and are kept as tags `archive/docs-session-plans`, `archive/design-inventory-delta-sync` and `archive/foundation-inventory-feed` (restore with `git checkout -b <name> <tag>`).
- Documents updated: PROJECT_STATUS, SESSIONS, ROADMAP, CHANGELOG, and the Audit, Emergency Billing and Workspace module files.

## Current status pointer

The dated entries above are historical. For the current module-by-module distinction between integrated, live, in-progress and pending, see [PROJECT_STATUS.md](PROJECT_STATUS.md). Do not use the 10 Nov totals as current totals.
