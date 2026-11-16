-- Tests for 0401_audit_core (Audit slice A1). Invented people and products only.
-- Proves: permission seeds; anon and no-permission users are refused; direct writes are refused; engagement and round
-- creation are idempotent; membership scopes what deputies see; assignment splits; version conflicts; lock rules;
-- frozen items; the round state machine in both directions; revoke rules. Every refusal is checked by its machine code.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
-- refused with a specific machine code in the error hint
create function pg_temp.refused(sql text, want text, msg text) returns void language plpgsql as $$
declare h text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint;
    if h is distinct from want then raise exception 'FAIL (code "%", wanted "%"): %', h, want, msg; end if;
    raise notice 'pass (refused with %): %', want, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1', 'owner@t'), ('00000000-0000-0000-0000-0000000000d1', 'dep1@t'),
 ('00000000-0000-0000-0000-0000000000d2', 'dep2@t'), ('00000000-0000-0000-0000-0000000000c1', 'c1@t'),
 ('00000000-0000-0000-0000-0000000000c2', 'c2@t'), ('00000000-0000-0000-0000-0000000000c3', 'c3@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'owner', 'Test Owner');
insert into public.staff (id, full_name) values
 ('10000000-0000-0000-0000-0000000000d1', 'Dep One'), ('10000000-0000-0000-0000-0000000000d2', 'Dep Two'),
 ('10000000-0000-0000-0000-0000000000c1', 'Count One'), ('10000000-0000-0000-0000-0000000000c2', 'Count Two'),
 ('10000000-0000-0000-0000-0000000000c3', 'Count Three');
insert into public.profiles (user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'dep1', 'senior'),
 ('00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', 'dep2', 'senior'),
 ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'count1', 'junior'),
 ('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'count2', 'junior'),
 ('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c3', 'count3', 'junior');
-- count3 has been disabled
update public.profiles set disabled_at = now() where username = 'count3';

-- the owner shares keys: both deputies may view audits (only d1 will be added to the engagement)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.view', 'grant', 'test');
reset role;

-- 1. permission seeds
select pg_temp.ok((select count(*) from public.permissions where key like 'audit.%') = 17, '17 audit keys are seeded');
select pg_temp.ok((select array_agg(perm_key order by perm_key) from public.role_permissions where perm_key like 'audit.%')
  = array['audit.count', 'audit.count'], 'role presets carry only audit.count (junior and senior)');

-- 2. anonymous and unauthorised callers
set local role anon;
select pg_temp.fails('select * from public.audit_engagements', 'anon cannot read engagements', 'permission denied');
select pg_temp.fails($q$select public.audit_engagement_create(gen_random_uuid(), 'Anon audit', 'full')$q$, 'anon cannot create an engagement', 'permission denied');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Junior audit', 'full')$q$, 'not_allowed', 'a counter cannot create an engagement');
select pg_temp.ok((select count(*) from public.audit_engagements) = 0, 'a counter sees no engagements');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Deputy audit', 'full')$q$, 'not_allowed', 'a deputy without audit.manage cannot create an engagement');
reset role;
-- an owner who has not passed the second factor holds no keys
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'No MFA audit', 'full')$q$, 'not_allowed', 'owner without the second factor cannot create');
reset role;

-- 3. engagements: create, idempotency, validation
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('50000000-0000-0000-0000-000000000001', 'Q4 stock audit', 'selected', array['Acme', 'Beta', 'Cura', 'Acme']);
insert into ids select 'eng2', public.audit_engagement_create('50000000-0000-0000-0000-000000000001', 'Q4 stock audit', 'selected', array['Acme']);
select pg_temp.ok((select v from ids where k = 'eng') = (select v from ids where k = 'eng2'), 'the same key returns the same engagement');
select pg_temp.ok((select count(*) from public.audit_engagements) = 1, 'the same key made one engagement only');
select pg_temp.ok((select scope_companies from public.audit_engagements) = array['Acme', 'Beta', 'Cura'], 'companies are trimmed, de-duplicated and sorted');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Ab', 'full')$q$, 'invalid_scope', 'a name under 3 characters is refused');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Selected none', 'selected')$q$, 'invalid_scope', 'a selected scope needs companies');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Single two', 'single', array['A', 'B'])$q$, 'invalid_scope', 'a single scope needs exactly one company');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Individual one', 'individual')$q$, 'invalid_scope', 'individual engagements are not made here');
select pg_temp.refused($q$select public.audit_engagement_create(gen_random_uuid(), 'Odd method', 'full', '{}', '{}', 'telepathy')$q$, 'invalid_method', 'an unknown counting method is refused');
select pg_temp.refused($q$select public.audit_engagement_create(null, 'No key', 'full')$q$, 'key_required', 'a key is required');

-- 4. the browser cannot write the tables directly, even the owner at the second factor
do $t$ declare t text; begin
  foreach t in array array['audit_engagements', 'audit_members', 'audit_rounds', 'audit_round_items', 'audit_assignments', 'audit_assignment_items'] loop
    perform pg_temp.fails(format('insert into public.%I default values', t), 'owner cannot insert directly into ' || t, 'permission denied');
    perform pg_temp.fails(format('delete from public.%I', t), 'owner cannot delete directly from ' || t, 'permission denied');
  end loop;
  perform pg_temp.fails($q$update public.audit_rounds set state = 'final'$q$, 'owner cannot update a round directly', 'permission denied');
  perform pg_temp.fails($q$update public.audit_engagements set status = 'closed'$q$, 'owner cannot update an engagement directly', 'permission denied');
end $t$;

-- 5. members and what each person can see
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', 'deputy');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000c1', 'counter');
select pg_temp.refused($q$select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d2', 'boss')$q$, 'invalid_role', 'an unknown member role is refused');
select pg_temp.refused($q$select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000c3', 'counter')$q$, 'auditor_unavailable', 'a disabled person cannot be added');
select pg_temp.refused($q$select public.audit_member_set(gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', 'counter')$q$, 'engagement_not_found', 'an unknown engagement is refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_engagements) = 1, 'a deputy who was added sees the engagement');
select pg_temp.refused($q$select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', null)$q$, 'not_allowed', 'a deputy cannot change members');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok((select count(*) from public.audit_engagements) = 0, 'a deputy with audit.view but no membership sees nothing');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_members) = 1, 'a counter sees only their own membership row');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', null);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_engagements) = 0, 'removing the membership removes the view');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', 'deputy');

-- 6. rounds: no product list yet, then a stand-in for Inventory's interface
select pg_temp.refused($q$select public.audit_round_create('60000000-0000-0000-0000-000000000001', (select v from ids where k = 'eng'), 'company')$q$,
  'inventory_interface_missing', 'a round cannot be made until the inventory interface exists');
select pg_temp.ok((select count(*) from public.audit_rounds) = 0, 'the failed round left nothing behind');
reset role;
-- test-only stand-in with the agreed shape (code, name, company, qty, price); company A has a duplicate code on purpose
create function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select * from (values
    ('A1', 'Alpha one', 'Acme', 10::numeric, 100.50::numeric), ('A1', 'Alpha one dup', 'Acme', 3::numeric, 100.50::numeric),
    ('A2', 'Alpha two', 'Acme', 5::numeric, 20::numeric), ('A3', 'Alpha three', 'Acme', 0::numeric, 7.25::numeric),
    ('B1', 'Beta one', 'Beta', 8::numeric, 55::numeric), ('B2', 'Beta two', 'Beta', 2::numeric, 12::numeric),
    ('C1', 'Cura one', 'Cura', 40::numeric, 3::numeric)
  ) v (code, name, company, qty, price) $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'r1', public.audit_round_create('60000000-0000-0000-0000-000000000001', (select v from ids where k = 'eng'), 'company');
insert into ids select 'r1b', public.audit_round_create('60000000-0000-0000-0000-000000000001', (select v from ids where k = 'eng'), 'company');
select pg_temp.ok((select v from ids where k = 'r1') = (select v from ids where k = 'r1b'), 'the same key returns the same round');
select pg_temp.ok((select count(*) from public.audit_rounds) = 1, 'the same key made one round only');
select pg_temp.ok((select round_number from public.audit_rounds) = 1 and (select state from public.audit_rounds) = 'draft', 'round 1 starts as a draft');
select pg_temp.ok((select count(*) from public.audit_round_items) = 7, 'seven items were frozen into the round');
select pg_temp.ok((select count(*) from public.audit_round_items where code = 'A1') = 2, 'a duplicate code is kept, not merged away');
select pg_temp.ok((select array_agg(position order by position) from public.audit_round_items) = array[1, 2, 3, 4, 5, 6, 7], 'item positions run 1 to 7');
select pg_temp.ok((select retail_price from public.audit_round_items where code = 'A3') = 7.25, 'the retail price is kept to the paisa');
insert into ids select 'r2', public.audit_round_create('60000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'item');
select pg_temp.ok((select round_number from public.audit_rounds where id = (select v from ids where k = 'r2')) = 2, 'the next round is number 2');
insert into ids select 'r1a', public.audit_round_create('60000000-0000-0000-0000-000000000003', (select v from ids where k = 'eng'), 'company', null, 'A', (select v from ids where k = 'r1'));
select pg_temp.ok((select round_number from public.audit_rounds where id = (select v from ids where k = 'r1a')) = 1
  and (select round_suffix from public.audit_rounds where id = (select v from ids where k = 'r1a')) = 'A', 'a lettered sub-round is 1A');
select pg_temp.refused($q$select public.audit_round_create(gen_random_uuid(), (select v from ids where k = 'eng'), 'company', null, 'A', (select v from ids where k = 'r1'))$q$, 'round_exists', 'round 1A cannot be made twice');
select pg_temp.refused($q$select public.audit_round_create(gen_random_uuid(), (select v from ids where k = 'eng'), 'company', null, 'a', (select v from ids where k = 'r1'))$q$, 'invalid_suffix', 'a lower-case suffix is refused');
select pg_temp.refused($q$select public.audit_round_create(gen_random_uuid(), (select v from ids where k = 'eng'), 'company', null, 'B', null)$q$, 'base_round_required', 'a sub-round needs the round it extends');
select pg_temp.refused($q$select public.audit_round_create(gen_random_uuid(), (select v from ids where k = 'eng'), 'pallet')$q$, 'invalid_unit', 'an unknown unit is refused');
reset role;

-- 7. locking needs every item assigned
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_round_lock((select v from ids where k = 'r1'))$q$, 'items_unassigned', 'a round with unassigned items cannot be locked');
reset role;

-- 8. auto assignment
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused($q$select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1']::uuid[])$q$,
  'not_allowed', 'a deputy without audit.assign cannot assign');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c3']::uuid[])$q$,
  'auditor_unavailable', 'a disabled person cannot be assigned');
select pg_temp.refused($q$select public.audit_assign_auto((select v from ids where k = 'r1'), '{}'::uuid[])$q$, 'invalid_auditors', 'at least one auditor is needed');
select pg_temp.refused($q$select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'random')$q$, 'invalid_split', 'an unknown split is refused');
-- split by company count: Acme(4) to c1, Beta(2) to c2, Cura(1) ties and goes to the first person
select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'company');
select pg_temp.ok((select count(*) from public.audit_assignment_items where round_id = (select v from ids where k = 'r1')) = 7, 'every item is assigned');
select pg_temp.ok((select count(*) from public.audit_assignment_items i join public.audit_assignments a on a.id = i.assignment_id
  where a.auditor_id = '00000000-0000-0000-0000-0000000000c1' and a.round_id = (select v from ids where k = 'r1')) = 5, 'by company count: c1 has Acme and Cura (5 items)');
select pg_temp.ok((select count(*) from (select ri.company from public.audit_assignment_items i join public.audit_round_items ri on ri.id = i.round_item_id
  where i.round_id = (select v from ids where k = 'r1') group by ri.company having count(distinct i.assignment_id) > 1) s) = 0, 'a company is never split between people');
-- split by volume: Acme(4) to c1, Beta(2) to c2, Cura(1) goes to the lighter c2
select pg_temp.refused($q$select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'company', 1)$q$,
  'version_conflict', 'a stale version is refused');
select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'volume');
select pg_temp.ok((select count(*) from public.audit_assignment_items i join public.audit_assignments a on a.id = i.assignment_id
  where a.auditor_id = '00000000-0000-0000-0000-0000000000c1' and a.round_id = (select v from ids where k = 'r1')) = 4, 'by volume: c1 has Acme (4 items)');
select pg_temp.ok((select count(*) from public.audit_assignment_items i join public.audit_assignments a on a.id = i.assignment_id
  where a.auditor_id = '00000000-0000-0000-0000-0000000000c2' and a.round_id = (select v from ids where k = 'r1')) = 3, 'by volume: c2 has Beta and Cura (3 items)');
select pg_temp.ok((select count(*) from public.audit_assignments where round_id = (select v from ids where k = 'r1')) = 2, 'a re-split replaces the earlier draft assignments');
-- an item-unit round splits item by item
select public.audit_assign_auto((select v from ids where k = 'r2'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'company');
select pg_temp.ok((select max(n) - min(n) <= 1 from (select count(*) n from public.audit_assignment_items where round_id = (select v from ids where k = 'r2') group by assignment_id) s),
  'an item round is split evenly (difference of at most one item)');

-- 9. moving items (draft only)
select pg_temp.refused($q$select public.audit_assign_move((select v from ids where k = 'r1'), array[gen_random_uuid()], '00000000-0000-0000-0000-0000000000c1')$q$,
  'item_not_assigned', 'an item that is not in the round cannot be moved');
select pg_temp.refused($q$select public.audit_assign_move((select v from ids where k = 'r1'), array(select id from public.audit_round_items where code = 'B1'), '00000000-0000-0000-0000-0000000000c3')$q$,
  'auditor_unavailable', 'items cannot be moved to a disabled person');
select public.audit_assign_move((select v from ids where k = 'r1'), array(select id from public.audit_round_items where code = 'B1' and round_id = (select v from ids where k = 'r1')), '00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_assignment_items i join public.audit_assignments a on a.id = i.assignment_id
  where a.auditor_id = '00000000-0000-0000-0000-0000000000c1' and a.round_id = (select v from ids where k = 'r1')) = 5, 'the moved item now belongs to c1');
reset role;

-- 10. reads by role (round 1 still a draft)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_assignments) = 2, 'a counter sees only their own assignments (one in each round)');
select pg_temp.ok((select count(*) from public.audit_round_items) = 0, 'a counter cannot read the round item tables directly');
select pg_temp.ok((select count(*) from public.audit_assignment_items where round_id = (select v from ids where k = 'r1')) = 5, 'a counter sees which items are theirs, and only those');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1')) = 7, 'a member deputy sees all items of the round');
select pg_temp.ok((select count(*) from public.audit_assignments where round_id = (select v from ids where k = 'r1')) = 2, 'a member deputy sees every assignment of the round');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok((select count(*) from public.audit_rounds) = 0 and (select count(*) from public.audit_round_items) = 0, 'a deputy who is not a member sees no rounds or items');
reset role;

-- 11. lock
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused($q$select public.audit_round_lock((select v from ids where k = 'r1'))$q$, 'not_allowed', 'a deputy cannot lock a round');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_round_lock((select v from ids where k = 'r1'), 1)$q$, 'version_conflict', 'locking with a stale version is refused');
select public.audit_round_lock((select v from ids where k = 'r1'));
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'locked'
  and (select locked_at from public.audit_rounds where id = (select v from ids where k = 'r1')) is not null, 'the round is locked and stamped');
select pg_temp.refused($q$select public.audit_round_lock((select v from ids where k = 'r1'))$q$, 'round_not_draft', 'a locked round cannot be locked again');
select pg_temp.refused($q$select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1']::uuid[])$q$, 'round_not_draft', 'a locked round cannot be re-split');
select pg_temp.refused($q$select public.audit_assign_move((select v from ids where k = 'r1'), array(select id from public.audit_round_items limit 1), '00000000-0000-0000-0000-0000000000c1')$q$, 'round_not_draft', 'items cannot be moved after lock');
reset role;
-- frozen items, even for the database owner (evidence is never edited)
select pg_temp.refused($q$update public.audit_round_items set system_qty = 999$q$, 'items_frozen', 'a round item can never be updated');
select pg_temp.refused($q$delete from public.audit_round_items where round_id = (select v from ids where k = 'r1')$q$, 'items_frozen', 'items of a locked round cannot be deleted');
select pg_temp.refused($q$insert into public.audit_round_items (round_id, engagement_id, position, company, name, system_qty)
  select id, engagement_id, 99, 'Acme', 'Sneaky', 1 from public.audit_rounds where id = (select v from ids where k = 'r1')$q$, 'items_frozen', 'items cannot be added to a locked round');

-- 12. revoke
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused($q$select public.audit_assign_revoke((select id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1')), 'no reason')$q$,
  'not_allowed', 'a deputy cannot revoke');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_assign_revoke((select id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1')), 'x')$q$,
  'reason_required', 'a revoke needs a reason');
select public.audit_assign_revoke((select id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1')), 'Left the audit');
select pg_temp.ok((select status from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1')) = 'revoked', 'the assignment is revoked');
select pg_temp.ok((select count(*) from public.audit_assignment_items where round_id = (select v from ids where k = 'r1')) = 5, 'the revoked person''s items are freed (only c1''s 5 remain assigned)');
select public.audit_assign_revoke((select id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1')), 'Left the audit');
select pg_temp.ok(true, 'revoking twice is harmless');
reset role;
update public.audit_assignments set status = 'submitted' where auditor_id = '00000000-0000-0000-0000-0000000000c1' and round_id = (select v from ids where k = 'r1');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_assign_revoke((select id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c1' and round_id = (select v from ids where k = 'r1')), 'Change of plan')$q$,
  'assignment_submitted', 'a submitted assignment cannot be revoked');
reset role;
select pg_temp.refused($q$update public.audit_assignments set status = 'assigned' where status = 'revoked'$q$, 'assignment_revoked', 'a revoked assignment cannot come back');

-- 13. key belongs to its maker
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.manage', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused($q$select public.audit_engagement_create('50000000-0000-0000-0000-000000000001', 'Taken', 'full')$q$, 'key_in_use', 'someone else''s engagement key is refused');
reset role;

-- 14. one individual engagement per month
insert into public.audit_engagements (name, scope_type, scope_month, created_by, idempotency_key)
  values ('Individual 2030-01', 'individual', '2030-01', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid());
select pg_temp.fails($q$insert into public.audit_engagements (name, scope_type, scope_month, created_by, idempotency_key)
  values ('Individual again', 'individual', '2030-01', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid())$q$, 'a second individual engagement for the same month is refused', 'duplicate key');
select pg_temp.fails($q$insert into public.audit_engagements (name, scope_type, created_by, idempotency_key)
  values ('Individual no month', 'individual', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid())$q$, 'an individual engagement needs its month', 'check constraint');

-- 15. the round state machine, both directions (as the database owner: the trigger is the last line of defence)
select pg_temp.refused($q$update public.audit_rounds set state = 'final' where id = (select v from ids where k = 'r1')$q$, 'illegal_transition', 'locked cannot jump to final');
select pg_temp.refused($q$update public.audit_rounds set state = 'draft' where id = (select v from ids where k = 'r1')$q$, 'illegal_transition', 'locked cannot go back to draft');
select pg_temp.refused($q$update public.audit_rounds set unit = 'item' where id = (select v from ids where k = 'r1')$q$, 'round_identity', 'a round''s unit cannot change');
update public.audit_rounds set state = 'counting' where id = (select v from ids where k = 'r1');
select pg_temp.refused($q$update public.audit_rounds set state = 'locked' where id = (select v from ids where k = 'r1')$q$, 'illegal_transition', 'counting cannot go back to locked');
update public.audit_rounds set state = 'compiled', compiled_at = now() where id = (select v from ids where k = 'r1');
update public.audit_rounds set state = 'counting' where id = (select v from ids where k = 'r1');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'counting', 'a reopened assignment may send a compiled round back to counting');
update public.audit_rounds set state = 'compiled' where id = (select v from ids where k = 'r1');
select pg_temp.refused($q$delete from public.audit_rounds where id = (select v from ids where k = 'r1')$q$, 'round_not_draft', 'a round that is not a draft cannot be deleted');
update public.audit_rounds set state = 'final', finalized_at = now() where id = (select v from ids where k = 'r1');
select pg_temp.refused($q$update public.audit_rounds set version = version + 1 where id = (select v from ids where k = 'r1')$q$, 'round_final', 'a final round cannot change at all');

-- 16. the activity log recorded the work
select pg_temp.ok((select count(*) from public.activity_log where action = 'audit.engagement_created') = 1, 'the engagement creation was logged once');
select pg_temp.ok((select count(*) from public.activity_log where action = 'audit.round_locked') = 1, 'the lock was logged');
select pg_temp.ok((select count(*) from public.activity_log where action = 'audit.assign_revoked' and reason = 'Left the audit') = 1, 'the revoke was logged with its reason (once, the repeat did nothing)');
rollback;
