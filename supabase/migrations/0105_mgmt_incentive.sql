-- 0105_mgmt_incentive: the monthly Incentive calculator (owner only: it contains the owner's own share). See docs/modules/manager.md
-- rule R9 and MGR-5, 12, 23, 24, 25, 26.
--
-- Old formula reproduced exactly. Every typed figure is rounded to a whole rupee first (floor(x + 0.5), like JS Math.round):
--   sale commission  = round(sale x 0.5%)            generic incentive = round(generic sale x 4.5%)
--   commission       = sale commission - pilferage - till short
--   generic part     = generic incentive - excess fine
--   grand total      = commission + cash-target bonus + generic part
--   net incentive    = grand total - (plus fine + paper fine) - panel fine
--   owner's share    = round(net incentive x 50%) - tax          (the old "split / 2")
-- One set of figures per month for the whole branch. The old field "unapproved" was stored but never used: dropped.
-- Like every sheet: a save adds a new REVISION only if something changed; a closed month needs a reason; a month keeps the
-- rates it started with.

-- ───────── three more rates, same append-only history as the generic rate ─────────
alter table public.mgmt_rates drop constraint mgmt_rates_rate_key_check;
alter table public.mgmt_rates add constraint mgmt_rates_rate_key_check
  check (rate_key in ('generic_staff', 'sale_commission', 'generic_pool', 'owner_share'));
insert into public.mgmt_rates (rate_key, rate, reason) values
 ('sale_commission', 0.005, 'Starting value, taken from the old app (MGR-5)'),
 ('generic_pool', 0.045, 'Starting value, taken from the old app (MGR-5)'),
 ('owner_share', 0.5, 'Starting value, taken from the old app: the "split / 2" (MGR-5)');

create or replace function public.mgmt_rate_set(p_rate_key text, p_rate numeric, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; old_r numeric; v_id uuid; res jsonb; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_perm('mgmt.rates') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'rate_set');
  if cached is not null then return cached; end if;
  if p_rate_key not in ('generic_staff', 'sale_commission', 'generic_pool', 'owner_share') then raise exception 'unknown rate'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 1 or p_rate <> round(p_rate, 5) then raise exception 'a rate must be between 0 and 100 percent with at most 3 decimals of a percent'; end if;
  if length(v_reason) not between 3 and 200 then raise exception 'a reason of 3 to 200 characters is required'; end if;
  old_r := public.mgmt_rate_now(p_rate_key);
  insert into public.mgmt_rates (rate_key, rate, reason, set_by) values (p_rate_key, p_rate, v_reason, auth.uid()) returning id into v_id;
  perform public.log_activity('mgmt.rate_set', 'mgmt_rates', v_id::text, jsonb_build_object('rate_key', p_rate_key, 'rate', old_r),
    jsonb_build_object('rate_key', p_rate_key, 'rate', p_rate), v_reason);
  res := jsonb_build_object('id', v_id, 'rate', p_rate);
  perform public.mgmt_idem_put(p_key, 'rate_set', res);
  return res;
end $$;

-- ───────── sheets can now also be Incentive or Petty (Close month works the same way) ─────────
alter table public.mgmt_sheets drop constraint mgmt_sheets_kind_check;
alter table public.mgmt_sheets add constraint mgmt_sheets_kind_check check (kind in ('salary', 'generic', 'incentive', 'petty'));

create or replace function public.mgmt_sheet_close(p_month date, p_kind text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cached jsonb; v_sheet public.mgmt_sheets; cur public.mgmt_salary_rows; v_adv numeric; v_gen numeric; v_net numeric; n int := 0; res jsonb;
begin
  if not public.has_perm('mgmt.close_month') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'sheet_close');
  if cached is not null then return cached; end if;
  if p_kind not in ('salary', 'generic', 'incentive', 'petty') then raise exception 'unknown sheet'; end if;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = p_kind for update;
  if not found then raise exception 'there is nothing saved for that month yet'; end if;
  if v_sheet.closed_at is not null then raise exception 'this month is already closed'; end if;
  if p_kind = 'salary' and exists (select 1 from public.mgmt_sheets where month = p_month and kind = 'generic' and closed_at is null) then
    raise exception 'close the Generic sheet for that month first';
  end if;
  if p_kind = 'salary' then
    for cur in select distinct on (r.staff_id) r.* from public.mgmt_salary_rows r where r.sheet_id = v_sheet.id order by r.staff_id, r.revision desc loop
      v_adv := public.mgmt_rup(public.mgmt_advance_for(p_month, cur.staff_id));
      v_gen := public.mgmt_generic_final_for(p_month, cur.staff_id);
      v_net := public.mgmt_salary_net(cur.ho_salary, v_adv, v_gen, cur.extras, p_month);
      if v_adv <> cur.advance_used or v_gen <> cur.generic_used or v_net <> cur.net then
        insert into public.mgmt_salary_rows (sheet_id, staff_id, revision, ho_salary, days, extras, advance_used, generic_used, net, reason, created_by)
          values (v_sheet.id, cur.staff_id, cur.revision + 1, cur.ho_salary, cur.days, cur.extras, v_adv, v_gen, v_net, 'month close snapshot', auth.uid());
        n := n + 1;
      end if;
    end loop;
  end if;
  update public.mgmt_sheets set closed_at = now(), closed_by = auth.uid() where id = v_sheet.id;
  perform public.log_activity('mgmt.sheet_closed', 'mgmt_sheets', v_sheet.id::text, null,
    jsonb_build_object('month', p_month, 'kind', p_kind, 'rows_refreshed', n), null);
  res := jsonb_build_object('sheet_id', v_sheet.id, 'rows_refreshed', n);
  perform public.mgmt_idem_put(p_key, 'sheet_close', res);
  return res;
end $$;

-- ───────── the month's figures (append-only revisions, one set per month) ─────────
create table public.mgmt_incentive_rows (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  sheet_id uuid not null references public.mgmt_sheets(id) on delete restrict,
  revision int not null check (revision >= 0),
  sale numeric(14,2) not null, generic_sale numeric(14,2) not null, pilferage numeric(14,2) not null, till_short numeric(14,2) not null,
  cash_target numeric(14,2) not null, excess_fine numeric(14,2) not null, plus_fine numeric(14,2) not null,
  paper_fine numeric(14,2) not null, panel_fine numeric(14,2) not null, tax numeric(14,2) not null,
  rate_sale_commission numeric(7,5) not null, rate_generic_pool numeric(7,5) not null, rate_owner_share numeric(7,5) not null,
  sale_comm numeric(14,2) not null, gen_inc numeric(14,2) not null, total_comm numeric(14,2) not null, total_gen numeric(14,2) not null,
  grand_total numeric(14,2) not null, pre_panel numeric(14,2) not null, net_inc numeric(14,2) not null, owner_net numeric(14,2) not null,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sheet_id, revision),
  check (abs(sale) <= 1000000000 and abs(generic_sale) <= 1000000000 and abs(pilferage) <= 1000000000 and abs(till_short) <= 1000000000
     and abs(cash_target) <= 1000000000 and abs(excess_fine) <= 1000000000 and abs(plus_fine) <= 1000000000
     and abs(paper_fine) <= 1000000000 and abs(panel_fine) <= 1000000000 and abs(tax) <= 1000000000)
);
create index mgmt_incentive_rows_sheet on public.mgmt_incentive_rows (sheet_id, revision desc);
alter table public.mgmt_incentive_rows enable row level security;
create trigger mgmt_incentive_rows_append_only before update or delete on public.mgmt_incentive_rows
  for each row execute function public.mgmt_append_only();
-- This sheet holds the owner's own share, so only the incentive key reads it (not salary, not salary_view).
create policy mgmt_incentive_rows_read on public.mgmt_incentive_rows for select to authenticated
  using ((select public.has_perm('mgmt.incentive')));
grant select on public.mgmt_incentive_rows to authenticated;

-- The one definition of the incentive maths. Inputs must already be whole rupees.
create function public.mgmt_incentive_calc(p_sale numeric, p_gen numeric, p_pilf numeric, p_till numeric, p_cash numeric,
  p_excess numeric, p_plus numeric, p_paper numeric, p_panel numeric, p_tax numeric, r_sale numeric, r_gen numeric, r_owner numeric)
returns jsonb language sql immutable set search_path = public as $$
  with a as (select public.mgmt_rup(p_sale * r_sale) as sc, public.mgmt_rup(p_gen * r_gen) as gi),
       b as (select sc, gi, sc - p_pilf - p_till as tc, gi - p_excess as tg from a),
       c as (select sc, gi, tc, tg, tc + p_cash + tg as grand from b),
       d as (select sc, gi, tc, tg, grand, grand - (p_plus + p_paper) as pre from c),
       e as (select sc, gi, tc, tg, grand, pre, pre - p_panel as net from d)
  select jsonb_build_object('sale_comm', sc, 'gen_inc', gi, 'total_comm', tc, 'total_gen', tg, 'grand_total', grand,
                            'pre_panel', pre, 'net_inc', net, 'owner_net', public.mgmt_rup(net * r_owner) - p_tax) from e
$$;

create function public.mgmt_incentive_month(p_month date)
returns table (has_row boolean, revision int, closed boolean,
               sale numeric, generic_sale numeric, pilferage numeric, till_short numeric, cash_target numeric, excess_fine numeric,
               plus_fine numeric, paper_fine numeric, panel_fine numeric, tax numeric,
               rate_sale_commission numeric, rate_generic_pool numeric, rate_owner_share numeric,
               sale_comm numeric, gen_inc numeric, total_comm numeric, total_gen numeric, grand_total numeric,
               pre_panel numeric, net_inc numeric, owner_net numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_sheet public.mgmt_sheets; r public.mgmt_incentive_rows; rs numeric; rg numeric; ro numeric; j jsonb;
begin
  if not public.has_perm('mgmt.incentive') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'incentive';
  select * into r from public.mgmt_incentive_rows where sheet_id = v_sheet.id order by revision desc limit 1;
  rs := coalesce(r.rate_sale_commission, public.mgmt_rate_now('sale_commission'));
  rg := coalesce(r.rate_generic_pool, public.mgmt_rate_now('generic_pool'));
  ro := coalesce(r.rate_owner_share, public.mgmt_rate_now('owner_share'));
  j := public.mgmt_incentive_calc(coalesce(r.sale, 0), coalesce(r.generic_sale, 0), coalesce(r.pilferage, 0), coalesce(r.till_short, 0),
        coalesce(r.cash_target, 0), coalesce(r.excess_fine, 0), coalesce(r.plus_fine, 0), coalesce(r.paper_fine, 0),
        coalesce(r.panel_fine, 0), coalesce(r.tax, 0), rs, rg, ro);
  return query select (r.id is not null), r.revision, (v_sheet.closed_at is not null),
    coalesce(r.sale, 0), coalesce(r.generic_sale, 0), coalesce(r.pilferage, 0), coalesce(r.till_short, 0), coalesce(r.cash_target, 0),
    coalesce(r.excess_fine, 0), coalesce(r.plus_fine, 0), coalesce(r.paper_fine, 0), coalesce(r.panel_fine, 0), coalesce(r.tax, 0),
    rs, rg, ro, (j ->> 'sale_comm')::numeric, (j ->> 'gen_inc')::numeric, (j ->> 'total_comm')::numeric, (j ->> 'total_gen')::numeric,
    (j ->> 'grand_total')::numeric, (j ->> 'pre_panel')::numeric, (j ->> 'net_inc')::numeric, (j ->> 'owner_net')::numeric;
end $$;

create function public.mgmt_incentive_save(p_month date, p_inputs jsonb, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; v_sheet public.mgmt_sheets; r public.mgmt_incentive_rows; k text; n numeric;
  v jsonb := '{}'::jsonb; j jsonb; rs numeric; rg numeric; ro numeric; v_id uuid; res jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  fields text[] := array['sale','generic_sale','pilferage','till_short','cash_target','excess_fine','plus_fine','paper_fine','panel_fine','tax'];
begin
  if not public.has_perm('mgmt.incentive') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'incentive_save');
  if cached is not null then return cached; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month > date_trunc('month', today)::date or p_month < date '2000-01-01' then
    raise exception 'pick a month that has begun, as the first of the month';
  end if;
  if p_inputs is null or jsonb_typeof(p_inputs) <> 'object' then raise exception 'figures must be an object'; end if;
  for k in select jsonb_object_keys(p_inputs) loop
    if k <> all (fields) then raise exception 'unknown figure: %', k; end if;
  end loop;
  foreach k in array fields loop
    if coalesce(p_inputs ->> k, '0') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'figures must be numbers'; end if;
    n := public.mgmt_rup(coalesce(p_inputs ->> k, '0')::numeric);
    if abs(n) > 1000000000 then raise exception 'a figure is out of range'; end if;
    v := v || jsonb_build_object(k, n);
  end loop;

  insert into public.mgmt_sheets (month, kind, created_by) values (p_month, 'incentive', auth.uid()) on conflict (month, kind) do nothing;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'incentive' for update;
  if v_sheet.closed_at is not null and (v_reason is null or length(v_reason) < 3) then raise exception 'this month is closed: a reason is required to revise it'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;
  select * into r from public.mgmt_incentive_rows where sheet_id = v_sheet.id order by revision desc limit 1;

  if r.id is null and not exists (select 1 from jsonb_each_text(v) x where x.value::numeric <> 0) then
    res := jsonb_build_object('sheet_id', v_sheet.id, 'changed', 0, 'unchanged', 0);
    perform public.mgmt_idem_put(p_key, 'incentive_save', res);
    return res;
  end if;
  if r.id is not null and r.sale = (v ->> 'sale')::numeric and r.generic_sale = (v ->> 'generic_sale')::numeric
     and r.pilferage = (v ->> 'pilferage')::numeric and r.till_short = (v ->> 'till_short')::numeric
     and r.cash_target = (v ->> 'cash_target')::numeric and r.excess_fine = (v ->> 'excess_fine')::numeric
     and r.plus_fine = (v ->> 'plus_fine')::numeric and r.paper_fine = (v ->> 'paper_fine')::numeric
     and r.panel_fine = (v ->> 'panel_fine')::numeric and r.tax = (v ->> 'tax')::numeric then
    res := jsonb_build_object('sheet_id', v_sheet.id, 'changed', 0, 'unchanged', 1);
    perform public.mgmt_idem_put(p_key, 'incentive_save', res);
    return res;
  end if;

  -- a month keeps the rates it started with
  rs := coalesce(r.rate_sale_commission, public.mgmt_rate_now('sale_commission'));
  rg := coalesce(r.rate_generic_pool, public.mgmt_rate_now('generic_pool'));
  ro := coalesce(r.rate_owner_share, public.mgmt_rate_now('owner_share'));
  j := public.mgmt_incentive_calc((v ->> 'sale')::numeric, (v ->> 'generic_sale')::numeric, (v ->> 'pilferage')::numeric, (v ->> 'till_short')::numeric,
        (v ->> 'cash_target')::numeric, (v ->> 'excess_fine')::numeric, (v ->> 'plus_fine')::numeric, (v ->> 'paper_fine')::numeric,
        (v ->> 'panel_fine')::numeric, (v ->> 'tax')::numeric, rs, rg, ro);
  insert into public.mgmt_incentive_rows (sheet_id, revision, sale, generic_sale, pilferage, till_short, cash_target, excess_fine, plus_fine,
      paper_fine, panel_fine, tax, rate_sale_commission, rate_generic_pool, rate_owner_share, sale_comm, gen_inc, total_comm, total_gen,
      grand_total, pre_panel, net_inc, owner_net, reason, created_by)
    values (v_sheet.id, coalesce(r.revision + 1, 0), (v ->> 'sale')::numeric, (v ->> 'generic_sale')::numeric, (v ->> 'pilferage')::numeric,
      (v ->> 'till_short')::numeric, (v ->> 'cash_target')::numeric, (v ->> 'excess_fine')::numeric, (v ->> 'plus_fine')::numeric,
      (v ->> 'paper_fine')::numeric, (v ->> 'panel_fine')::numeric, (v ->> 'tax')::numeric, rs, rg, ro,
      (j ->> 'sale_comm')::numeric, (j ->> 'gen_inc')::numeric, (j ->> 'total_comm')::numeric, (j ->> 'total_gen')::numeric,
      (j ->> 'grand_total')::numeric, (j ->> 'pre_panel')::numeric, (j ->> 'net_inc')::numeric, (j ->> 'owner_net')::numeric, v_reason, auth.uid())
    returning id into v_id;
  -- the figures themselves (they include the owner's own share) are never copied into the activity log
  perform public.log_activity('mgmt.incentive_saved', 'mgmt_sheets', v_sheet.id::text, null,
    jsonb_build_object('month', p_month, 'closed', v_sheet.closed_at is not null), v_reason);
  res := jsonb_build_object('sheet_id', v_sheet.id, 'changed', 1, 'unchanged', 0);
  perform public.mgmt_idem_put(p_key, 'incentive_save', res);
  return res;
end $$;

-- ───────── grants ─────────
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_incentive_calc(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric),
  public.mgmt_incentive_month(date), public.mgmt_incentive_save(date, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.mgmt_incentive_month(date), public.mgmt_incentive_save(date, jsonb, text, uuid) to authenticated;
