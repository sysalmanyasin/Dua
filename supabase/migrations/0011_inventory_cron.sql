-- 0011: the hourly inventory sync schedule, now kept in Git (Foundation F6 / D-35).
-- Until now this existed only on the live project (registered as 20261109104257 "enable_cron_and_net").
-- It is safe to apply anywhere, any number of times:
--   - where pg_cron / pg_net / vault are not available (CI, a restored test project) it does nothing;
--   - where a job named inventory-hourly-sync already exists (the live project) it leaves that job untouched;
--   - it holds no secret. The sync secret is read from Vault by name when the job runs.
-- A fresh project reads the function address from the Vault secret ops_function_base_url (not hard-coded), so a restored
-- copy of the database can never call the live project's function by accident. If either secret is missing the call is skipped.
do $cron$
begin
  begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
    if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
  exception when others then
    raise notice 'could not enable pg_cron / pg_net here: %', sqlerrm;
  end;
  if to_regclass('cron.job') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available: inventory schedule skipped';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'inventory-hourly-sync') then
    perform cron.schedule('inventory-hourly-sync', '0 * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ops_function_base_url') || '/sync-inventory-from-dropbox',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'inventory_sync_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000)
      where exists (select 1 from vault.decrypted_secrets where name = 'inventory_sync_secret')
        and exists (select 1 from vault.decrypted_secrets where name = 'ops_function_base_url') $job$);
  end if;
end $cron$;
