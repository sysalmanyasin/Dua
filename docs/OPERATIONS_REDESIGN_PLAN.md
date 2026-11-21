# Operations Redesign — audit, gap analysis and implementation plan

Status: **Stage 1 (audit and plan), 21 Nov 2026; owner decisions D1, D2, D3, D5 and D6 recorded the same day (see §8 and `docs/DECISIONS.md` D-50 to D-54).** Nothing in this plan is built yet except the two hygiene fixes in §9.
Source brief: "DUA — Complete Operations Redesign & Implementation". Where the brief leaves a policy open, this plan lists it in §8 as a **decision for the owner** and does not assume an answer.

## 1. Method and limits
Read: the repository at the latest `main` (clone of 21 Nov 2026), `js/core`, `js/shared`, the Home, Access, Tools and Manager module files, `supabase/migrations/0001`, `0007`, `0012`, `0405`, `1110`, the Edge Function list, the test runner, `docs/ARCHITECTURE.md`, `docs/MODULES.md`, `docs/PROJECT_AUDIT_2026-11-21.md`, `docs/modules/home.progress.md` and the registry notes in `docs/ops/`.
Run: the front-end suite (124 files, 1,915 tests, all passing) and the database suites for migrations below `0600` (see §9 for what could not run).
Not done: no live Supabase access, no live-app walkthrough, no line-by-line review of the 337 database routines, no real-phone test. Live counts below (tables, routines, permissions) are quoted from the 21 Nov audit and must be re-read before any migration.

## 2. What the app is today
- Static site (plain HTML + ES modules, no build step) on GitHub Pages, one Supabase project `DuaPharmaPlus`, six Edge Functions (`staff-login`, `claim-account`, `admin-users`, `request-access`, `notify-ntfy`, `sync-inventory-from-dropbox`).
- 13 registered modules, each with `manifest.js`, `domain/` (pure), `data/` (the only Supabase calls) and `ui/`. A module never reads another module's tables; Home and the status bar ask through manifests. Pages are filtered by permission in `resolveModules()`; the database refuses data regardless.
- Identity: `staff` (person) ← `profiles` (login, `role_template` of `admin`, `senior` or `junior`, `disabled_at`, `expires_at`). The owner is an `admin` and must be at MFA level `aal2` to hold any permission. Staff log in with a username and 4-digit PIN through `staff-login`.
- Permissions: `has_perm(key)` checks template grants (`role_permissions`) plus per-user `grant` or `deny` (`user_permissions`). `my_context()` returns the signed-in person's permission list and the disabled-module list to the browser. 70 permission keys are registered.
- Audit: `activity_log` is append-only (a trigger refuses update and delete); `log_activity()` is internal. Settings changes are versioned (`settings`, `settings_history`).
- Notifications: owner only. `notify_owner(kind, payload)` writes a `notifications` row and never raises; `notify-ntfy` delivers by push with retries; payloads carry ids and dates, never amounts or names. Read through `notifications.view`, shown on Home as "Needs attention".
- Home today: greeting, all-time sales hero (`v_monthly_full`, `sales.view_history`), `cover_summary()` snapshot, `inventory_cover_summary()` (needs `inventory.view`), daily progress, attention links, per-device favourites. It deliberately has **no** activity feed or branch status, because no permission-safe data feed exists.
- Refresh today: status bar polls each module's `status.refreshMs` while visible and on `visibilitychange`; Closing uses one Supabase realtime channel on `closings`. No shared realtime or stale-data service.
- Offline: a shared IndexedDB queue and sign-out guard (`js/shared/outbox.js`) used by Audit and others; the service worker precaches the shell.
- Tests: 1,915 front-end tests, 77 database test files (applied to a clean Postgres by `supabase/tests/run.sh`), lint, format, secret and vendor-hash checks, CI jobs `app`, `database`, `functions`.

## 3. Gap analysis against the brief
Legend: **Have** = exists and is reusable; **Partial** = something exists but not to the brief; **Missing** = nothing exists.

| Brief item | State | What exists | What is needed |
|---|---|---|---|
| Role-aware Home (Owner / Staff; Manager is the Owner) | Partial | One Home with permission-filtered blocks | A shared dashboard shell with Owner and Staff sections; one aggregated, permission-checked read layer |
| Business Snapshot: sales, transactions | Have | `cover_summary()`, sales views | Comparison and trend fields; confirm transaction count source |
| Snapshot: stock alerts | Have | `inventory_cover_summary()` | Reuse as is |
| Snapshot: closing status | Partial | Closing tables and status in the Closing module | A read RPC that reports today's closing state without opening Closing data |
| Snapshot: cash position | Partial | Manager ledgers (authority, D-53), Closing deposits, Sales "Cash to Deposit" | An Owner-only read RPC over the Manager ledgers; a rule that flags a day whose bank deposit does not match its cash sale |
| Snapshot: pending tasks, critical alerts | Missing | Owner "Needs attention" covers notification failures only | Task Master (§5) and a business-rules table for alerts |
| Snapshot / Team: staff attendance | Deferred (D-50) | Waits for the Android app | Nothing now. Attendance tiles and sections are not shown, and no figure is invented. Slots stay reserved in the layout |
| Action Centre | Missing | Individual module warnings | A read-only aggregator that lists issues with a deep link to the owning module; an issue closes only when its source condition clears |
| Critical alerts by configurable rules, not AI | Missing | `settings` table with versioned history | A rules table (rule, threshold, severity, enabled, owner) evaluated in the database; AI may explain but never edit severity |
| Staff & Team Overview, completion rate | Missing | `staff`, `mgmt_staff_details` (owner only) | Task and attendance data; a defined completion-rate rule (§5.4) |
| Business Intelligence (7/30/90 days) | Partial | Sales Dashboard charts, views | Period-parameterised read RPCs reusing existing sales and inventory views; detail stays in Reports |
| Recent Activity (latest 10, configured categories) | Missing | `activity_log` (append-only, restricted read via `activity.view`) | A permission-checked feed RPC with category mapping; owner-configured categories stored in `settings`; never writes to the log |
| Manager dashboard | Not needed | Manager is the Owner (D-51) | None: the Owner dashboard is the management dashboard. Staff get a "To verify" list if the owner has named them as verifiers (D-52) |
| Staff dashboard, personal payroll | Partial | Salary data exists in `mgmt_salary_*`, owner only | A per-person, read-only RPC returning only the caller's own payslip |
| Task Master | **Missing** | Nothing (Audit has assignments; Workspace has notes; neither is a task system) | Whole module (§5) |
| Notifications and reminders for staff | Missing | Owner-only table and sender | Per-recipient rows, delivery and acknowledgement history, reminder policies, in-app inbox (§6) |
| Announcements with acknowledgement | Missing | `notifications.acked_at` is single-recipient | Recipient table |
| Dua AI Assistant | Missing | Roadmap range `0800–0899` reserved | Server-side tool registry, confirmation model, session-only memory (§7) |
| Unified Reports | Missing | Per-module reports (Sales, Inventory, Audit, Closing, eBill) | Registry of report definitions reading each module's authoritative views |
| Refresh and stale-data UX | Partial | Polling, visibility refresh, one realtime channel | One shared refresh service: realtime for important events, polling otherwise, last-updated time, stale warning |
| Preserve MFA, RLS, secure RPCs, backups | Have | All present and tested | Every new table gets RLS on, no `anon` grants, tests in the same change |
| Staging separate from production | Missing | One project | Create before Task Master migrations (§8) |

## 4. Architecture decisions
1. **No framework change.** Keep plain ES modules and no build step. New code follows the existing `manifest / domain / data / ui` split.
2. **Dashboard is a shell plus sections, not a module that reads other modules' tables.** Each module contributes a small, permission-checked read function ("snapshot provider") through its `data/` layer and declares it in its manifest. Home asks the registry for providers the person may use. This keeps the rule that a module never reads another module's tables.
3. **Databases stay authoritative.** Every figure on the dashboard comes from an existing module RPC or view. No dashboard figure is recomputed in the browser, so Home cannot disagree with the module.
4. **Shared services** (the brief's list) are introduced only where there is a real second user:

   | Service | Where | Starts as |
   |---|---|---|
   | Identity and permissions | `my_context()`, `has_perm()` | exists; extend `my_context()` with the permission keys added below |
   | Business rules | new `ops_rules` table and `ops_rules_evaluate()` | Stage 2 |
   | Data access | each module's `data/api.js` | exists |
   | Audit logging | `log_activity()` | exists; used by every new write RPC |
   | Scheduling | pg_cron where available (already used for sync) | Stage 3 |
   | Notifications | extend `notify_owner` into a per-recipient service | Stage 4 |
   | AI tools | Edge Function with a tool registry | Stage 5 |
5. **Every new write goes through a SECURITY DEFINER RPC** with `set search_path = public`, an explicit `has_perm` or ownership check, `revoke … from public, anon, authenticated` then a targeted `grant … to authenticated`, and a `log_activity` call. Each is covered by a database test that also tries the call as the wrong role.
6. **Migrations:** one reserved range per workstream (D-54, `docs/MODULES.md` §5.1). Apply by hand and register under the four-digit version, never with `apply_migration`; run `tools/check-registry.mjs` first.
7. **Hosting unchanged** (GitHub Pages + Supabase). The AI and push features need Edge Functions only; no new host.

## 5. Task Master (Stage 3)
### 5.1 Data model (proposal; prefix `task_`)
- `task_defs` — recurring definition (title, instructions, evidence rule, schedule, default assignee or role, approved_by, active).
- `task_items` — one task: status, assignee, creator, deadline, priority, evidence rule, source (`manual`, `schedule`, `ai_proposal`), `version` for optimistic concurrency.
- `task_events` — append-only history: created, assigned, accepted, started, submitted, verified, returned, reassigned, deadline changed, comment. Uses the same immutable-trigger pattern as `activity_log`.
- `task_evidence` — type, reference to stored file or text, uploader.
- `task_comments` — the only staff-to-staff channel (no chat or direct messages).
- `task_change_requests` — staff request for reassignment or a new deadline, with a reason, decided by authorised management.
- `task_proposals` — AI-recommended tasks waiting for approval; nothing becomes a task without an authorised approval.

### 5.2 Lifecycle (enforced in the database, not the browser)
`created → assigned → accepted → in_progress → submitted → verification → completed`; a rejected submission returns to `in_progress` for correction and resubmission. One RPC per transition, each checking the caller's role on the task. Staff cannot change owner or deadline except by a change request. A person can never verify a submission they made, the Owner included (check on `submitted_by <> auth.uid()` inside the RPC, covered by a test). Every completed task requires verification.

### 5.3 Permissions
New keys: `tasks.view_own`, `tasks.assign`, `tasks.verify`, `tasks.manage_defs`, `tasks.approve_proposals`, `tasks.review_requests`. Because Manager is the Owner (D-51), everything except `tasks.view_own` is Owner-only by default: only an admin at MFA level `aal2` holds them, and no role template carries them.
**Verification (D-52):** the Owner, and Senior staff the owner has named. A SQL helper `task_can_verify()` returns true only when the caller is the Owner, or the caller's login is `senior` **and** has an explicit per-user `grant` of `tasks.verify`. The `senior` template never carries the key, so granting it to all seniors by mistake does not widen access, and a Junior is refused even if granted. The helper is called inside every verify and return RPC and tested for: Owner, named Senior, unnamed Senior, Junior, a disabled login, and a person verifying their own submission.

### 5.4 Completion rate (defined, so it is fair)
Rate = tasks completed and verified on or before their deadline ÷ tasks whose deadline fell inside the period and which were assigned to that person for at least their full window. Excluded: tasks cancelled by management, tasks reassigned away before the deadline, tasks created already overdue, and days on approved leave once attendance exists. The period (7, 30 or 90 days) is always shown next to the figure.

### 5.5 Evidence
The task creator chooses `none`, `text`, `photo` or `file` and the allowed type. **No file storage exists today** (no Storage bucket and a strict Content Security Policy). Decision in §8; until then only `none` and `text` are built.

## 6. Notifications and reminders (Stage 4)
- New `ntf_recipients` (notification, user, created, delivered, read, acknowledged) so history is per person. The existing owner `notifications` table and `notify_owner()` keep working unchanged; new code calls a new `notify_users(kind, payload, recipients)` that writes the same kind of row and never raises.
- In-app inbox read through RLS (a person sees only their own rows); push through the existing `notify-ntfy` pattern.
- **Privacy:** push payloads carry ids and generic wording only. Salary, amounts and names never appear in a push or lock-screen text. This extends the rule already stated in `0012`.
- Reminder policy: owner-set defaults in `settings`; only the Owner adjusts reminders (Manager is the Owner, D-51). Overdue and approaching-deadline checks run on a schedule.
- Announcements with required acknowledgement use the same recipient table.
- Push to staff phones needs a per-user delivery channel; options are in §8.

## 7. Dua AI Assistant (Stage 5)
- One assistant, reachable from the dashboard and the navigation, role-aware through the same `my_context()` permissions.
- Runs **server-side** in an Edge Function. The model key lives only in Edge Function secrets, never in the browser. The function calls the database **as the signed-in user** (their token), so RLS and RPC checks apply to every tool call.
- **Allowlisted tool registry:** each tool is a named wrapper over an existing RPC with a JSON input schema, a required permission, a risk level (`read`, `low`, `high`) and a confirmation rule. No SQL tool exists. High-risk or financial tools need an explicit confirmation step and an idempotency key so a retry cannot run twice.
- On failure or uncertainty the assistant re-reads the database result before any retry and reports the real outcome. Permission denied returns a generic explanation with no restricted data.
- Conversation memory is session-only (kept in the browser tab, never stored server-side). App Guide uses a static, versioned guide file, so it works without the model.
- The assistant explains alerts and suggests responses; it cannot change severity or rules.
- Task Master and every module keep working when the assistant is unavailable.
- Needs from the owner: model provider and account, monthly spend limit (§8).

## 8. Owner decisions
Decided items are recorded in `docs/DECISIONS.md`. Open items are the "do not assume" list; the plan proceeds without them up to the stage that needs each.

| # | Decision | Status | Effect on the plan |
|---|---|---|---|
| D1 | Who may verify completed tasks | **Decided (D-52):** Owner and Senior staff the owner has named | Per-person `tasks.verify` grant on a Senior login; `task_can_verify()` in the database; no self-verification, the Owner included |
| D2 | Attendance source | **Decided (D-50):** wait for the Android app | No attendance UI or figures now; completion rate has no leave exclusion yet |
| D3 | Manager tier | **Decided (D-51):** Manager is the Owner | Two dashboards only: Owner and Staff. "Authorised manager" actions are Owner-only |
| D4 | Staging Supabase project before new tables | **Open** | Recommended before Stage 3 migrations; Stage 2 adds read RPCs and the rules table only |
| D5 | Migration ranges | **Decided and reserved (D-54)** | `0700–0749` ops, `0750–0799` reports, `0800–0899` AI, `1200–1299` tasks, `1300–1399` inbox; table in `docs/MODULES.md`, enforced by `tests/unit/migration-ranges.test.js` |
| D6 | Cash position authority | **Decided (D-53):** Manager ledgers; deposits are made daily to match cash sale | Owner-only read RPC over the ledgers; deposit-vs-cash-sale mismatch is a rule-based Action Centre issue |
| D7 | What "approved schedules" are for auto-generated tasks: who approves, how entered | Open (needed in Stage 3) | Given D-51 the proposal is Owner-only approval |
| D8 | Evidence storage: enable Supabase Storage, allowed types and size | Open (Stage 3) | Needs a CSP change; until then only `none` and `text` evidence |
| D9 | Staff push channel: per-user ntfy topics, web push, or in-app only first | Open (Stage 4) | ntfy is a public server; payload rules in §6 |
| D10 | AI provider, account, spend limit, first tools | Open (Stage 5) | |
| D11 | Default Recent Activity categories | Open (Stage 2) | Owner can change later |

Small open point inside D6, to settle against live data at the start of Stage 2: which deposit figure is compared with the cash sale (Closing deposit rows or a Manager ledger entry).

## 9. Stage 1 changes made with this plan
1. **`0015_core_trigger_search_path`** pins `search_path = public` on `public.set_updated_at()` and `public.activity_log_immutable()` (the two advisor warnings) and removes their unneeded PUBLIC execute right. Test `0015_core_trigger_search_path_test.sql` checks the pin, that browser roles cannot call them, that the audit log still refuses update and delete, and that triggers still fire for a signed-in role. **Applied live and registered as `0015` on 21 Nov 2026** (verified: both functions pinned, not executable by `anon`/`authenticated`/PUBLIC, triggers still attached).
2. **Registry drift:** `tools/check-registry.mjs` compares the migration files with a read-only export of the live registry and prints the exact renames; `docs/ops/f7-registry-reconciliation.md` is the reviewed, guarded, reversible procedure for the 12 timestamp-versioned rows. **Executed live on 21 Nov 2026** after a fresh read, with a registry backup: 13 rows renamed (the 12 plus `0218`), 0 timestamp versions remain. Unit tests: `tests/unit/registry-reconcile.test.js`.

Verification so far: the 7 new registry tests and the full 1,915 existing front-end tests pass. For the database, the clean-replay migrations `0001`–`0500` and all their tests pass, including the 7 new checks. The migrations from `0600` up (eBill, Candela, Invoice Desk, Workspace) could not be replayed in this environment because the local Postgres lacks the `pgcrypto` extension; the existing CI `database` job covers them and must be green before this is merged.

## 10. Stages, files and acceptance
Each stage ends only when its tests pass, the Owner, Manager and Staff cases are tested, a mobile pass is done, and the docs and tests are updated in the same change.

| Stage | Main work | Files affected (expected) | Acceptance |
|---|---|---|---|
| 1 Audit and plan | This document, `0015`, registry tool | docs, `supabase/migrations`, `tools` | §9 verified; registry plan approved |
| 2 Dashboard and roles | Shell, snapshot providers, Action Centre read model, rules table, activity feed RPC, Owner and Staff variants, shared refresh and stale-data service | `js/modules/home/*`, `js/core/statusbar.js`, new `js/shared/refresh.js`, manifests of Sales, Closing, Inventory, Audit, new `0700–0749` migrations | No figure differs from its module; staff see only own data; stale banner appears offline; existing Home tests still pass |
| 3 Task Master | Tables, RPCs, lifecycle, change requests, history, staff and manager screens | new `js/modules/tasks/*`, `1200–1299` migrations, `supabase/tests/12xx_*` | Lifecycle, self-verification block, rejected-then-resubmitted path, duplicate-submit safety, RLS per role |
| 4 Notifications | Recipients, inbox, reminder policy, schedules, acknowledgements, staff push | `notify-ntfy`, new `1300–1399` migrations, a shared notifications UI | Per-person history; no sensitive text in push; owner alerts unchanged |
| 5 AI assistant | Edge Function, tool registry, App Guide, confirmations | new function folder under `supabase/functions`, `js/modules/assistant/*`, `0800–0899` | Every tool denied for the wrong role; duplicate-action protection; app works with the function off |
| 6 Unified Reports | Report registry over existing views | `js/modules/reports/*` (range `0750–0799`) | Report totals equal module totals on golden fixtures |
| 7 Hardening and release | Playwright end-to-end, performance and accessibility on low-end Android, SECURITY DEFINER review (219 routines), FK indexes, deployment check | `tests/e2e`, CI | All suites green; owner phone acceptance recorded |

## 11. Risks
- **Migration safety:** new tables should not be created until the registry is in step and a staging project exists (D4).
- **Permission surface:** this plan adds many SECURITY DEFINER RPCs on top of 279 existing ones; the Stage 7 review and per-RPC wrong-role tests are required, not optional.
- **Scope:** the brief covers four large systems. Each stage is shippable on its own and the app keeps working if a later stage is deferred.
- **Payroll exposure:** staff payroll must be a new per-person RPC; Manager tables stay owner-only.
- **Public push server:** staff notifications must stay generic.
- **Acceptance gaps already open** (real phones, Gmail send, printers, restore drill) continue to apply and are not closed by this redesign.
