-- 0003: TEMPORARY helper for the one-time sales import. Removed again by 0004_remove_import_helper.sql.
-- Only the service role can use it, and only with a one-time token created by the project owner's tooling.

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when feature_not_supported or undefined_file then
  raise notice 'pg_net is not available in this database (expected only on local test databases)';
end $$;

create table public.import_tokens (
  hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.import_tokens enable row level security; -- no policy: service role only

create or replace function public.import_check_token(p_hash text, p_consume boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.import_tokens where hash = p_hash and used_at is null and expires_at > now()) then
    return false;
  end if;
  if p_consume then update public.import_tokens set used_at = now() where hash = p_hash; end if;
  return true;
end $$;

-- Inserts custom payment methods, days and monthly-only months. Safe to re-run: existing rows are never changed.
create or replace function public.import_sales_batch(p_methods jsonb, p_days jsonb, p_months jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_days int := 0; n_skip int := 0; n_months int := 0; n_methods int := 0;
begin
  insert into public.payment_methods (code, label, section, sign, sort, show_in_entry)
  select x.code, x.label, x.section, x.sign, x.sort, true
  from jsonb_to_recordset(coalesce(p_methods, '[]'::jsonb)) as x(code text, label text, section text, sign text, sort int)
  on conflict (code) do nothing;
  get diagnostics n_methods = row_count;

  with d as (
    select * from jsonb_to_recordset(coalesce(p_days, '[]'::jsonb)) as x(
      business_date date, comp_sale numeric, customers int, fdpp_pos numeric, fdpp_consumer numeric,
      amount_received numeric, load_sale numeric, cash_to_deposit numeric, low_sale_reason text, lines jsonb)
  ), ins as (
    insert into public.daily_sales (business_date, comp_sale, customers, fdpp_pos, fdpp_consumer, amount_received,
      load_sale, cash_to_deposit, low_sale_reason, total, source)
    select d.business_date, d.comp_sale, d.customers, d.fdpp_pos, d.fdpp_consumer, d.amount_received, d.load_sale,
           d.cash_to_deposit, nullif(trim(d.low_sale_reason), ''), public.sales_compute_total(d.lines), 'import'
    from d on conflict (business_date) do nothing returning business_date
  ), ln as (
    insert into public.daily_sale_lines (business_date, method_code, amount)
    select ins.business_date, l ->> 'method', (l ->> 'amount')::numeric
    from ins join d on d.business_date = ins.business_date, jsonb_array_elements(d.lines) l
    where (l ->> 'amount')::numeric <> 0
    returning 1
  )
  select count(*) into n_days from ins;
  n_skip := jsonb_array_length(coalesce(p_days, '[]'::jsonb)) - n_days;

  with m as (
    select * from jsonb_to_recordset(coalesce(p_months, '[]'::jsonb)) as x(month date, total numeric, comp_sale numeric, customers int, lines jsonb)
  ), ins as (
    insert into public.monthly_history (month, total, comp_sale, customers, source)
    select m.month, m.total, m.comp_sale, m.customers, 'import' from m on conflict (month) do nothing returning month
  ), ln as (
    insert into public.monthly_history_lines (month, method_code, amount)
    select ins.month, l ->> 'method', (l ->> 'amount')::numeric
    from ins join m on m.month = ins.month, jsonb_array_elements(m.lines) l
    returning 1
  )
  select count(*) into n_months from ins;

  perform public.log_activity('sales.imported', 'daily_sales', null, null,
    jsonb_build_object('days', n_days, 'skipped', n_skip, 'months', n_months, 'methods', n_methods), 'one-time import');
  return jsonb_build_object('days', n_days, 'skipped', n_skip, 'months', n_months, 'methods', n_methods);
end $$;

revoke all on function public.import_check_token(text, boolean), public.import_sales_batch(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_check_token(text, boolean), public.import_sales_batch(jsonb, jsonb, jsonb) to service_role;
grant all on public.import_tokens to service_role;
