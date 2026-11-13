\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare a uuid; b uuid; c record; n int; failed boolean; att jsonb; begin
  -- permission exists and only the owner (admin) holds it
  perform pg_temp.ok(exists (select 1 from public.permissions where key = 'notifications.view'), 'the notifications.view permission exists');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'notifications.view'), 'no role preset carries notifications.view');

  set local role service_role;
  -- queueing
  a := public.notify_owner('closing.submitted', jsonb_build_object('closing_id', 'x1'));
  perform pg_temp.ok(a is not null and (select status from public.notifications where id = a) = 'pending', 'notify_owner queues a pending row');

  -- it never raises, whatever it is given
  perform pg_temp.ok(public.notify_owner('Bad Kind!', '{}'::jsonb) is null, 'a bad kind is dropped, not raised');
  perform pg_temp.ok(public.notify_owner(null, '{}'::jsonb) is null, 'a null kind is dropped, not raised');
  perform pg_temp.ok(public.notify_owner('x.big', jsonb_build_object('t', repeat('x', 5000))) is null, 'an oversized payload is dropped, not raised');
  perform pg_temp.ok(public.notify_owner('x.nullpayload', null) is not null, 'a null payload becomes an empty one');

  -- a notification problem inside a business transaction does not poison it
  begin
    create temp table biz(v int) on commit drop;
    insert into biz values (1);
    perform public.notify_owner('Bad Kind!', '{}'::jsonb);
    insert into biz values (2);
    perform pg_temp.ok((select count(*) from biz) = 2, 'the business work around a failed notify still completes');
  end;

  -- repeats are dropped while unacknowledged
  a := public.notify_owner('inventory.sync_stale', jsonb_build_object('dedupe_key', 'k1'));
  b := public.notify_owner('inventory.sync_stale', jsonb_build_object('dedupe_key', 'k1'));
  perform pg_temp.ok(a is not null and b is null, 'a repeat with the same dedupe key is dropped');
  perform pg_temp.ok((select count(*) from public.notifications where dedupe_key = 'k1') = 1, 'only one row exists for the key');

  -- sender lifecycle: claim leases, mark retries with backoff, then gives up visibly
  delete from public.notifications;
  a := public.notify_owner('t.one', '{}'::jsonb);
  select count(*) into n from public.notifications_claim(10);
  perform pg_temp.ok(n = 1, 'claim hands out a due row');
  select count(*) into n from public.notifications_claim(10);
  perform pg_temp.ok(n = 0, 'a leased row is not handed out twice');
  perform public.notifications_mark(a, false, 'ntfy returned 503');
  select * into c from public.notifications where id = a;
  perform pg_temp.ok(c.status = 'failed' and c.last_error = 'ntfy returned 503' and c.next_attempt_at > now() and c.next_attempt_at <= now() + interval '2 minutes', 'first failure is recorded and retried after about a minute');
  update public.notifications set next_attempt_at = now() - interval '1 second' where id = a;
  select count(*) into n from public.notifications_claim(10);
  perform pg_temp.ok(n = 1, 'a failed row is retried when due');
  perform public.notifications_mark(a, true);
  perform pg_temp.ok((select status from public.notifications where id = a) = 'sent' and (select sent_at from public.notifications where id = a) is not null, 'a successful send is recorded');

  delete from public.notifications;
  a := public.notify_owner('t.two', '{}'::jsonb);
  for i in 1..5 loop
    update public.notifications set next_attempt_at = now() - interval '1 second' where id = a;
    perform public.notifications_claim(10);
    perform public.notifications_mark(a, false, 'still failing');
  end loop;
  select * into c from public.notifications where id = a;
  perform pg_temp.ok(c.status = 'failed' and c.attempts = 5 and c.next_attempt_at is null, 'after 5 failures it stops retrying and stays failed');

  -- a sender that died mid-way cannot leave a row hidden
  delete from public.notifications;
  a := public.notify_owner('t.three', '{}'::jsonb);
  update public.notifications set attempts = 5, next_attempt_at = now() - interval '1 minute' where id = a;
  perform public.notifications_claim(10);
  perform pg_temp.ok((select status from public.notifications where id = a) = 'failed', 'a row abandoned after 5 attempts is swept to failed');

  -- access: signed-in people cannot queue, claim or read
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  failed := false; begin perform public.notify_owner('x.y', '{}'::jsonb); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a signed-in user cannot call notify_owner directly');
  failed := false; begin perform * from public.notifications_claim(1); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a signed-in user cannot claim notifications');
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'a junior sees no notifications');
  perform pg_temp.ok(public.notifications_attention() is null, 'a junior gets no attention data');
  failed := false; begin perform public.notifications_ack(a); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a junior cannot acknowledge');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.notifications_attention() is null, 'the owner without the second factor sees nothing');
  reset role;

  -- the owner's Needs attention data
  delete from public.notifications;
  insert into public.notifications(kind, status, attempts, last_error) values ('t.failed', 'failed', 5, 'boom');
  insert into public.notifications(kind, status, created_at) values ('t.stuck', 'pending', now() - interval '20 minutes');
  insert into public.notifications(kind, status, created_at) values ('t.fresh', 'pending', now());
  insert into public.notifications(kind, status, sent_at) values ('t.sent', 'sent', now());
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  att := public.notifications_attention();
  perform pg_temp.ok((att->>'failed')::int = 1 and (att->>'stuck')::int = 1 and jsonb_array_length(att->'items') = 2, 'attention shows failed and long-unsent alerts only');
  select id into a from public.notifications where kind = 't.failed';
  perform public.notifications_ack(a);
  att := public.notifications_attention();
  perform pg_temp.ok((att->>'failed')::int = 0 and jsonb_array_length(att->'items') = 1, 'acknowledging clears an alert from attention');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'notification.acked') = 1, 'the acknowledgement is audited');
  reset role;

  -- acknowledging frees the dedupe key
  delete from public.notifications;
  set local role service_role;
  a := public.notify_owner('d.k', jsonb_build_object('dedupe_key', 'k2'));
  update public.notifications set acked_at = now() where id = a;
  perform pg_temp.ok(public.notify_owner('d.k', jsonb_build_object('dedupe_key', 'k2')) is not null, 'after acknowledgement the same alert can be raised again');

  -- feed watchdog
  delete from public.notifications;
  perform public.ops_check_inventory_feed();
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'no alert before the feed has ever synced');
  reset role;
  insert into public.inventory_sync_log(synced_at, status) values (now() - interval '5 hours', 'ok');
  set local role service_role;
  perform public.ops_check_inventory_feed();
  perform public.ops_check_inventory_feed();
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'inventory.sync_stale') = 1, 'a stale feed raises one alert per day');
  reset role;
  insert into public.inventory_sync_log(synced_at, status) values (now(), 'ok');
  delete from public.notifications;
  set local role service_role;
  perform public.ops_check_inventory_feed();
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'a recent successful sync raises nothing');
end $t$;
rollback;
