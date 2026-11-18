\set ON_ERROR_STOP on
-- 0307: the whole-body entry point of the hourly sync. It must do exactly what inventory_apply_sync() does, read its
-- options from "meta", and be callable by the service role only.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b1', 'b@t');

do $t$ declare r jsonb; r2 jsonb; body jsonb; n0 int; begin
  -- shape of the function: ONE unnamed jsonb parameter (this is what makes PostgREST pass the body whole)
  perform pg_temp.ok((select pronargs from pg_proc where oid = 'public.inventory_apply_sync_body(jsonb)'::regprocedure) = 1
    and (select proargnames from pg_proc where oid = 'public.inventory_apply_sync_body(jsonb)'::regprocedure) is null,
    'the entry point has a single unnamed parameter');

  -- first sync through the new entry point, with options in meta
  body := jsonb_build_object(
    'meta', jsonb_build_object('source', 'dropbox', 'triggered_by', null, 'force', false, 'content_hash', 'hash-1'),
    'products', jsonb_build_array(
      jsonb_build_object('code', 'A1', 'name', 'Item A1', 'qty', 5, 'price', 10, 'conversion_factor', 10, 'pack_valid', true),
      jsonb_build_object('code', 'A2', 'name', 'Item A2', 'qty', 7, 'price', 20)),
    'payment_summary', jsonb_build_array(jsonb_build_object('sale_day', '2026-11-16', 'cash_sale', 100, 'card_sale', 50, 'credit_sale', 25, 'total_sale', 175)));
  set local role service_role; r := public.inventory_apply_sync_body(body); reset role;
  perform pg_temp.ok((r->>'ok')::boolean and r->>'result' = 'changed' and (r->>'added')::int = 2, 'two products added through the entry point');
  perform pg_temp.ok((r->>'paymentSummaryCount')::int = 1, 'the small tables travel in the same body');
  perform pg_temp.ok((select content_hash from public.inventory_sync_state) = 'hash-1', 'meta.content_hash is stored');
  perform pg_temp.ok((select source from public.inventory_sync_log order by synced_at desc, id desc limit 1) = 'dropbox'
    and (select triggered_by from public.inventory_sync_log order by synced_at desc, id desc limit 1) is null, 'meta.source is logged and a null triggered_by stays null');
  perform pg_temp.ok((select count(*) from public.inventory_products where code in ('A1', 'A2')) = 2, 'both rows exist and the meta key created nothing else');

  -- the same body again: nothing changes (identical to the direct call)
  set local role service_role; r2 := public.inventory_apply_sync_body(body); reset role;
  perform pg_temp.ok(r2->>'result' = 'unchanged' and (r2->>'unchanged')::int = 2 and (r2->>'seqStock')::int = (r->>'seqStock')::int,
    'an identical second body changes nothing and does not move the counters');

  -- parity: the direct call with the same payload gives the same numbers
  set local role service_role; r2 := public.inventory_apply_sync(body, 'dropbox', null, false, 'hash-1'); reset role;
  perform pg_temp.ok(r2->>'result' = 'unchanged' and (r2->>'count')::int = 2, 'direct call and entry point agree');

  -- a person who started the run is recorded
  set local role service_role;
  perform public.inventory_apply_sync_body(jsonb_set(body, '{meta}', jsonb_build_object('source', 'dropbox', 'triggered_by', '00000000-0000-0000-0000-0000000000b1', 'content_hash', 'hash-2')));
  reset role;
  perform pg_temp.ok((select triggered_by from public.inventory_sync_log order by synced_at desc, id desc limit 1) = '00000000-0000-0000-0000-0000000000b1', 'meta.triggered_by is logged');
  perform pg_temp.ok((select content_hash from public.inventory_sync_state) = 'hash-2', 'the new hash replaces the old one');

  -- no meta at all: defaults apply (source dropbox, not forced, no hash)
  set local role service_role;
  r := public.inventory_apply_sync_body(jsonb_build_object('products', body -> 'products'));
  reset role;
  perform pg_temp.ok((r->>'ok')::boolean, 'a body without meta still works');
  perform pg_temp.ok((select source from public.inventory_sync_log order by synced_at desc, id desc limit 1) = 'dropbox', 'the source defaults to dropbox');

  -- the 20% guard still applies, and meta.force lifts it (the refusal path is the same code as the direct call)
  insert into public.inventory_products (code, name, active, row_hash_stock, row_hash_sales, seq_stock, seq_sales)
    select 'Z' || g, 'Extra ' || g, true, 'x', 'y', 100 + g, 100 + g from generate_series(1, 8) g;
  set local role service_role;
  r := public.inventory_apply_sync_body(jsonb_build_object('meta', jsonb_build_object('force', false), 'products', body -> 'products'));
  reset role;
  perform pg_temp.ok((r->>'refused')::boolean, 'a body that would remove over 20% is refused');
  set local role service_role;
  r := public.inventory_apply_sync_body(jsonb_build_object('meta', jsonb_build_object('force', true), 'products', body -> 'products'));
  reset role;
  perform pg_temp.ok((r->>'ok')::boolean and (r->>'removed')::int = 8, 'meta.force confirms the removal');

  -- bad bodies fail loudly, nothing is written
  select count(*) into n0 from public.inventory_products;
  set local role service_role;
  begin perform public.inventory_apply_sync_body('[]'::jsonb); perform pg_temp.ok(false, 'array body');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a body that is not an object is refused (pass: refused)'); end;
  begin perform public.inventory_apply_sync_body('{"meta": 5, "products": []}'::jsonb); perform pg_temp.ok(false, 'meta not an object');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a meta that is not an object is refused (pass: refused)'); end;
  begin perform public.inventory_apply_sync_body('{"products": []}'::jsonb); perform pg_temp.ok(false, 'empty products');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'an empty product list is refused (pass: refused)'); end;
  reset role;
  perform pg_temp.ok((select count(*) from public.inventory_products) = n0, 'refused bodies wrote nothing');

  -- who may call it
  perform pg_temp.ok(has_function_privilege('service_role', 'public.inventory_apply_sync_body(jsonb)', 'execute'), 'the service role may call it');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.inventory_apply_sync_body(jsonb)', 'execute'), 'anon may not call it');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.inventory_apply_sync_body(jsonb)', 'execute'), 'a signed-in person may not call it');
  set local role authenticated;
  begin perform public.inventory_apply_sync_body(body); perform pg_temp.ok(false, 'authenticated');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a signed-in person is refused (pass: refused)'); end;
  reset role;
end $t$;
rollback;
