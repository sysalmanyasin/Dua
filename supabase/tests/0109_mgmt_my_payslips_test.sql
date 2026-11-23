-- Tests for 0109_mgmt_my_payslips: a person sees only their own closed payslips.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');

-- Oct (closed): Junior One 40,000 base, advance 5,000, incentive 1,200, one custom addition 700, net 36,900;  Senior Two 60,000
-- Nov (open, not closed): Junior One 41,000
insert into public.mgmt_sheets(id, month, kind) values ('50000000-0000-0000-0000-000000000001', '2026-10-01', 'salary'), ('50000000-0000-0000-0000-000000000002', '2026-11-01', 'salary');
insert into public.mgmt_salary_columns(id, name, sign, active_from) values ('60000000-0000-0000-0000-000000000001', 'Eid bonus', 1, '2026-01-01');
insert into public.mgmt_salary_rows(sheet_id, staff_id, revision, ho_salary, days, extras, advance_used, generic_used, net) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 0, 39000, 31, '{}', 5000, 1200, 35200),
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 40000, 31, '{"60000000-0000-0000-0000-000000000001": 700}', 5000, 1200, 36900),
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 0, 60000, 31, '{}', 0, 0, 60000),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 0, 41000, 30, '{}', 0, 0, 41000);
update public.mgmt_sheets set closed_at = now() where id = '50000000-0000-0000-0000-000000000001';

do $t$ declare v jsonb; failed boolean; begin
  perform pg_temp.ok((select count(*) from public.permissions where key = 'payroll.view_own') = 1, 'the permission exists');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'payroll.view_own'), 'no role carries it by default');

  -- without the permission: nothing, even for the person whose payslip it is
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.mgmt_my_payslips() is null, 'a junior without the permission gets nothing');
  reset role;

  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'payroll.view_own', 'grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.mgmt_my_payslips();
  perform pg_temp.ok(jsonb_array_length(v -> 'payslips') = 1, 'with the permission: one closed month; the open month is not shown');
  perform pg_temp.ok(v -> 'payslips' -> 0 ->> 'month' = '2026-10-01', 'it is the closed October slip');
  perform pg_temp.ok((v -> 'payslips' -> 0 ->> 'base_salary')::numeric = 40000 and (v -> 'payslips' -> 0 ->> 'advance_deducted')::numeric = 5000 and (v -> 'payslips' -> 0 ->> 'incentive')::numeric = 1200, 'it shows the latest saved revision, not the first');
  perform pg_temp.ok((v -> 'payslips' -> 0 ->> 'net')::numeric = 36900, 'net is the value Manager saved at close, not recalculated');
  perform pg_temp.ok(v -> 'payslips' -> 0 -> 'other' -> 0 ->> 'name' = 'Eid bonus' and (v -> 'payslips' -> 0 -> 'other' -> 0 ->> 'amount')::numeric = 700, 'custom columns are listed by name');
  perform pg_temp.ok(not (v::text like '%Senior Two%') and not (v::text like '%60000%'), 'nothing of another person appears');
  perform pg_temp.ok(not (v::text like '%staff_id%') and not (v::text like '%10000000-0000-0000-0000-000000000001%'), 'no internal ids are returned');
  failed := false; begin perform public.mgmt_my_payslips(3, '10000000-0000-0000-0000-000000000002'); exception when undefined_function then failed := true; end;
  perform pg_temp.ok(failed, 'there is no way to ask for someone else: the function takes no person');
  reset role;

  -- another person with the permission sees only their own row
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000c1', 'payroll.view_own', 'grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  v := public.mgmt_my_payslips();
  perform pg_temp.ok((v -> 'payslips' -> 0 ->> 'net')::numeric = 60000 and jsonb_array_length(v -> 'payslips') = 1, 'a senior sees their own slip only');
  reset role;

  -- a disabled login loses it at once
  update public.profiles set disabled_at = now() where user_id = '00000000-0000-0000-0000-0000000000b1';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.mgmt_my_payslips() is null, 'a disabled login gets nothing');
  reset role;

  -- the browser roles' direct access is closed
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  failed := false; begin perform count(*) from public.mgmt_salary_rows; exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed or (select count(*) from public.mgmt_salary_rows) = 0, 'a staff login cannot read the salary table directly');
  reset role;
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname = 'mgmt_my_payslips' and has_function_privilege('anon', p.oid, 'execute')) = 0, 'the visitor role cannot call it');
end $t$;
rollback;
