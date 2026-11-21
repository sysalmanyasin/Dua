# Database design and schema reference

> **Schema snapshot warning (13 Nov 2026):** the table/view/function catalogue below was generated from an earlier Sales/Foundation schema snapshot. It is not a complete inventory of the current live database after Manager (0101–0103), Closing (020x), Inventory (0301–0307) and Foundation operations migrations. Use migration files, module progress records and `docs/PROJECT_STATUS.md` for the later additions. Do not use the old table totals in this document as current totals.

PostgreSQL on Supabase, project **DuaPharmaPlus** (Mumbai region, free plan). This document is generated from the real schema at the time of writing and replaces the Phase 1 plan; the original plan is kept at the end for reference.

## Rules that hold everywhere
1. **Every table has row-level security on, and the browser has no direct write access** to business tables. Reads follow permission checks (`has_perm`); writes go through functions that check the permission, validate, and log. `anon` has no table or function access at all.
2. **Money is `numeric(14,2)`.** A day's TOTAL is rounded to a whole rupee exactly like JavaScript `Math.round` so the screen and database agree.
3. **Nothing posted is overwritten.** A corrected day keeps its old version (`daily_sales_revisions`) with the reason and who. The activity log cannot be updated or deleted.
4. **Dates:** business dates are Pakistan dates (`Asia/Karachi`); the day changes at 00:00. Timestamps are UTC.
5. **Retried saves are safe:** a client-made idempotency key means a day is saved once.
6. **Admins must be at MFA level 2** for any permission to count (enforced in `has_perm`).

## Tables (33; all with RLS, 31 policies)
| Table | Columns | Purpose |
|---|---|---|
| `access_requests` | 8 | Old sign-up requests (history only; self sign-up removed, D-49) |
| `activity_log` | 9 | Append-only record of sensitive actions |
| `checklist_answers` | 3 | Answers per item per day |
| `checklist_competitor_defaults` | 5 | Competitor rows copied onto a new day (private values) |
| `checklist_competitors` | 6 | Competitor rows per day |
| `checklist_days` | 31 | One row per check-list day (header, stock figures, notes, version) |
| `checklist_dropdown_options` | 3 | Shared dropdown lists |
| `checklist_items` | 9 | Check List questions and defaults |
| `checklist_sections` | 7 | Daily Check List sections (carried over from the original) |
| `daily_sale_lines` | 3 | Amount per payment field per day |
| `daily_sales_revisions` | 8 | Frozen earlier versions of a corrected day, with reason |
| `daily_sales` | 16 | One row per day: figures, total, diff, revision |
| `inventory_products` | 26 | Inventory feed (Candela → Dropbox → Edge Function); see docs/modules/inventory.md |
| `inventory_sync_log` | 7 | Inventory feed (Candela → Dropbox → Edge Function); see docs/modules/inventory.md |
| `login_attempts` | 5 | Failed/successful staff logins (lockout) |
| `monthly_history_lines` | 3 | Per-field figures of those months |
| `monthly_history` | 6 | Months known only as monthly totals |
| `payment_methods` | 8 | Payment fields (cash, banks, client columns): type, section, order, visibility |
| `permissions` | 2 | The list of permission keys |
| `profiles` | 8 | Login ↔ person link, username, role template, disabled/expiry |
| `role_permissions` | 2 | What each role template grants |
| `sales_credit_by_customer` | 6 | Inventory feed (Candela → Dropbox → Edge Function); see docs/modules/inventory.md |
| `sales_payment_summary` | 7 | Inventory feed (Candela → Dropbox → Edge Function); see docs/modules/inventory.md |
| `sales_save_keys` | 4 | Idempotency keys (a retried save is saved once) |
| `sales_targets` | 4 | Monthly sales targets |
| `settings_history` | 7 | Every settings change (value, reason, who) |
| `settings` | 6 | Business settings (till float, customer charge, module switches…) |
| `setup_codes` | 9 | Old one-time setup codes (history only; removed, D-49) |
| `staff` | 8 | People (kept even if their login is removed) |
| `str_headers` | 26 | Inventory feed (Candela → Dropbox → Edge Function); see docs/modules/inventory.md |
| `str_line_items` | 13 | Inventory feed (Candela → Dropbox → Edge Function); see docs/modules/inventory.md |
| `user_permissions` | 5 | Per-person allow/deny overrides |
| `user_prefs` | 4 | A person’s own small settings (hidden report rows, mail recipients) |

## Views (all `security_invoker`: they obey the caller's permissions)
| View | Purpose |
|---|---|
| `v_client_totals` | All-time sales per credit client (Dashboard chart) |
| `v_daily_full` | Per day: total and cash / banks / credit split (Dashboard) |
| `v_daily_report` | Per day: cash sale, cash returns, FDPP (Cash to Deposit) |
| `v_monthly` | Per month totals from days (Index) |
| `v_monthly_full` | Per month: from days, or from monthly-only figures (Dashboard, Reports) |
| `v_monthly_methods` | Per month and field (Sale Book) |

## Functions
| Function | Who may call | What it does |
|---|---|---|
| `activity_log_immutable` | signed-in users (checked inside) | Trigger: the log cannot be changed |
| `bootstrap_first_admin` | database owner only | Make the first owner (once, from the SQL editor) |
| `checklist_get_day` | signed-in users (checked inside) | Read one check-list day |
| `checklist_log_send` | signed-in users (checked inside) | Log a copy/print/email/gmail send |
| `checklist_reset_day` | signed-in users (checked inside) | Clear a check-list day (logged) |
| `checklist_save_day` | signed-in users (checked inside) | Autosave a check-list day (version-checked) |
| `checklist_set_dropdown` | signed-in users (checked inside) | Replace a dropdown list (3–30 options, logged) |
| `cover_summary` | signed-in users (checked inside) | Everything the Cover shows, limited to what the caller may see |
| `has_perm` | signed-in users (checked inside) | Does the caller hold this permission now? (admins need MFA) |
| `inventory_apply_sync` | service role only | Inventory feed helper |
| `inventory_latest_sync` | signed-in users (checked inside) | Inventory feed helper |
| `inventory_log_sync_failure` | service role only | Inventory feed helper |
| `log_activity` | service role only | Write to the activity log (internal) |
| `my_context` | signed-in users (checked inside) | Who am I, my permissions, switched-off modules |
| `payment_method_save` | signed-in users (checked inside) | Add or change a payment field (type locked once it has figures) |
| `payment_methods_reorder` | signed-in users (checked inside) | Set the order of payment fields |
| `prefs_set` | signed-in users (checked inside) | Store a personal setting |
| `sales_compute_total` | signed-in users (checked inside) | The one TOTAL formula |
| `sales_last_closed_day` | signed-in users (checked inside) | Latest closed day total only (what staff may see) |
| `sales_save_day` | signed-in users (checked inside) | Create or correct a day (permissions, validation, revision, idempotent) |
| `sales_set_target` | signed-in users (checked inside) | Set or clear a month’s target (logged) |
| `set_updated_at` | signed-in users (checked inside) | Trigger helper |
| `set_user_permission` | signed-in users (checked inside) | Allow/deny/clear one permission for one person (logged) |
| `set_user_role` | signed-in users (checked inside) | Change a person’s role template (logged) |
| `settings_set` | signed-in users (checked inside) | Change a setting with a reason (logged, versioned) |

## Migrations
| File | Content |
|---|---|
| `0001_core` | people, roles, permissions, settings, activity log, `has_perm`, `my_context`, logged admin functions |
| `0002_sales` | payment methods (31 built in), daily sales, lines, revisions, monthly-only history, the TOTAL formula, `sales_save_day`, `sales_last_closed_day` |
| `0003_import_helper` / `0004_remove_import_helper` | temporary one-time import helper, added then removed (history import done 5 Nov 2026) |
| `0005_sales_reports` | `v_daily_report` for Cash to Deposit |
| `0006_checklist` | Daily Check List (13 sections, 52 items, dropdowns, autosave functions) + 3 permissions |
| `0007_targets_prefs_cover` | targets, personal preferences, `cover_summary` |
| `0008_dashboard_views` | `v_daily_full`, `v_monthly_full`, `v_client_totals` |
| `0009_inventory_feed` | inventory feed tables and sync (Foundation F3, built in a separate session) |
| `0010_manage_fields` | field management functions, Sale Book view |

**Registry note:** the registry was reconciled to repo-numbered migrations on 12 Nov 2026 (`docs/DECISIONS.md` D-35, `docs/RUNBOOK.md` §4). New migrations are still applied by hand and registered under the repo number; never use a tool that registers a timestamp version.

## Seed and private data
Reference data (permissions, payment methods, check-list content, settings) is in migrations. **Private values are not in Git:** the owner's contact details, the doctor name, competitor figures (applied by SQL) and every real sales figure (imported once, never committed).

## Original Phase 1 plan (superseded)
The Phase 1 design grouped tables as core, sales, pos, inventory, str, audit, closing, management, documents. Those later groups are still the plan for the modules listed in `docs/MODULES.md`; the sections above are what exists today.

## Foundation operations tables (added 12 Nov 2026, migrations 0012–0013)
- **`notifications`** — owner alerts: `kind`, `payload` (ids and dates only), `status` (`pending|sent|failed`), `attempts`, `next_attempt_at`, `last_error`, `acked_at`. RLS: read needs `notifications.view`. Only the database calls `notify_owner(text, jsonb)`; the sender uses `notifications_claim` / `notifications_mark` (service role). The Cover reads `notifications_attention()`; `notifications_ack(id)` clears one.
- **`backup_log`** — one row per backup or restore drill: kind, status, day, size, sha256, fingerprint manifest (names, counts, hashes only), short error. RLS: read needs `tools.view`; written only through `backup_report()` (service role).
- **Functions:** `ops_check_inventory_feed()` (3 h without a good sync raises one alert a day), `ops_check_backups()` (30 h without a good backup, after the first), `tools_overview()` (owner only).
- **Schedules (pg_cron):** `notify-drain` every minute (only calls out when alerts are due), `ops-check-inventory-feed` every 30 min, `ops-check-backups` 07:00 UTC. They read the function address and secret from Vault by name.


## Later module schema additions (status snapshot 13 Nov 2026)
- **Manager:** migrations 0101–0103 add staff management, private details, notes, credit openings/entries and hardening. See `docs/modules/manager.progress.md`.
- **Closing:** migrations in the 0200 range implement closing tables, draft/submit/correction functions, hardening and period aggregation as recorded in `docs/modules/closing.progress.md`. The UI remains partial.
- **Inventory (live, 17 Nov 2026):** migrations 0301–0307, all on `main`. Tables: `inventory_products` (33 columns; the product copy with row hashes, group counters and `pack_valid`), `inventory_sync_log` (14), `inventory_sync_state` (11; one row of counters and the file hash), `inventory_excess_retained` (4) and `inventory_excess_settings` (5), the last two shared across devices. Functions the app can call when signed in (permission checked inside): `inventory_balances`, `inventory_search`, `inventory_changes_stock`, `inventory_changes_sales`, `inventory_latest_sync`, `inventory_in_transit`, `inventory_cover_summary`, `inventory_excess_retain_set`, `inventory_excess_settings_set`. Service role only: `inventory_apply_sync`, `inventory_apply_sync_body` (`0307`, the entry point the sync function calls), `inventory_hash_stock`, `inventory_hash_sales`, `inventory_note_unchanged`, `inventory_log_sync_failure`, `inventory_renumber_seq`, `inventory_prune`. `anon` has no grants on any inventory table. See `docs/modules/inventory.md`, `docs/modules/inventory-sync-design.md` (section 11) and `docs/modules/inventory.progress.md`.
- **Foundation operations:** migrations 0011–0013 cover scheduled inventory/operations and backup/notification infrastructure; see `docs/RUNBOOK.md` and `docs/ops/f6-registry-reconciliation.md`.

For a reproducible schema catalogue, regenerate this reference from the current migration set. The historical table/view/function counts above must not be quoted as current.
- **Candela Sales:** migration 0900 adds `candela_daily_payments`, `candela_credit_daily` (one row per customer per day, same name merged) and `candela_changes` (old figures when Candela corrects a day), all with RLS (`candela.view`) and no write grants; triggers on `sales_payment_summary` and `sales_credit_by_customer` fill them; `candela_today_total()` returns today's total for `candela.today_total` or `candela.view`. See `docs/modules/candela-sales.md`.
- **Workspace (18 Nov 2026, migrations 1100–1101; range 1100–1199):** tables `workspace_documents` (note or workbook; owner is a staff id; soft archive/delete; never removed), `workspace_members` (editor or viewer; maximum 50 per document; the owner is not a row), `workspace_folders` and `workspace_user_state` (each person's own folders and flags), `workspace_save_keys` (idempotency, service role only), `workspace_note_revisions` (every saved version; content checked by `workspace_note_valid`; sealed versions immutable; GIN index on plain text for search) and `workspace_conflicts` (text that lost a race). All have RLS; browsers hold SELECT only and every write is a `security definer` function that re-checks `workspace_role()`. Functions: access (`workspace_role`, `_can_read`, `_can_write`, `_is_owner`, `_can_read_revision`), documents (`_create_document`, `_list_documents`, `_document_state`, `_document_rename`, `_document_set_history_visible`), sharing (`_share_candidates`, `_member_list`, `_member_set`, `_member_remove`, `_transfer_ownership`), personal (`_folder_save`, `_folder_remove`, `_state_set`), notes (`_note_open`, `_note_save`, `_note_restore`, `_note_history`, `_search_notes`, `_conflict_resolve`) and internal helpers (`_staff_eligible`, `_idem_get/_put`, `_note_valid`, `_note_node_ok`, `_note_plain_text`). Sheets (`1102`), conflicts for sheets and Realtime (`1103`) and attachments (`1104`) are planned: `docs/modules/workspace.design.md`.
- **Workspace Sheets (migration `1102`, merged to `main` and applied live 21 Nov 2026, registered as version `1102`):** sheets, cells (stable row/column ids), styles, operation log and snapshots, with `workspace_apply_ops`, `workspace_pull`, `workspace_load_sheet` and snapshot/restore functions. Operations `move_rows`, `move_cols`, `duplicate_sheet` and `sort_range` are answered `rejected` for now. Details: `docs/modules/workspace.design.md` §4a; test `supabase/tests/1102_workspace_sheets_test.sql`.
