# Repository and live-system audit — 21 November 2026

## Scope and method

Reviewed the public GitHub repository `sysalmanyasin/Dua` at main commit `96694979e65242f5ee24eb86f215630686b552c8`, including the recursive source tree, module registry and manifests, module progress files, root project documents, migration files, test-file inventory, latest GitHub Actions runs, live Supabase project metadata, live migration registry, Edge Function inventory, SQL catalog facts and Supabase security/performance advisors.

This is a source and configuration audit. It is not a manual penetration test, full line-by-line review of every SQL function, real-device acceptance test, backup restore drill or business-owner sign-off for every module.

## Executive summary

The repository contains 13 registered modules and is deployable: CI run #401 and Pages deployment #226 both succeeded on the audited main commit. The project is substantially implemented, but the documentation had drifted behind the code in several places—especially Workspace registration, Audit Barcode, STR screens, Inventory's latest function/migration versions, and the Closing migration narrative.

The live database is healthy and has RLS enabled on every public base table. The principal technical risks are migration-registry version drift, the large set of authenticated-callable SECURITY DEFINER RPCs needing permission review, and the uncompleted real backup restore drill. The principal delivery gaps are owner/device acceptance and the missing Workspace Sheets UI.

## Repository inventory

| Item | Observed |
|---|---:|
| Files in repository tree | 707 |
| Registered module IDs | 13 |
| Module folders with manifests | 13 |
| Front-end test files | 121 |
| Front-end tests recorded on main snapshot | 1,891 |
| Database test files | 77 |
| Migration SQL files | 89 |

The registered module IDs are `home`, `sales`, `manager`, `access`, `tools`, `closing`, `inventory`, `str`, `candela-sales`, `ebill`, `audit`, `invoice-desk` and `workspace`.

## Deployment and CI

- Main commit: `96694979e65242f5ee24eb86f215630686b552c8`.
- GitHub Actions CI run #401: completed successfully. Jobs: `app`, `database`, `functions`.
- GitHub Pages deployment run #226: completed successfully on the same commit.
- The live Supabase project `DuaPharmaPlus` is `ACTIVE_HEALTHY`, PostgreSQL 17.11, region `ap-south-1`.
- Six Edge Functions are active:
  - `staff-login` v33
  - `claim-account` v33
  - `admin-users` v33
  - `notify-ntfy` v12
  - `sync-inventory-from-dropbox` v24
  - `request-access` v33

CI green does not prove the workflows are accepted on actual pharmacy phones, that Gmail sending works from the deployed origin, or that a physical printer renders correctly.

## Live database snapshot

Read-only inspection on 21 Nov 2026 found:

| Metric | Live value |
|---|---:|
| Public base tables | 124 |
| Public base tables with RLS enabled | 124 |
| Public routines | 337 |
| SECURITY DEFINER routines | 279 |
| SECURITY DEFINER routines without configured search_path | 0 |
| RLS tables with no policies | 14 |

The 14 policy-less tables have no direct table grants to `anon` or `authenticated`, consistent with internal/service-role-only use. Names: `audit_barcode_log`, `audit_barcodes`, `audit_scan_events`, `ebill_offline_grants`, `ebill_pins`, `inventory_sync_state`, `invoice_desk_idempotency`, `invoice_desk_product_idempotency`, `login_attempts`, `mgmt_save_keys`, `sales_save_keys`, `setup_codes`, `workspace_save_keys`, `workspace_sheet_revisions`.

## Migration registry discrepancy

There are 89 migration SQL files in the repository and 89 rows in the live registry. However, these 12 repo-numbered files have live registry entries under timestamp versions rather than their four-digit filename versions:

| Repository migration | Live registry version | Live registry name |
|---|---|---|
| `0014_staff_logins_pin4` | `20261121032408` | `0014_staff_logins_pin4` |
| `0215_closing_refresh_existing_drafts` | `20261118081315` | `closing_refresh_existing_drafts` |
| `0216_closing_prev_page_draft` | `20261118123221` | `0216_closing_prev_page_draft` |
| `0217_closing_shared_drafts_live` | `20261120030727` | `0217_closing_shared_drafts_live` |
| `0309_inventory_company_summary` | `20261119095001` | `0309_inventory_company_summary` |
| `0409_audit_final_reports` | `20261118153023` | `0409_audit_final_reports` |
| `0410_audit_expiry` | `20261119034215` | `0410_audit_expiry` |
| `0411_audit_barcode` | `20261120181743` | `0411_audit_barcode` |
| `1000_invoice_desk_core` | `20261117135131` | `1000_invoice_desk_core` |
| `1001_invoice_desk_integrity` | `20261117135645` | `1001_invoice_desk_integrity` |
| `1002_invoice_desk_amount_words_fix` | `20261117135716` | `1002_invoice_desk_amount_words_fix` |
| `1003_invoice_desk_product_scope` | `20261117140223` | `1003_invoice_desk_product_scope` |

The other 77 repository migration filenames match live registry version/name pairs. In particular, `0214_closing_staff_see_all` is present in both the repository and live registry. Older documents claiming its source file was missing are incorrect.

**Action:** do not blindly add duplicate numbered registry rows or modify already-applied migration files. Before the next database batch, prepare a reviewed reconciliation plan that preserves actual migration history and proves that clean local replay and hosted registry ordering remain safe.

## Supabase advisor findings

### Security

| Advisor finding | Count / state | Interpretation and action |
|---|---:|---|
| RLS enabled, no policy | 14 | Direct grants to `anon` and `authenticated` were also absent on these 14 tables. Keep this intentional internal-table pattern documented. |
| Mutable function search_path | 2 | `public.set_updated_at` and `public.activity_log_immutable`; pin explicitly after checking trigger dependencies. |
| Authenticated can execute SECURITY DEFINER functions | 219 | Not automatically exploitable. Review each function body for permission checks, caller identity checks and intended grant scope. Avoid blanket revocation. |
| Leaked-password protection | Off | Review whether it can be enabled without breaking the username/PIN staff login model. |

The live catalog query found 279 SECURITY DEFINER functions and no missing configured `search_path`; the advisor's two mutable-search-path warnings are for the non-definer trigger functions above.

### Performance

| Advisor finding | Count |
|---|---:|
| Unindexed foreign keys | 124 |
| RLS auth/initplan warnings | 5 |
| Unused indexes | 28 |
| Multiple permissive policies | 1 (`payment_methods` SELECT) |

Prioritize FK indexes and RLS initplan warnings using query workload and table size. Do not drop unused indexes solely from a fresh/low-traffic database's advisor snapshot; gather representative usage first.

## Module-by-module state

The detailed status and remaining acceptance steps are in [MODULE_PROGRESS_REGISTER.md](MODULE_PROGRESS_REGISTER.md). The source audit confirms all 13 module manifests are registered. Notable corrections to older documentation:

- Workspace is a registered application module, not an unregistered backend-only project.
- Workspace Notes are owner-accepted per the user's 21 Nov report; migration 1102 is live, but the Sheets UI is still unbuilt.
- STR has manifest, data layer and list/detail/report/zero-dispatch UI; its old progress-file opening statement that nothing was live is superseded by its later live-apply log.
- Audit Barcode is implemented and merged; it is not still paused as an unbuilt feature.
- Inventory's live Edge Function is v24 and migration 0309 is present under a timestamp registry version.
- Closing 0214 is in the repository and live registry; the outstanding registry issue is the timestamp-versioned later migrations.
- Invoice Desk is integrated and CI-tested on main, but physical output and broader E2E coverage remain.
- Emergency Billing Phase 6 automated tests are documented complete; owner/device/printer acceptance and permission grants remain.

## Work left — ordered

### P0: protect live data and deployment safety
1. Design and execute a safe plan for the 12 timestamp-versioned migration entries before applying additional migrations.
2. Review 219 authenticated-callable SECURITY DEFINER functions for permission checks and least-privilege execution grants.
3. Pin the two mutable-search-path trigger functions after validating dependencies.
4. Perform a real encrypted Drive restore into a separate empty Supabase project.
5. Review the 124 unindexed FKs, five RLS initplan warnings and duplicate permissive policy; measure before removing unused indexes.

### P1: finish acceptance of current workflows
1. Home/Sales: actual phone acceptance; one real Gmail send from deployed origin.
2. Manager: phone try-outs and real Closing Credit Inbox flow.
3. Closing: phone try-out #5, PDF/book/correction checks, audit-gate owner decision.
4. Inventory: phone PDF/print check, sync health and fallback removal after stable operation.
5. STR and Candela Sales: phone acceptance and hourly feed verification.
6. Audit: multi-phone/offline/scanner/print/CSV acceptance.
7. Emergency Billing: grant intended `ebill.*` permissions; complete receipt setup and real 58/80 mm printer tests.
8. Invoice Desk: end-to-end authorization/save/history tests and real workbook/printer comparison.

### P1/P2: finish Workspace
1. Build Sheets domain model and parity fixtures.
2. Build the Sheets data layer and grid, including New workbook and basic edit/save.
3. Add formula engine and formatting/sort/filter/CSV.
4. Add offline IndexedDB queue, sign-out cleanup and conflict resolution.
5. Add attachments and final integration/acceptance.

### P2/P3: platform and future scope
- Separate production and staging Supabase projects.
- Add Playwright E2E and Sentry monitoring.
- Complete accessibility and low-end Android performance checks.
- Define Unified Reports and permission-safe assistant interfaces.
- Plan Android shell/widgets and Attendance only as separate approved work.

## Audit limitations

This audit did not perform a full manual review of all 337 routines, penetration test, end-to-end manual workflow on real devices, physical printer tests, real Gmail send, or a Drive backup restore. Advisor findings are recorded as review work, not declared vulnerabilities.