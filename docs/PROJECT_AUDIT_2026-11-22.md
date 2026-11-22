# Dua — code and live Supabase audit (22 Nov 2026)

**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Branch:** `main`  
**Commit:** [`18283f17600be54d562a5eb3c40bf89906416b29`](https://github.com/sysalmanyasin/Dua/commit/18283f17600be54d562a5eb3c40bf89906416b29)  
**Live site:** https://sysalmanyasin.github.io/Dua/  
**Supabase:** DuaPharmaPlus (`sdsynzsflubdxnelgthh`), `ap-south-1`, PostgreSQL 17.11, `ACTIVE_HEALTHY`.

## Executive summary

Dua is a static modular HTML/JavaScript application on GitHub Pages, using Supabase Postgres, Auth and Edge Functions. Main registers 13 modules. CI run #444 and Pages deployment #244 passed on the audited commit.

The live database responds and all public base tables have RLS enabled. The principal discrepancy is migration-source drift: main contains 92 SQL migration files, while the live migration registry has 93 rows. The extra live entry is `0015_core_trigger_search_path`, which has no corresponding file on main. Do not reapply or recreate it blindly.

Six Edge Functions are active. Four current functions have source directories and are type-checked by CI. Two active endpoints, `claim-account` and `request-access`, are retired tombstones returning HTTP 410 and are absent from the current source tree/CI loop.

## Repository and application facts

| Item | Verified state |
|---|---|
| Default branch / commit | `main` / `18283f17600be54d562a5eb3c40bf89906416b29` |
| Recursive tree | 735 tracked blobs |
| Registered modules | 13 |
| App technology | Plain HTML + JavaScript ES modules; no app build step |
| Package scripts | lint, format check, Vitest, secret scan, vendor hash check, DB test runner, static server, service-worker build |
| App entry | `index.html` → `js/core/app.js` |
| Supabase client | Vendored `vendor/supabase-js-2.45.4.umd.js`; configuration in `js/core/config.js` |
| Migration SQL files on main | 92 |

Module IDs in `js/modules/index.js`: `home`, `sales`, `manager`, `access`, `tools`, `closing`, `inventory`, `str`, `candela-sales`, `ebill`, `audit`, `invoice-desk`, `workspace`.

### Environment configuration

`js/core/config.js` maps both `staging` and `production` to the same Supabase URL and publishable key. GitHub Pages is therefore not isolated from a separate production backend. Create a separate production project before treating the environments as independent.

## Live Supabase verification (read-only)

| Metric | Live result |
|---|---:|
| Project status | `ACTIVE_HEALTHY` |
| PostgreSQL | 17.11 |
| Public base tables | 124 |
| Public base tables with RLS | 124 / 124 |
| RLS-enabled tables with no policies | 14 |
| Policy-less tables exposed to anon/authenticated table privileges | 0 |
| Public routines | 341 |
| SECURITY DEFINER routines | 283 |
| SECURITY DEFINER routines without configured search_path | 0 |
| Live migration registry rows | 93 |

The 14 policy-less tables are internal tables; a separate privilege check found zero directly exposed to `anon` or `authenticated`:

`audit_barcode_log`, `audit_barcodes`, `audit_scan_events`, `ebill_offline_grants`, `ebill_pins`, `inventory_sync_state`, `invoice_desk_idempotency`, `invoice_desk_product_idempotency`, `login_attempts`, `mgmt_save_keys`, `sales_save_keys`, `setup_codes`, `workspace_save_keys`, `workspace_sheet_revisions`.

RLS enabled with no policies is not automatically a vulnerability; the separate grants check is important. Keep these tables inaccessible to browser roles unless a reviewed access design changes.

## Migration registry drift

- Main has 92 files under `supabase/migrations/`.
- Live `supabase_migrations.schema_migrations` has 93 rows.
- Live-only version `0015` is named `core_trigger_search_path`.
- Main has no `0015_core_trigger_search_path.sql`.

This differs from the 21 Nov audit narrative, which recommended bringing 0015 from an unmerged branch. The current main tree still lacks the file while the live registry retains version 0015. Recover the exact migration source from trusted Git history/branches or reconstruct it from an authoritative source and validate its effect. Do not execute it again, insert a fake registry row, delete the live registry row, or rewrite applied history as a shortcut. Other registry versions returned by the live query use repo-style numeric versions; no timestamp-versioned rows appeared.

## Deployed Edge Functions

| Function | Live version | State | Source/CI |
|---|---:|---|---|
| `staff-login` | 33 | ACTIVE | Current source; CI type-checks |
| `admin-users` | 33 | ACTIVE | Current source; CI type-checks |
| `sync-inventory-from-dropbox` | 24 | ACTIVE | Current source; CI type-checks |
| `notify-ntfy` | 12 | ACTIVE | Current source; CI type-checks |
| `claim-account` | 33 | ACTIVE | Retired tombstone; responds HTTP 410; no current source/CI check |
| `request-access` | 33 | ACTIVE | Retired tombstone; responds HTTP 410; no current source/CI check |

The deployed retired function bodies explicitly state that setup-code claiming and self-signup were removed. The setup guide says these can be deleted. This audit did not delete or redeploy any function.

## Supabase advisor snapshot

### Security
- 14 RLS-enabled tables have no policies; none are directly exposed to `anon` or `authenticated` by table privileges.
- 220 SECURITY DEFINER functions are executable by the authenticated role and flagged for review. This is not proof that all are vulnerable. Review authorization checks, caller identity assumptions and intended grant scope function by function; do not blanket-revoke.

### Performance
- 124 unindexed foreign-key findings.
- 5 RLS auth/initplan findings: `staff`, `profiles`, `user_permissions`, `user_prefs`, `closings`.
- 23 unused-index notices.
- 1 multiple-permissive-policy warning: `payment_methods` SELECT policies.

Measure query plans and representative workload before changing indexes or policies. Unused-index notices should not trigger automatic drops on a young/low-traffic database.

### Health
The health advisor returned no lints in this snapshot. This does not replace application monitoring, restore drills or availability checks.

## CI and deployment verification

- [CI run #444](https://github.com/sysalmanyasin/Dua/actions/runs/45006802268) completed successfully on the audited commit on 22 Nov 2026.
- [Pages deployment #244](https://github.com/sysalmanyasin/Dua/actions/runs/45006801951) succeeded on the same commit.
- CI app job: npm install, ESLint, Prettier check, Vitest, secret scan, vendor integrity and actionlint.
- CI database job: `bash supabase/tests/run.sh` against PostgreSQL 16.
- CI functions job: `deno check` for the four current source functions above.

Green CI proves those automated jobs passed for that commit. It does not prove real-device acceptance, live business workflows, Gmail delivery, printer output or production restore.

## Workspace Sheets correction

PR #66 merged into main at the audited commit. The Workspace Sheets reference/domain model and parity fixtures/tests are now on main. The Workspace module is registered, but a Sheets data layer, workbook/grid UI, formula engine, offline queue and attachments are not complete. Do not describe the reference model as branch-only work or the Sheets feature as usable.

## Prioritized follow-up

### P0 — preserve live database history
1. Recover and review the exact source for live-only migration 0015; add it to the repository through a reviewed PR without reapplying it.
2. Re-run migration-source/registry parity checks before any hosted migration.
3. Review the 220 authenticated-callable SECURITY DEFINER functions by module, confirming permission gates and least-privilege grants.
4. Re-check the two mutable-search-path advisor findings noted in the prior audit if still present; the current catalog query found zero SECURITY DEFINER routines without configured search_path.

### P1 — deployment and acceptance
1. Separate staging and production Supabase projects.
2. Perform an encrypted Drive restore drill into a separate empty Supabase project.
3. Complete real-device owner/staff acceptance, a real Gmail send, and physical printer checks.
4. Decide whether to remove the two retired HTTP 410 functions; preserve tombstone behaviour until client compatibility is confirmed.

### P2 — performance and product
1. Review 124 unindexed foreign keys and 5 RLS initplan findings using measured workload.
2. Investigate the duplicate `payment_methods` SELECT policy.
3. Retain or drop 23 unused-index candidates only after representative workload measurement.
4. Complete Workspace Sheets data layer and UI before documenting Sheets as usable.

## Audit boundary

This was a repository-tree/source/documentation inspection plus read-only Supabase metadata/catalog/advisor checks. It did not execute the app in a browser or on a pharmacy phone, run manual login/E2E workflows, send Gmail, test a physical printer, restore a Drive backup, penetration-test the app, or manually review all 341 routines. It queried schema metadata and aggregate/catalog state, not private business contents. Older module progress files remain dated evidence; this audit supersedes conflicting live-state numbers.
