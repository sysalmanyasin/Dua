# F7 — Migration registry reconciliation (12 timestamp-versioned rows)

Status: **executed on 21 Nov 2026 (owner-approved).** 13 rows were renamed (the 12 below plus `20261121182327 0218_closing_mode_change`, which appeared after the audit). Registry backed up first to `supabase_migrations.schema_migrations_backup_20261121` (91 rows). Result: 91 rows, 0 timestamp versions, names unchanged, `0015` registered by hand. Keep the backup until the next migration applies cleanly, then drop it; the older `schema_migrations_backup_20261112` is overdue for dropping.
The text below is the procedure as prepared; the table lists the 12 rows found by the 21 Nov audit.
This file holds SQL that is **not** a migration. It must never go into `supabase/migrations/`.
Background: the 21 Nov 2026 audit (`docs/PROJECT_AUDIT_2026-11-21.md`) and the earlier D-35 reconciliation (`docs/ops/f6-registry-reconciliation.md`).

## What is wrong
Twelve migration files exist in the repository under four-digit numbers, but the live registry (`supabase_migrations.schema_migrations`) holds them under timestamp versions, because a tool registered them. Their SQL **is** applied; only the registry version differs. Timestamp versions sort after every numbered row, so Supabase's automatic apply and `supabase migration list` can refuse new numbered files.

| Repository file | Live version (21 Nov audit) | Live name |
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

The table is from the audit, not from a fresh read. **Do not trust it: regenerate it in Step 1.**

## What this plan does and does not do
- It renames the `version` of 12 existing registry rows. It never inserts a second row, never edits a migration file and never re-runs migration SQL (re-running `0215` and others would fail or duplicate objects).
- It leaves each row's `name` unchanged. `tools/check-registry.mjs` accepts the name with or without its number prefix.
- No business table, function, policy or user data is touched.

## Preconditions
1. Owner approval, and no other session applying migrations for the next 15 minutes.
2. Step 1 shows exactly 12 timestamp rows whose names match repository files, no CLASH line, and nothing under "NOT REGISTERED" or "REGISTRY ONLY" that you cannot explain.
3. Migration `0015_core_trigger_search_path` (this change) is **not** part of this batch. Apply it afterwards by hand and register it as `0015` (RUNBOOK §4 step 3). Never use `apply_migration`.

## Step 1 — read-only check (safe any time)
Run in the SQL editor and save the result as `registry.json`:
```sql
select coalesce(json_agg(json_build_object('version', version, 'name', name) order by version), '[]') from supabase_migrations.schema_migrations;
```
Then, in a repository checkout:
```sh
node tools/check-registry.mjs registry.json --sql
```
It prints the renames it found and the guarded SQL for them. It exits 1 while the registry is not in step, and writes nothing.

## Step 2 — back up the registry
```sql
create table supabase_migrations.schema_migrations_backup_<yyyymmdd> as select * from supabase_migrations.schema_migrations;
select count(*) from supabase_migrations.schema_migrations_backup_<yyyymmdd>;  -- expect 89 (or the current count)
```
Also drop the older `schema_migrations_backup_20261112` if it still exists (it was due about 19 Nov 2026).

## Step 3 — rename (one transaction, row-count guards)
Run the SQL printed by `--sql`. It has this shape (first row shown; the tool prints all twelve):
```sql
begin;
do $$
declare r record; n integer;
begin
  for r in select * from (values
    ('20261121032408', '0014_staff_logins_pin4', '0014')
    -- ...eleven more rows, printed by the tool
  ) as t(old_version, reg_name, new_version) loop
    update supabase_migrations.schema_migrations set version = r.new_version
     where version = r.old_version and name = r.reg_name
       and not exists (select 1 from supabase_migrations.schema_migrations where version = r.new_version);
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'expected to rename exactly 1 row for %, renamed %', r.old_version, n; end if;
  end loop;
end $$;
commit;
```
If any guard fails, the whole transaction aborts and nothing changes.

## Step 4 — verify
- Re-run Step 1: `node tools/check-registry.mjs registry.json` prints `timestamp-versioned 0, not registered 0, registry-only 0` and exits 0.
- Row count is unchanged (89 plus anything legitimately added since).
- `supabase migration list` (or the dashboard) shows local and remote matching.
- Spot check one rename: `select version, name from supabase_migrations.schema_migrations where name like '%closing_prev_page_draft%';` shows `0216`.

## Rollback
```sql
begin;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations select * from supabase_migrations.schema_migrations_backup_<yyyymmdd>;
commit;
```
Only registry metadata is changed, so there is no business data to restore.

## After it is done
Update `docs/RUNBOOK.md` §4, `docs/ROADMAP.md` item 1 and `docs/PROJECT_STATUS.md` to say the registry is in step, and keep running `tools/check-registry.mjs` before each migration batch.

## Addendum, 28 Nov 2026: `1205` and `1206`
Two more rows had timestamp versions (`20261127122600` `1205_owner_only_permissions_guard`, `20261127122609` `1206_task_notice_owner_only_and_cleanup`), because they were registered by a tool while their files were still on an unmerged branch. This blocked the Supabase integration ("Remote migration versions not found in local migrations directory"), so `1404` could not be applied automatically. Once PRs #112 and #114 had put the files into `main`, the same procedure was run for just these two rows: backup table `supabase_migrations.schema_migrations_backup_20261128` (137 rows), then `update ... set version = '1205'` / `'1206'` (names unchanged). Lesson: never register a migration whose file is not yet in `main`; merge the file first, then apply by hand and register it under its four-digit number.
