-- Tests for 0700_ops_rules.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

create function pg_temp.rule(k text) returns public.ops_rules language sql security definer as $$ select * from public.ops_rules where rule_key = k $$;
create function pg_temp.cat(k text) returns public.ops_activity_categories language sql security definer as $$ select * from public.ops_activity_categories where category_key = k $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','S Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');

do $t$ declare v jsonb; failed boolean; n int; code text; begin
  perform pg_temp.ok((select count(*) from public.permissions where key in ('ops.view','ops.manage_rules')) = 2, 'both ops permissions exist');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key in ('ops.view','ops.manage_rules')), 'no role preset carries an ops permission');
  perform pg_temp.ok((select count(*) from public.ops_rules) = 7 and (select count(*) from public.ops_activity_categories) = 2, 'the default rules and categories are seeded');
  perform pg_temp.ok((select enabled from public.ops_rules where rule_key = 'deposit_vs_cash') = false, 'the deposit rule starts off');
  perform pg_temp.ok((select count(*) from public.ops_rules where not public.ops_params_ok(rule_key, params)) = 0, 'every seeded rule passes its own parameter check');

  -- the owner
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.ops_rules_list();
  perform pg_temp.ok(jsonb_array_length(v -> 'rules') = 7 and jsonb_array_length(v -> 'activity_categories') = 2, 'the owner sees the rules and categories');
  perform public.ops_rule_set('closing_draft_open', null, 'critical', '{"hours": 6}', 'tighter');
  perform pg_temp.ok((select r.severity = 'critical' and r.params = '{"hours": 6}' and r.enabled from pg_temp.rule('closing_draft_open') r), 'the owner can change severity and settings');
  perform public.ops_rule_set('closing_draft_open', false, null, null, null);
  perform pg_temp.ok((select not r.enabled and r.severity = 'critical' from pg_temp.rule('closing_draft_open') r), 'leaving a field out keeps its old value');
  perform public.ops_activity_category_set('closing_drafts', false);
  perform pg_temp.ok((select not c.enabled from pg_temp.cat('closing_drafts') c), 'the owner can switch a category off');

  failed := false; begin perform public.ops_rule_set('closing_draft_open', null, 'urgent', null, null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'an unknown severity is refused');
  failed := false; begin perform public.ops_rule_set('closing_draft_open', null, null, '{"hourz": 6}', null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'an unknown setting name is refused');
  failed := false; begin perform public.ops_rule_set('closing_draft_open', null, null, '{"hours": 0}', null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'an out-of-range setting is refused');
  failed := false; begin perform public.ops_rule_set('closing_draft_open', null, null, '{"hours": "6"}', null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'a setting that is not a number is refused');
  failed := false; begin perform public.ops_rule_set('no_such_rule', true, null, null, null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'an unknown rule is refused');
  failed := false; begin perform public.ops_activity_category_set('closing_drafts', null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'a category must be switched on or off, not left blank');

  failed := false; begin perform count(*) from public.ops_rules; exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'even the owner cannot read the rules table directly from the browser');
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'ops.rule_changed') = 2 and (select count(*) from public.activity_log where action = 'ops.activity_category_changed') = 1,
    'every change is written to the audit log');
  perform pg_temp.ok((select old_value ->> 'severity' = 'warning' and new_value ->> 'severity' = 'critical' from public.activity_log where action = 'ops.rule_changed' order by id limit 1), 'the audit entry holds the old and new values');

  -- the owner without the second factor is treated like anyone else
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.ops_rules_list() is null, 'an owner session without the second factor sees nothing');
  failed := false; begin perform public.ops_rule_set('stock_reorder', false, null, null, null); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'an owner session without the second factor cannot change a rule');
  reset role;

  -- staff
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(public.ops_rules_list() is null, 'a senior sees nothing');
  failed := false; begin perform public.ops_rule_set('stock_reorder', false, null, null, null); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a senior cannot change a rule');
  reset role;
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000c1', 'ops.view', 'grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(public.ops_rules_list() is not null, 'a person the owner grants ops.view can see (the owner decides)');
  failed := false; begin perform public.ops_rule_set('stock_reorder', false, null, null, null); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'seeing the rules does not allow changing them');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.ops_rules_list() is null, 'a junior sees nothing');
  failed := false; begin perform public.ops_activity_category_set('closing_done', false); exception when insufficient_privilege then failed := true; end;
  perform pg_temp.ok(failed, 'a junior cannot change a category');
  reset role;
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname in ('ops_params_ok') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the parameter checker is internal');
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname in ('ops_rules_list','ops_rule_set','ops_activity_category_set') and has_function_privilege('anon', p.oid, 'execute')) = 0, 'the visitor role cannot call the rule functions');
end $t$;
rollback;
