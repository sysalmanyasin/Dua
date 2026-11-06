\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

-- token: valid once, expires, hashed
insert into public.import_tokens (hash, expires_at) values ('h1', now() + interval '1 hour'), ('h2', now() - interval '1 minute');
select pg_temp.ok(public.import_check_token('h1', false), 'a valid token passes a dry check');
select pg_temp.ok(public.import_check_token('h1', false), '...and can be checked again until consumed');
select pg_temp.ok(public.import_check_token('h1', true), 'it is accepted when consumed');
select pg_temp.ok(not public.import_check_token('h1', false), 'a consumed token is dead');
select pg_temp.ok(not public.import_check_token('h2', false), 'an expired token is refused');
select pg_temp.ok(not public.import_check_token('nope', false), 'an unknown token is refused');

-- only the service role can call the helpers
do $t$ begin
  set local role authenticated;
  begin perform public.import_sales_batch('[]','[]','[]'); raise exception 'FAIL: authenticated ran import';
  exception when insufficient_privilege then raise notice 'pass: signed-in users cannot run the import'; end;
  begin perform public.import_check_token('h1', false); raise exception 'FAIL: authenticated checked tokens';
  exception when insufficient_privilege then raise notice 'pass: signed-in users cannot check tokens'; end;
  reset role;
end $t$;

-- import: custom method, days, a monthly-only month; totals come from the lines; re-running changes nothing
select public.import_sales_batch(
  '[{"code":"c_x","label":"X Client","section":"Credit Clients","sign":"add","sort":400}]',
  '[{"business_date":"2024-03-01","comp_sale":100,"customers":40,"low_sale_reason":"  ","lines":[{"method":"cash_sale","amount":100},{"method":"c_x","amount":5},{"method":"pso","amount":-20},{"method":"hbl","amount":0}]},
    {"business_date":"2024-03-02","lines":[{"method":"cash_returns","amount":-7}]}]',
  '[{"month":"2023-05-01","total":5000,"customers":900,"lines":[{"method":"cash_sale","amount":5000}]}]');
select pg_temp.ok((select total from public.daily_sales where business_date = '2024-03-01') = 85, 'imported total is computed from the lines (100 + 5 - 20)');
select pg_temp.ok((select count(*) from public.daily_sale_lines where business_date = '2024-03-01') = 3, 'zero lines are not stored');
select pg_temp.ok((select diff from public.daily_sales where business_date = '2024-03-01') = -15, 'diff is derived');
select pg_temp.ok((select low_sale_reason is null from public.daily_sales where business_date = '2024-03-01'), 'blank text becomes empty');
select pg_temp.ok((select total from public.daily_sales where business_date = '2024-03-02') = -7, 'a returns-only day subtracts');
select pg_temp.ok((select source from public.daily_sales where business_date = '2024-03-01') = 'import', 'rows are marked as imported');
select pg_temp.ok((select count(*) from public.monthly_history where month = '2023-05-01') = 1 and (select count(*) from public.monthly_history_lines) = 1, 'monthly-only month stored with its lines');
select pg_temp.ok((select count(*) from public.payment_methods where code = 'c_x') = 1, 'custom method created');
select public.import_sales_batch('[]', '[{"business_date":"2024-03-01","lines":[{"method":"cash_sale","amount":999999}]}]', '[]');
select pg_temp.ok((select total from public.daily_sales where business_date = '2024-03-01') = 85, 're-running never overwrites an existing day');
select pg_temp.ok((select count(*) from public.activity_log where action = 'sales.imported') = 2, 'each batch is logged');
rollback;
