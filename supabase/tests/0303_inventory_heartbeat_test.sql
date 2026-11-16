\set ON_ERROR_STOP on
-- 0303: a scheduled "file unchanged" check leaves a heartbeat log row when the newest successful row is older than
-- 2 hours, so a watchdog that looks for "no successful sync in 3 hours" does not fire while the file is simply unchanged.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@t');

do $t$ declare n0 bigint; r jsonb; begin
  set local role service_role;
  perform public.inventory_apply_sync(jsonb_build_object('products', jsonb_build_array(jsonb_build_object('code', 'A1', 'name', 'Item A1'))), 'dropbox', null, false, 'h1');
  reset role;
  select count(*) into n0 from public.inventory_sync_log;

  -- right after a sync: no new row
  set local role service_role; r := public.inventory_note_unchanged('h1', 'dropbox', null); reset role;
  perform pg_temp.ok(r->>'result' = 'unchanged' and (select count(*) from public.inventory_sync_log) = n0, 'a scheduled check soon after a sync writes no log row');

  -- 90 minutes after the last row: still no row
  update public.inventory_sync_log set synced_at = clock_timestamp() - interval '90 minutes';
  set local role service_role; perform public.inventory_note_unchanged('h1', 'dropbox', null); reset role;
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0, 'after 90 minutes there is still no extra row');

  -- 3 hours after the last successful row: a heartbeat row appears
  update public.inventory_sync_log set synced_at = clock_timestamp() - interval '3 hours';
  perform pg_temp.ok((select max(synced_at) from public.inventory_sync_log where status = 'ok') < clock_timestamp() - interval '2 hours 59 minutes', 'setup: the newest successful row is 3 hours old');
  set local role service_role; perform public.inventory_note_unchanged('h1', 'dropbox', null); reset role;
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0 + 1, 'after 3 hours a heartbeat row is written');
  perform pg_temp.ok((select status || '/' || result from public.inventory_sync_log order by synced_at desc, id desc limit 1) = 'ok/unchanged', 'the heartbeat is an ok/unchanged row');
  perform pg_temp.ok((select max(synced_at) from public.inventory_sync_log where status = 'ok') > clock_timestamp() - interval '5 minutes', 'the watchdog query (newest ok row) now sees a fresh row');

  -- the heartbeat is not repeated by the very next check
  set local role service_role; perform public.inventory_note_unchanged('h1', 'dropbox', null); reset role;
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0 + 1, 'the next check does not add another row');

  -- failed rows are not a sign of life: with only a recent failure, the check still writes a heartbeat
  delete from public.inventory_sync_log where status = 'ok';
  insert into public.inventory_sync_log (synced_at, status, result, item_count, error) values (clock_timestamp(), 'failed', 'failed', 0, 'boom');
  set local role service_role; perform public.inventory_note_unchanged('h1', 'dropbox', null); reset role;
  perform pg_temp.ok((select count(*) from public.inventory_sync_log where status = 'ok' and result = 'unchanged') = 1, 'a recent failure does not count as a successful row');

  -- a check started by a person is always logged, with who started it
  select count(*) into n0 from public.inventory_sync_log;
  set local role service_role; perform public.inventory_note_unchanged('h1', 'dropbox', '00000000-0000-0000-0000-0000000000a1'); reset role;
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0 + 1 and (select triggered_by from public.inventory_sync_log order by synced_at desc, id desc limit 1) = '00000000-0000-0000-0000-0000000000a1', 'a manual check is always logged with the person');

  -- counters and state are untouched by all of this
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = 1 and (select seq_sales from public.inventory_sync_state) = 1, 'counters did not move');
  perform pg_temp.ok((select content_hash from public.inventory_sync_state) = 'h1', 'the stored file hash is unchanged');

  -- who may call it (unchanged from 0302)
  set local role anon;
  begin perform public.inventory_note_unchanged('x'); perform pg_temp.ok(false, 'anon');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot record a check (pass: refused)'); end;
  reset role;
end $t$;
rollback;
