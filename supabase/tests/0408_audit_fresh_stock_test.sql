-- Tests for 0408_audit_fresh_stock (Audit follow-up rounds on fresh stock, Individual Audit by company). Invented people and products only.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.refused(sql text, want text, msg text) returns void language plpgsql as $$
declare h text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint;
    if h is distinct from want then raise exception 'FAIL (code "%", wanted "%", message "%"): %', h, want, sqlerrm, msg; end if;
    raise notice 'pass (refused with %): %', want, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'pass (refused): %', msg; return; end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1', 'owner@t'), ('00000000-0000-0000-0000-0000000000d1', 'dep1@t'),
 ('00000000-0000-0000-0000-0000000000d2', 'dep2@t'), ('00000000-0000-0000-0000-0000000000c1', 'c1@t'),
 ('00000000-0000-0000-0000-0000000000c2', 'c2@t'), ('00000000-0000-0000-0000-0000000000c3', 'c3@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'owner', 'Test Owner');
insert into public.staff (id, full_name) values
 ('10000000-0000-0000-0000-0000000000d1', 'Dep One'), ('10000000-0000-0000-0000-0000000000d2', 'Dep Two'),
 ('10000000-0000-0000-0000-0000000000c1', 'Count One'), ('10000000-0000-0000-0000-0000000000c2', 'Count Two'),
 ('10000000-0000-0000-0000-0000000000c3', 'Count Gone');
insert into public.profiles (user_id, staff_id, username, role_template, disabled_at) values
 ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'dep1', 'senior', null),
 ('00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', 'dep2', 'senior', null),
 ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'count1', 'junior', null),
 ('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'count2', 'junior', null),
 ('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c3', 'count3', 'junior', now());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.individual', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.count', 'grant', 'test');
reset role;

-- Inventory stand-in whose stock the test can change between rounds
create table public.fx_stock (code text, name text, company text, qty numeric, price numeric);
insert into public.fx_stock values ('A1', 'Alpha one', 'Acme', 10, 100.50), ('A2', 'Alpha two', 'Acme', 5, 20),
  ('B1', 'Beta one', 'Beta', 8, 55), ('D1', 'Dova one', 'Dova', 2, 200);
create function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select s.code, s.name, s.company, s.qty, s.price from public.fx_stock s
  where (p_scope -> 'codes') ? s.code or (p_scope -> 'companies') ? s.company $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
create function pg_temp.count_all(p_asg uuid, p_minus numeric) returns void language plpgsql as $$
declare r record; ev jsonb := '[]';
begin
  for r in select * from public.audit_my_items(p_asg) loop
    ev := ev || jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', r.round_item_id, 'qty', greatest(r.system_qty - p_minus, 0)));
  end loop;
  perform public.audit_count_batch(p_asg, ev);
end $$;

-- ── round 1 on today's stock, counted one short on every item, compiled ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('70000000-0000-0000-0000-000000000001', 'Fresh stock audit', 'full');
insert into ids select 'r1', public.audit_round_create('70000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'item',
  '{"codes": ["A1", "A2", "B1", "D1"]}');
select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'volume');
select public.audit_round_lock((select v from ids where k = 'r1'));
select public.audit_round_start((select v from ids where k = 'r1'));
reset role;
insert into ids select 'a1', id from public.audit_assignments where round_id = (select v from ids where k = 'r1');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.count_all((select v from ids where k = 'a1'), 1);
select public.audit_submit((select v from ids where k = 'a1'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_compile_round((select v from ids where k = 'r1'));
reset role;

-- ── stock moves on: A1 changes quantity, price and name; D1 is discontinued; a new Acme product arrives ──
update public.fx_stock set qty = 25, price = 120, name = 'Alpha one forte' where code = 'A1';
delete from public.fx_stock where code = 'D1';
insert into public.fx_stock values ('A3', 'Alpha three', 'Acme', 4, 15);

-- ── differences: current figures, discontinued items keep their old ones ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'r1a', (public.audit_round_next(gen_random_uuid(), (select v from ids where k = 'r1'), 'differences') ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select system_qty from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'A1') = 25, 'a carried item takes today''s system quantity');
select pg_temp.ok((select retail_price from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'A1') = 120, 'and today''s price');
select pg_temp.ok((select name from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'A1') = 'Alpha one forte', 'and today''s name');
select pg_temp.ok((select system_qty from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'D1') = 2, 'a discontinued product keeps its earlier quantity');
select pg_temp.ok((select retail_price from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'D1') = 200, 'and its earlier price');
select pg_temp.ok((select prev_variance from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'A1') = -1, 'last round''s difference is kept as history');
select pg_temp.ok((select prev_counted from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'A1') = 9, 'with what was counted then');
select pg_temp.ok(not exists (select 1 from public.audit_round_items where round_id = (select v from ids where k = 'r1a') and code = 'A3'), 'differences mode adds no new products');
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1a')) = 4, 'every differing item is carried');

-- ── company: refreshed, plus products that are new in those companies ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'r1b', (public.audit_round_next(gen_random_uuid(), (select v from ids where k = 'r1'), 'company') ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1b') and is_new) = 1, 'company mode adds the new Acme product');
select pg_temp.ok((select code from public.audit_round_items where round_id = (select v from ids where k = 'r1b') and is_new) = 'A3', 'it is A3');
select pg_temp.ok((select system_qty from public.audit_round_items where round_id = (select v from ids where k = 'r1b') and code = 'A3') = 4, 'with today''s quantity');
select pg_temp.ok((select prev_variance is null and prev_counted is null and source_item_id is null from public.audit_round_items where round_id = (select v from ids where k = 'r1b') and code = 'A3'), 'and no history, because it was never counted');
select pg_temp.ok((select system_qty from public.audit_round_items where round_id = (select v from ids where k = 'r1b') and code = 'A2') = 5, 'items that did not change keep their figures');
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1b')) = 5, 'A1, A2, A3, B1 and the discontinued D1');

-- ── spot: current figures, nothing new ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'r1c', (public.audit_round_next(gen_random_uuid(), (select v from ids where k = 'r1'), 'spot', 4, 'seed-x') ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1c')) = 4, 'a spot check draws from the earlier round');
select pg_temp.ok((select system_qty from public.audit_round_items where round_id = (select v from ids where k = 'r1c') and code = 'A1') = 25, 'and reads current stock');
select pg_temp.ok(not exists (select 1 from public.audit_round_items where round_id = (select v from ids where k = 'r1c') and is_new), 'and adds nothing new');

-- ── the counter sees the history ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_assign_auto((select v from ids where k = 'r1a'), array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'volume');
select public.audit_round_lock((select v from ids where k = 'r1a'));
select public.audit_round_start((select v from ids where k = 'r1a'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select prev_counted from public.audit_my_items((select id from public.audit_assignments where round_id = (select v from ids where k = 'r1a') limit 1)) where code = 'A1') = 9, 'a counter sees what was counted last time');
select pg_temp.ok((select count(*) from public.audit_my_items((select id from public.audit_assignments where round_id = (select v from ids where k = 'r1a') limit 1)) where is_new) = 0, 'and which items are new');
reset role;

-- ── Individual Audit by company ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid())$$, 'invalid_codes', 'choose a template, codes or companies');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid(), '{}', null, array['Nobody Ltd'])$$, 'no_items', 'a company with no stock gives no_items');
insert into ids select 'ind', (public.audit_individual_start('72000000-0000-0000-0000-000000000001', '{}', null, array['Acme', ' Acme ']) ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'ind')) = 3, 'a company pick takes every product the company has today');
select pg_temp.ok((select template_name is null from public.audit_assignments where round_id = (select v from ids where k = 'ind')), 'and has no template name');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'ind')) = 'counting', 'it starts counting at once');
select pg_temp.ok((select scope_month from public.audit_engagements where id = (select engagement_id from public.audit_rounds where id = (select v from ids where k = 'ind')))
  = to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM'), 'it sits in the current month''s rolling engagement');
select pg_temp.ok((select count(*) from public.audit_engagements where scope_type = 'individual') = 1, 'one rolling Individual engagement exists');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid(), '{}', null, array['Beta'])$$, 'self_pick_open', 'still one open pick per person');
reset role;
rollback;
