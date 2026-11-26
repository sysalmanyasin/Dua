-- 0199_mgmt_exposure_test: the exposure guard for EVERY Manager migration (0101-0199).
-- No Manager function may be callable by anon, and authenticated may call ONLY this whitelist. Every Manager migration that
-- adds a callable function must add it here on purpose, and every function must pin its search_path.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

do $t$ declare bad text; n int;
  allowed text[] := array[
    'mgmt_staff_list','mgmt_staff_get','mgmt_staff_save','mgmt_note_add','mgmt_note_remove',
    'mgmt_credit_add','mgmt_credit_reverse','mgmt_credit_set_deduction','mgmt_credit_set_opening','mgmt_credit_month',
    'mgmt_rates_list','mgmt_rate_set','mgmt_salary_columns','mgmt_salary_column_add','mgmt_salary_column_retire',
    'mgmt_generic_month','mgmt_generic_save','mgmt_salary_month','mgmt_salary_save','mgmt_sheet_close',
    'mgmt_incentive_month','mgmt_incentive_save',
    'mgmt_petty_month','mgmt_petty_save','mgmt_petty_copy',
    'mgmt_ledgers_list','mgmt_ledger_view','mgmt_ledger_add','mgmt_ledger_reverse','mgmt_ledger_section_create','mgmt_ledger_category_add',
    'mgmt_ledger_category_retire','mgmt_tally_accounts_list','mgmt_tally_account_add','mgmt_tally_account_retire','mgmt_tally_get',
    'mgmt_tally_list','mgmt_tally_save',
    'mgmt_inbox_lines','mgmt_inbox_count','mgmt_inbox_file','mgmt_inbox_dismiss','mgmt_inbox_reopen',
    -- 0109: a person's own closed payslips; takes no person, needs payroll.view_own (granted per person), see 0109_mgmt_my_payslips_test
    'mgmt_my_payslips',
    -- 0110: geo-fenced attendance; own record via attendance.check_in, owner views/settings via attendance.view_all / attendance.manage,
    -- see 0110_mgmt_attendance_test. The distance helper is internal and NOT listed (clients cannot call it).
    'mgmt_attendance_check_in','mgmt_attendance_today','mgmt_attendance_list','mgmt_attendance_setup',
    'mgmt_attendance_site_save','mgmt_attendance_config_set',
    -- 0111: read-only history; a person's own days (attendance.check_in) and the owner's summary (attendance.view_all),
    -- see 0111_mgmt_attendance_views_test. The shared day calculation (mgmt_attendance_days) is internal and NOT listed.
    'mgmt_attendance_my_history','mgmt_attendance_summary',
    -- 0112: the stability period (owner, attendance.manage) and the narrow read a staff phone uses to watch the pharmacy
    -- (attendance.check_in), see 0112_mgmt_attendance_auto_setup_test.
    'mgmt_attendance_stable_set','mgmt_attendance_my_site'];
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mgmt\_%' and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'no Manager function is executable by anon' || coalesce(' (found: ' || bad || ')', ''));
  select string_agg(p.proname, ', ' order by p.proname) into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mgmt\_%' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> all (allowed);
  perform pg_temp.ok(bad is null, 'authenticated can execute only the whitelisted Manager functions' || coalesce(' (found: ' || bad || ')', ''));
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = any (allowed) and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.ok(n = cardinality(allowed), 'all ' || cardinality(allowed) || ' whitelisted functions exist and are callable (found ' || n || ')');
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mgmt\_%' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform pg_temp.ok(bad is null, 'every Manager function has a fixed search_path' || coalesce(' (missing: ' || bad || ')', ''));
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'mgmt\_%' and c.relkind = 'r' and not c.relrowsecurity;
  perform pg_temp.ok(bad is null, 'every Manager table has row level security on' || coalesce(' (without: ' || bad || ')', ''));
  select string_agg(distinct tablename, ', ') into bad from pg_policies where schemaname = 'public' and tablename like 'mgmt\_%' and cmd <> 'SELECT';
  perform pg_temp.ok(bad is null, 'no Manager table has a write policy (every write is a function)' || coalesce(' (found on: ' || bad || ')', ''));
  select string_agg(table_name || ':' || privilege_type, ', ') into bad from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'mgmt\_%' and grantee in ('anon', 'authenticated') and (grantee = 'anon' or privilege_type <> 'SELECT');
  perform pg_temp.ok(bad is null, 'anon holds nothing and authenticated only SELECT on Manager tables' || coalesce(' (found: ' || bad || ')', ''));
end $t$;
rollback;
