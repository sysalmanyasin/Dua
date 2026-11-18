-- Tests for 0406_audit_counting_reads_individual (Audit slice A5). Invented people and products only.
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
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.individual', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.templates', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.individual', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.count', 'grant', 'test');
reset role;


create or replace function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select v.code, v.name, v.company, v.qty, v.price from (values
    ('A1', 'Alpha one', 'Acme', 10::numeric, 100.50::numeric), ('A2', 'Alpha two', 'Acme', 5::numeric, 20::numeric),
    ('B1', 'Beta one', 'Beta', 8::numeric, 55::numeric), ('C1', 'Cura one', 'Cura', 40::numeric, 3::numeric)
  ) v (code, name, company, qty, price) where (p_scope -> 'codes') ? v.code $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- ── templates ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
insert into ids select 'tpl', public.audit_template_save(null, 'Weekly fast movers', array['A1', 'A2', ' A1 ', '']);
select pg_temp.ok((select cardinality(codes) from public.audit_templates where id = (select v from ids where k = 'tpl')) = 2, 'a template keeps distinct, trimmed codes');
select pg_temp.refused($$select public.audit_template_save(null, 'weekly FAST movers', array['B1'])$$, 'template_name_taken', 'template names are unique ignoring case');
select pg_temp.refused($$select public.audit_template_save(null, 'x', array['B1'])$$, 'invalid_template', 'a template needs a real name');
select pg_temp.refused($$select public.audit_template_save(null, 'Empty one', array[' ', ''])$$, 'invalid_template', 'a template needs at least one code');
select public.audit_template_save((select v from ids where k = 'tpl'), 'Weekly fast movers', array['A1', 'A2', 'B1']);
select pg_temp.ok((select cardinality(codes) from public.audit_templates) = 3, 'a template can be changed');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_templates) = 1, 'a person with Individual Audit can read templates');
select pg_temp.refused($$select public.audit_template_save(null, 'Mine', array['A1'])$$, 'not_allowed', 'a person without the templates permission cannot save one');
select pg_temp.refused($$select public.audit_template_delete(gen_random_uuid())$$, 'not_allowed', 'nor delete one');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.ok((select count(*) from public.audit_templates) = 0, 'a counter with neither permission reads no templates');
reset role;

-- ── Individual Audit ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid(), array['A1'])$$, 'not_allowed', 'counting alone is not enough to start an Individual Audit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid(), array[' '])$$, 'invalid_codes', 'it needs at least one code');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid(), array['ZZ9'])$$, 'no_items', 'codes that match no product give no_items');
reset role;
select pg_temp.ok((select count(*) from public.audit_rounds) = 0, 'a refused start leaves nothing behind');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'r1', (public.audit_individual_start('80000000-0000-0000-0000-000000000001', array['A1', 'B1', 'ZZ9']) ->> 'round_id')::uuid;
insert into ids select 'asg1', (public.audit_individual_start('80000000-0000-0000-0000-000000000001', array['A1', 'B1', 'ZZ9']) ->> 'assignment_id')::uuid;
reset role;
select pg_temp.ok((select count(*) from public.audit_rounds) = 1, 'repeating the key makes no second round');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
reset role;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'counting', 'a self-pick goes straight to counting');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_my_items((select v from ids where k = 'asg1'))) = 2, 'only the codes found become items (A1 and B1)');
select pg_temp.refused($$select public.audit_individual_start(gen_random_uuid(), array['A2'])$$, 'self_pick_open', 'one open Individual Audit at a time');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused($$select public.audit_individual_start('80000000-0000-0000-0000-000000000001', array['A1'])$$, 'key_in_use', 'someone else cannot reuse a key');
insert into ids select 'r2', (public.audit_individual_start('80000000-0000-0000-0000-000000000002', null, (select v from ids where k = 'tpl')) ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select count(distinct engagement_id) from public.audit_rounds) = 1, 'both people share one rolling engagement this month');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
reset role;
select pg_temp.ok((select template_name from public.audit_assignments where round_id = (select v from ids where k = 'r2')) = 'Weekly fast movers', 'a template start remembers the template name');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
reset role;
select pg_temp.ok((select count(*) from public.audit_engagements where scope_type = 'individual') = 1, 'exactly one Individual engagement exists');

-- ── what a counter reads and counts ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_my_assignments()) = 1, 'a counter sees only their own assignment');
select pg_temp.ok((select items from public.audit_my_assignments()) = 2 and (select counted from public.audit_my_assignments()) = 0, 'it shows 2 items and none counted yet');
select pg_temp.ok((select retail_price from public.audit_my_items((select v from ids where k = 'asg1')) where code = 'A1') = 100.50, 'a counter sees the retail price (AUD-5)');
select pg_temp.ok((select system_qty from public.audit_my_items((select v from ids where k = 'asg1')) where code = 'A1') = 10, 'and the system quantity (AUD-4)');
select public.audit_count_batch((select v from ids where k = 'asg1'), jsonb_build_array(
  jsonb_build_object('event_id', '90000000-0000-0000-0000-000000000001', 'item', (select round_item_id from public.audit_my_items((select v from ids where k = 'asg1')) where code = 'A1'), 'qty', 7),
  jsonb_build_object('event_id', '90000000-0000-0000-0000-000000000002', 'item', (select round_item_id from public.audit_my_items((select v from ids where k = 'asg1')) where code = 'A1'), 'qty', 9)));
select pg_temp.ok((select counted_qty from public.audit_my_items((select v from ids where k = 'asg1')) where code = 'A1') = 9, 'the latest count shows on the item');
select pg_temp.ok((select counted_qty from public.audit_my_items((select v from ids where k = 'asg1')) where code = 'B1') is null, 'an item not yet counted shows no count');
select pg_temp.ok((select counted from public.audit_my_assignments()) = 1, 'progress counts items, not events');
select pg_temp.ok((select count(*) from public.audit_my_items((select v from ids where k = 'asg1'), 0, 1)) = 1, 'a page can be one item');
select pg_temp.ok((select code from public.audit_my_items((select v from ids where k = 'asg1'), 1, 1)) = 'B1', 'the next page starts after the given position');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused(format($$select * from public.audit_my_items(%L)$$, (select v from ids where k = 'asg1')), 'not_allowed', 'a counter cannot read another person''s items');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.audit_submit((select v from ids where k = 'asg1'));
insert into ids select 'r3', (public.audit_individual_start('80000000-0000-0000-0000-000000000003', array['C1']) ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select round_number from public.audit_rounds where id = (select v from ids where k = 'r3')) = 3, 'after submitting, a new self-pick is allowed and numbered on');
reset role;
rollback;
