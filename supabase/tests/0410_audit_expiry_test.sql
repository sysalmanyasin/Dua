-- Tests for 0410_audit_expiry (Audit slice C1 (Expiry)). Invented people and products only.
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
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.suggest', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.expiry_log', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.expiry_log', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c3', 'audit.expiry_log', 'grant', 'test');
reset role;
insert into public.inventory_products (code, name, company, qty, price, generic) values
 ('A1', 'Alpha one', 'Acme', 10, 100.50, 'alphamol'), ('B1', 'Beta 50% syrup', 'Beta', 8, 55, ''), ('C1', 'Cura one', 'Cura', 40, 3, '');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
create temp table m (k text primary key, v text);
grant all on m to authenticated, anon;
insert into m select 'now', public.audit_expiry_month(0);
insert into m select 'p2', public.audit_expiry_month(2);
insert into m select 'p5', public.audit_expiry_month(5);
insert into m select 'm4', public.audit_expiry_month(-4);
insert into m select 'p37', public.audit_expiry_month(37);
insert into ids select 'pA1', id from public.inventory_products where code = 'A1';
insert into ids select 'pB1', id from public.inventory_products where code = 'B1';
insert into ids select 'pC1', id from public.inventory_products where code = 'C1';
\set c1 '00000000-0000-0000-0000-0000000000c1'
\set c2 '00000000-0000-0000-0000-0000000000c2'
\set c3 '00000000-0000-0000-0000-0000000000c3'
\set d1 '00000000-0000-0000-0000-0000000000d1'
\set own '00000000-0000-0000-0000-0000000000a1'

-- ── who may use Expiry ──
select pg_temp.as_user(:'d1');
select pg_temp.refused('select public.audit_expiry_overview()', 'not_allowed', 'audit.view alone does not open Expiry');
select pg_temp.refused($q$select * from public.audit_expiry_search()$q$, 'not_allowed', 'nor the register');
select pg_temp.refused($q$select * from public.audit_expiry_products('alpha')$q$, 'not_allowed', 'nor the product search');
select pg_temp.ok((select count(*) from public.audit_racks) = 0, 'nor a direct read of racks');
reset role;
select pg_temp.as_user(:'c1');
select pg_temp.refused($q$select public.audit_rack_save(null, 'Rack X')$q$, 'not_allowed', 'a logger cannot make racks');
select pg_temp.refused($q$select * from public.audit_expiry_people()$q$, 'not_allowed', 'nor list people');
reset role;

-- ── racks ──
select pg_temp.as_user(:'own', 'aal2');
insert into ids select 'rA2', public.audit_rack_save(null, ' Rack A2 ');
insert into ids select 'rCold', public.audit_rack_save(null, 'Cold Chain 1');
select pg_temp.refused($q$select public.audit_rack_save(null, 'rack a2')$q$, 'rack_exists', 'a rack name is unique, ignoring case and spaces');
select pg_temp.refused($q$select public.audit_rack_save(null, '   ')$q$, 'rack_name_invalid', 'a rack needs a name');
select pg_temp.refused(format($q$select public.audit_rack_save(%L, 'cold chain 1')$q$, (select v from ids where k = 'rA2')), 'rack_exists', 'a rename cannot take another rack''s name');
select public.audit_rack_save((select v from ids where k = 'rA2'), 'Rack A2 (front)');
select public.audit_rack_save((select v from ids where k = 'rA2'), 'Rack A2');
insert into ids select 'rOld', public.audit_rack_save(null, 'Old Rack', false);
select pg_temp.ok((select count(*) from public.audit_racks) = 3, 'three racks exist');
select pg_temp.ok((select can_log from public.audit_expiry_people() where username = 'count1'), 'people list shows who holds the logging key');
select pg_temp.ok(not (select can_log from public.audit_expiry_people() where username = 'dep1'), 'and who does not');

-- ── monthly assignment ──
select pg_temp.refused(format($q$select public.audit_rack_assign(%L, %L, 'soon')$q$, (select v from ids where k = 'rA2'), :'c1'), 'month_invalid', 'a month must look like YYYY-MM');
select pg_temp.refused(format($q$select public.audit_rack_assign(%L, %L, %L)$q$, (select v from ids where k = 'rOld'), :'c1', (select v from m where k = 'now')), 'rack_inactive', 'a switched-off rack cannot be given out');
select pg_temp.refused(format($q$select public.audit_rack_assign(%L, %L, %L)$q$, (select v from ids where k = 'rA2'), :'c3', (select v from m where k = 'now')), 'person_invalid', 'a disabled account cannot be given a rack');
select pg_temp.refused(format($q$select public.audit_rack_assign(%L, %L, %L)$q$, gen_random_uuid(), :'c1', (select v from m where k = 'now')), 'rack_not_found', 'an unknown rack is refused');
insert into ids select 'asg', public.audit_rack_assign((select v from ids where k = 'rA2'), :'c1', (select v from m where k = 'now'));
select public.audit_rack_assign((select v from ids where k = 'rA2'), :'c2', (select v from m where k = 'now'));
select pg_temp.ok((select count(*) from public.audit_rack_assignments where month = (select v from m where k = 'now')) = 1
  and (select staff_name from public.audit_rack_assignments where month = (select v from m where k = 'now')) = 'Count Two', 'giving a rack again in a month replaces who has it');
select public.audit_rack_assign((select v from ids where k = 'rA2'), :'c1', (select v from m where k = 'now'));
reset role;
select pg_temp.as_user(:'c1');
select pg_temp.refused(format($q$select public.audit_rack_assign(%L, %L, %L)$q$, (select v from ids where k = 'rA2'), :'c1', (select v from m where k = 'now')), 'not_allowed', 'a logger cannot give out racks');
select pg_temp.refused(format($q$select public.audit_rack_unassign(%L)$q$, (select v from ids where k = 'asg')), 'not_allowed', 'nor take them back');
select pg_temp.ok((public.audit_expiry_overview() -> 'my_racks') = '["Rack A2"]'::jsonb, 'a person with a rack this month is offered only that rack');
select pg_temp.ok(jsonb_array_length(public.audit_expiry_overview() -> 'assignments') = 1, 'everyone sees this month''s assignments');
reset role;
select pg_temp.as_user(:'c2');
select pg_temp.ok(jsonb_array_length(public.audit_expiry_overview() -> 'my_racks') = 2, 'a person with no rack this month is offered every active rack');
reset role;
select pg_temp.as_user(:'own', 'aal2');
select pg_temp.ok(jsonb_array_length(public.audit_expiry_overview() -> 'my_racks') = 2, 'the owner is offered every active rack');
select pg_temp.ok(jsonb_array_length(public.audit_expiry_overview((select v from m where k = 'p2')) -> 'assignments') = 0, 'another month has no assignments');
select pg_temp.refused($q$select public.audit_expiry_overview('2026-13')$q$, 'month_invalid', 'a bad month is refused');
reset role;

-- ── product search ──
select pg_temp.as_user(:'c1');
select pg_temp.ok((select count(*) from public.audit_expiry_products('alpha')) = 1, 'a logger finds a product by name');
select pg_temp.ok((select count(*) from public.audit_expiry_products('ALPHAMOL')) = 1, 'or by generic name');
select pg_temp.ok((select count(*) from public.audit_expiry_products('a')) = 0, 'one letter returns nothing');
select pg_temp.ok((select count(*) from public.audit_expiry_products('%%')) = 0, 'a percent sign is not a wildcard');
select pg_temp.ok((select count(*) from public.audit_expiry_products('50%')) = 1, 'but still matches a real percent sign');
reset role;

-- ── logging ──
select pg_temp.as_user(:'c1');
select pg_temp.ok(public.audit_expiry_log('80000000-0000-0000-0000-000000000001', (select v from ids where k = 'pA1'), 12, (select v from m where k = 'p2'), 'rack a2') is not null,
  'a logger saves an entry on their own rack (rack name matched ignoring case)');
select pg_temp.ok(public.audit_expiry_log('80000000-0000-0000-0000-000000000001', (select v from ids where k = 'pA1'), 12, (select v from m where k = 'p2'), 'rack a2')
  = (select id from public.audit_expiry_entries limit 1) and (select count(*) from public.audit_expiry_entries) = 1, 'sending the same save again returns the same entry');
select pg_temp.ok((select product_name = 'Alpha one' and product_code = 'A1' and quantity = 12 and status = 'Near Expiry' and locked and rack_location = 'Rack A2' and staff_name = 'Count One'
  from public.audit_expiry_entries), 'the entry takes name and code from Inventory, the rack as listed, and is locked');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Cold Chain 1')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'rack_not_yours', 'a logger with a rack this month cannot use another');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 0, %L, 'Rack A2')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'quantity_invalid', 'quantity must be above zero');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Rack A2')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'm4')), 'month_invalid', 'four months back is too far');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Rack A2')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p37')), 'month_invalid', 'more than three years ahead is refused');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Rack A2', 'Lost')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'status_invalid', 'an unknown status is refused');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Rack A2')$q$, gen_random_uuid(), (select v from m where k = 'p2')), 'product_not_found', 'an unknown product is refused');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Shelf Z')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'rack_invalid', 'a rack that is not on the list is refused');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000002', %L, 5, %L, 'Old Rack')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'rack_invalid', 'a switched-off rack is refused');
select pg_temp.refused(format($q$select public.audit_expiry_log(null, %L, 5, %L, 'Rack A2')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'key_required', 'a save needs its key');
select pg_temp.fails($q$insert into public.audit_expiry_entries (client_key, user_id, staff_name, product_name, quantity, expiry_month, rack_location) values (gen_random_uuid(), auth.uid(), 'x', 'x', 1, '2027-01', 'x')$q$, 'no direct write of entries');
select pg_temp.fails($q$update public.audit_expiry_entries set quantity = 1$q$, 'no direct edit of entries');
select pg_temp.refused(format($q$select public.audit_expiry_reopen(%L)$q$, (select id from public.audit_expiry_entries limit 1)), 'not_allowed', 'a logger cannot reopen a locked entry');
select pg_temp.refused(format($q$select public.audit_expiry_delete(%L, 'oops')$q$, (select id from public.audit_expiry_entries limit 1)), 'not_allowed', 'nor delete it');
reset role;
select pg_temp.as_user(:'c2');
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000001', %L, 3, %L, 'Cold Chain 1')$q$, (select v from ids where k = 'pB1'), (select v from m where k = 'p5')), 'key_taken', 'a key used by someone else is refused');
select pg_temp.ok(public.audit_expiry_log('80000000-0000-0000-0000-000000000003', (select v from ids where k = 'pB1'), 3, (select v from m where k = 'p5'), 'Cold Chain 1', 'Sold') is not null,
  'a person with no rack this month may use any active rack');
reset role;

-- ── the shared register ──
select pg_temp.as_user(:'c2');
select pg_temp.ok((select count(*) from public.audit_expiry_search()) = 2, 'everyone who uses Expiry sees every entry');
select pg_temp.ok((select min(expiry_month) from public.audit_expiry_search()) = (select v from m where k = 'p2'), 'ordered by expiry month');
select pg_temp.ok((select count(*) from public.audit_expiry_search('alpha')) = 1, 'search by product name');
select pg_temp.ok((select count(*) from public.audit_expiry_search('B1')) = 1, 'search by code');
select pg_temp.ok((select count(*) from public.audit_expiry_search(null, (select v from m where k = 'p5'))) = 1, 'filter by month');
select pg_temp.ok((select count(*) from public.audit_expiry_search(null, null, 'Sold')) = 1, 'filter by status');
select pg_temp.ok((select count(*) from public.audit_expiry_search('')) = 2, 'an empty search lists everything');
select pg_temp.ok((select count(*) from public.audit_expiry_search(null, null, null, 1, 0)) = 1 and (select max(total) from public.audit_expiry_search(null, null, null, 1, 0)) = 2, 'paging returns one row and the total');
reset role;

-- ── owner: reopen, edit, delete ──
select pg_temp.as_user(:'own', 'aal2');
insert into ids select 'e1', id from public.audit_expiry_entries where product_code = 'A1';
select pg_temp.refused(format($q$select public.audit_expiry_update(%L, 10, %L, 'Rack A2', 'Near Expiry')$q$, (select v from ids where k = 'e1'), (select v from m where k = 'p2')), 'entry_locked', 'a locked entry cannot be edited before it is reopened');
select public.audit_expiry_reopen((select v from ids where k = 'e1'));
select pg_temp.ok(not (select locked from public.audit_expiry_entries where id = (select v from ids where k = 'e1')), 'the owner reopens an entry');
select pg_temp.refused(format($q$select public.audit_expiry_update(%L, 10, %L, 'Shelf Z', 'Near Expiry')$q$, (select v from ids where k = 'e1'), (select v from m where k = 'p2')), 'rack_invalid', 'an edit needs a listed rack');
select pg_temp.refused(format($q$select public.audit_expiry_update(%L, -1, %L, 'Rack A2', 'Near Expiry')$q$, (select v from ids where k = 'e1'), (select v from m where k = 'p2')), 'quantity_invalid', 'and a real quantity');
select public.audit_expiry_update((select v from ids where k = 'e1'), 10, (select v from m where k = 'p5'), 'Cold Chain 1', 'Discarded');
select pg_temp.ok((select locked and quantity = 10 and expiry_month = (select v from m where k = 'p5') and rack_location = 'Cold Chain 1' and status = 'Discarded' from public.audit_expiry_entries where id = (select v from ids where k = 'e1')),
  'saving an edit changes the entry and locks it again');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'audit.expiry_edited' and (old_value ->> 'qty')::numeric = 12 and (new_value ->> 'qty')::numeric = 10), 'the edit is logged with the old and new values');
select pg_temp.refused(format($q$select public.audit_expiry_delete(%L, 'x')$q$, (select v from ids where k = 'e1')), 'reason_required', 'deleting needs a reason');
select public.audit_expiry_delete((select v from ids where k = 'e1'), 'entered twice');
select pg_temp.ok((select count(*) from public.audit_expiry_entries) = 1, 'the owner deletes an entry');
select pg_temp.refused(format($q$select public.audit_expiry_delete(%L, 'again')$q$, (select v from ids where k = 'e1')), 'entry_not_found', 'a deleted entry is gone');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'audit.expiry_deleted' and reason = 'entered twice'), 'the delete is logged with its reason');
select public.audit_rack_unassign((select v from ids where k = 'asg'));
select pg_temp.ok((select count(*) from public.audit_rack_assignments) = 0, 'the owner takes a rack back');
select public.audit_rack_save((select v from ids where k = 'rA2'), 'Rack A2', false);
select pg_temp.refused(format($q$select public.audit_expiry_log('80000000-0000-0000-0000-000000000009', %L, 5, %L, 'Rack A2')$q$, (select v from ids where k = 'pA1'), (select v from m where k = 'p2')), 'rack_invalid', 'a switched-off rack is no longer offered');
reset role;
select pg_temp.ok((select count(distinct action) from public.activity_log where action in ('audit.rack_saved', 'audit.rack_assigned', 'audit.expiry_logged', 'audit.expiry_reopened')) = 4, 'racks, assignments, entries and reopens are all in the log');

-- ── anon holds nothing ──
set local role anon;
select pg_temp.fails($q$select * from public.audit_expiry_entries$q$, 'anon cannot read entries');
select pg_temp.fails($q$select public.audit_expiry_overview()$q$, 'anon cannot call the functions');
reset role;
rollback;
select 'pass: 0410 complete';
