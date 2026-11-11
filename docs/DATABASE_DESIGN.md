# Database (as built)

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
| `access_requests` | 8 | Pending/approved/rejected sign-up requests |
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
| `setup_codes` | 9 | One-time PIN setup codes (hashed, expiring) |
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

**Registry warning:** see `docs/DECISIONS.md` D-35 and `docs/RUNBOOK.md` §4: the live project's migration list does not yet match the repo's file names for the inventory feed, so new migrations are applied by hand until that is reconciled.

## Seed and private data
Reference data (permissions, payment methods, check-list content, settings) is in migrations. **Private values are not in Git:** the owner's contact details, the doctor name, competitor figures (applied by SQL) and every real sales figure (imported once, never committed).

## Original Phase 1 plan (superseded)
The Phase 1 design grouped tables as core, sales, pos, inventory, str, audit, closing, management, documents. Those later groups are still the plan for the modules listed in `docs/MODULES.md`; the sections above are what exists today.
