# F6 — Migration registry reconciliation (D-35)

Status: **executed on 12 Nov 2026 (about 03:15 UTC, owner-approved).** Registry backed up to `supabase_migrations.schema_migrations_backup_20261112` (12 rows),
`20261109102531` renamed to `0009`, `20261109104257` removed, `0011` and `0012` applied by hand and registered under their repo numbers.
Registry afterwards: `0001`–`0012`, `0301`. Cron job `inventory-hourly-sync` unchanged (id 1, `0 * * * *`, active). `notify-ntfy` deployed (`verify_jwt` off; it authenticates with its own secret).
Facts below were read (read-only) from project `sdsynzsflubdxnelgthh` before the change.
**Drop the backup table after one clean week (about 19 Nov 2026).**
This file holds SQL that is **not** a migration. It must never go into `supabase/migrations/`.

## What was found
| Registry row (live) | Repo file | Problem |
|---|---|---|
| `0001`–`0008`, `0010` | same numbers | fine |
| `20261109102531 inventory_feed` | `0009_inventory_feed.sql` | timestamp version instead of `0009` |
| `20261109104257 enable_cron_and_net` | none | the hourly cron step was never in Git (now `0011_inventory_cron.sql`) |
| `0301 inventory_interfaces` | `0301_inventory_interfaces.sql` (Inventory branch, not yet on `main`) | applied by hand by the Inventory session, with the repo number. Correct convention; leave alone |

Because `20261109…` sorts after `0011`–`0013`, Supabase's automatic apply refuses every new numbered file until the registry matches the repo.
The live cron job `inventory-hourly-sync` (`0 * * * *`, active) reads its secret from Vault by name. It contains no literal secret.
The registry rows for hand-applied migrations carry a one-line placeholder in `statements`, not the real SQL. That is normal here.

## Why the tool `apply_migration` must not be used
It registers a **timestamp** version. That is exactly how D-35 happened. Apply by hand with the SQL runner, then insert the repo-numbered registry row (see "Applying 0011 to 0013" below).

## Preconditions (all must hold)
1. The three module sessions confirm they are not applying anything for the next 15 minutes.
2. Read-only re-check of the registry immediately before: it must still list exactly the rows above (plus any new hand-applied repo-numbered rows).
3. `0009_inventory_feed.sql` on `main` is byte-identical to the one on `foundation/inventory-feed` (verified 12 Nov).
4. Live objects from `0009` exist (inventory tables with RLS on, `inventory_apply_sync`, `inventory_log_sync_failure`, `inventory_latest_sync`): verified 12 Nov.

## Step 1 — back up the registry (metadata copy)
```sql
create table supabase_migrations.schema_migrations_backup_20261112 as
  select * from supabase_migrations.schema_migrations;
select count(*) from supabase_migrations.schema_migrations_backup_20261112;  -- expect 12 (or current count)
```

## Step 2 — rename, in one transaction, with row-count guards
```sql
begin;
do $$
declare n integer;
begin
  update supabase_migrations.schema_migrations set version = '0009'
   where version = '20261109102531' and name = 'inventory_feed'
     and not exists (select 1 from supabase_migrations.schema_migrations where version = '0009');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected to rename exactly 1 row, renamed %', n; end if;

  delete from supabase_migrations.schema_migrations
   where version = '20261109104257' and name = 'enable_cron_and_net';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected to remove exactly 1 row, removed %', n; end if;
end $$;
commit;
```
If either guard fails, the transaction aborts and nothing changes.

## Step 3 — verify
- Registry now reads `0001…0010` with no timestamp rows (plus `0301` and anything else hand-applied).
- `select jobid, jobname, schedule, active from cron.job;` unchanged (`1`, `inventory-hourly-sync`, `0 * * * *`, true).
- The next hourly `inventory_sync_log` row is `ok`.
- `supabase migration list` (or the dashboard) shows local and remote matching.

## Step 4 — apply 0011 (and later 0012, 0013) by hand, one at a time
0011 is idempotent: the live job already exists, so it changes nothing.
```sql
-- run the file's SQL, then register it under the repo number
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('0011', 'inventory_cron', array['applied by hand from supabase/migrations/0011_inventory_cron.sql']);
```
After this, automatic apply works for new numbered files, and this manual step is no longer needed.

## Rollback
```sql
begin;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations select * from supabase_migrations.schema_migrations_backup_20261112;
commit;
```
Only the registry is touched by Step 2, so there is no data to restore. Drop the backup table after one clean week.

## Secrets
Nothing in this file or in `0011` is a secret. Vault holds `inventory_sync_secret` today. F4/F7 add `ops_function_base_url` and `notify_drain_secret` (names only here; values are created by the owner in the dashboard and never written to Git or chat).
