# Dua — code and live Supabase audit (22 Nov 2026)

**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Audited branch/commit:** `main` / [`18283f17600be54d562a5eb3c40bf89906416b29`](https://github.com/sysalmanyasin/Dua/commit/18283f17600be54d562a5eb3c40bf89906416b29)  
**Live site:** https://sysalmanyasin.github.io/Dua/  
**Supabase:** DuaPharmaPlus (`sdsynzsflubdxnelgthh`), `ap-south-1`, PostgreSQL 17.11, `ACTIVE_HEALTHY`.

## Executive summary

Dua is a static modular HTML/JavaScript application hosted on GitHub Pages, using Supabase Postgres, Auth and Edge Functions. Main registers 13 modules. CI run #444 and Pages deployment #244 passed on the audited commit.

The live database responds and all 124 public base tables have RLS enabled. Main contains 92 migration SQL files; the live registry has 93 four-digit versions. The additional live version is `0015:core_trigger_search_path`; its exact migration file exists on branch `ops-redesign-stage1` (blob `f49ac84a619f234874d74b77ee144e40b252bbf7`) but is absent from main. It has already been applied live. Bring the exact source into main through a reviewed documentation/source PR; do not reapply the SQL or create another registry row.

Six Edge Functions are active. Four current functions have source directories and are type-checked by CI. Two active endpoints, `claim-account` and `request-access`, are retired tombstones returning HTTP 410 and are absent from the current source tree/CI loop.

## Repository and application facts

| Item | Verified state |
|---|---|
| Default branch / audited commit | `main` / `18283f17600be54d562a5eb3c40bf89906416b29` |
| Recursive tree | 735 tracked blobs |
| Registered modules | 13 |
| App technology | Plain HTML + JavaScript ES modules; no app build step |
| App entry | `index.html` → `js/core/app.js` |
| Supabase client | Vendored `vendor/supabase-js-2.45.4.umd.js`; config in `js/core/config.js` |
| Migration SQL files on main | 92 |
| Live migration registry | 93 four-digit versions |

Module IDs in `js/modules/index.js`: `home`, `sales`, `manager`, `access`, `tools`, `closing`, `inventory`, `str`, `candela-sales`, `ebill`, `audit`, `invoice-desk`, `workspace`.

### Environment configuration

`js/core/config.js` maps both `staging` and `production` to the same Supabase URL and publishable key. The GitHub Pages deployment is therefore not isolated from a separate production backend. Create a separate production project before treating these as independent environments.

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
| Live migration registry rows | 93 (all four-digit versions) |

The 14 policy-less tables are internal tables; a separate privilege check found zero directly exposed to `anon` or `authenticated`:

`audit_barcode_log`, `audit_barcodes`, `audit_scan_events`, `ebill_offline_grants`, `ebill_pins`, `inventory_sync_state`, `invoice_desk_idempotency`, `invoice_desk_product_idempotency`, `login_attempts`, `mgmt_save_keys`, `sales_save_keys`, `setup_codes`, `workspace_save_keys`, `workspace_sheet_revisions`.

RLS enabled with no policies is not automatically a vulnerability; the separate grants check is important. Keep these tables inaccessible to browser roles unless a reviewed access design changes.

## Migration source/registry reconciliation

- Main has 92 files under `supabase/migrations/`.
- Live `supabase_migrations.schema_migrations` has 93 rows; all versions are four digits.
- The extra live version is `0015:core_trigger_search_path`.
- Main has no `0015_core_trigger_search_path.sql`; the exact source is on `ops-redesign-stage1` at blob `f49ac84a619f234874d74b77ee144e40b252bbf7`.
- That migration pins `search_path = public` and revokes direct execute on the non-definer trigger functions `public.set_updated_at()` and `public.activity_log_immutable()`. It is already applied live and registered as 0015.

The correct action is to bring the exact, already-applied source into main in a reviewed PR and preserve its existing registry entry. Do not execute it again, insert a fake registry row, delete the live registry row, or rewrite applied migration history. The live registry also includes 0412 as a normal four-digit version; no timestamp-versioned rows remain.

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

## Supabase advisor snapshot (22 Nov 2026)

### Security
- 14 RLS-enabled tables have no policies; none are directly exposed to `anon` or `authenticated` by table privileges.
- 220 SECURITY DEFINER functions are executable by the authenticated role and flagged for review. This is not proof that all are vulnerable. Review authorization checks, caller identity assumptions and intended grant scope function by function; do not blanket-revoke.
- The catalog query found no SECURITY DEFINER routine without a configured `search_path`. The two non-definer trigger functions, `set_updated_at` and `activity_log_immutable`, both now have `search_path=public`; direct EXECUTE is false for `PUBLIC`, `anon` and `authenticated`. Migration 0015, already live, fixed the earlier mutable-search-path findings; the current advisor no longer reports `function_search_path_mutable`.
- The current security advisor reports `auth_leaked_password_protection` (one warning): leaked-password protection is disabled. This needs an owner/security decision after confirming compatibility with the custom staff PIN sign-in model. Edge Function JWT settings were not independently re-read in this pass.

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

## Workspace Sheets status correction

PR #66 merged into main at the audited commit. The Workspace Sheets reference/domain model and parity fixtures/tests are now on main. The Sheets database model exists, but a full Sheets data layer, workbook/grid UI, formula engine, offline queue and attachments are not thereby complete. The latest module progress and handover documents must reflect that Phase 5 increment 2 reference model is merged; do not describe it as branch-only work.

## Prioritized follow-up

### P0 — preserve live database history
1. Bring the exact `0015_core_trigger_search_path.sql` source from `ops-redesign-stage1` into main in a reviewed PR. It is already applied live; do not reapply.
2. Re-run migration-source/registry parity checks before any hosted migration.
3. Review the 220 authenticated-callable SECURITY DEFINER functions by module, confirming permission gates and least-privilege grants.
4. Confirm the 0015 trigger hardening remains present in the live catalog after source reconciliation.

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
