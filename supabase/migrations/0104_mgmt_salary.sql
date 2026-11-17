-- 0104_mgmt_salary: Salary sheet, Generic sheet, custom salary columns, rates, Close month (owner only).
-- See docs/modules/manager.md rules R5-R8, R10 and MGR-5, 8, 12, 13, 16, 23, 24.
--
-- Old behaviour reproduced (whole rupees, JS Math.round = floor(x + 0.5)):
--   Generic: incentive = round(round(sale) x rate); final = incentive + round(extra).
--   Salary:  net = round(HO salary) - round(advance) + round(generic final) + sum(sign x round(custom column)).
-- Nothing is overwritten. A save adds a new REVISION of a row, and only when something changed. After Close month a
-- revision also needs a reason. The rate each month used is stored with that month's sheet, so changing a rate later never
-- changes a month that already exists.

insert into public.permissions (key, description) values
 ('mgmt.rates', 'Change the generic, incentive and commission rates');

-- Whole-rupee rounding exactly like JavaScript Math.round (halves go up, also for negatives).
create function public.mgmt_rup(x numeric) returns numeric
language sql immutable set search_path = public as $$ select floor(x + 0.5) $$;

-- ───────── rates (own append-only history; every change has a reason) ─────────
create table public.mgmt_rates (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  rate_key text not null check (rate_key in ('generic_staff')),
  rate numeric(7,5) not null check (rate >= 0 and rate <= 1),
  reason text not null check (length(trim(reason)) >= 3),
  set_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index mgmt_rates_key on public.mgmt_rates (rate_key, seq desc);
alter table public.mgmt_rates enable row level security;
create trigger mgmt_rates_append_only before update or delete on public.mgmt_rates
  for each row execute function public.mgmt_append_only();
insert into public.mgmt_rates (rate_key, rate, reason) values ('generic_staff', 0.04, 'Starting value, taken from the old app (MGR-5)');

-- ───────── a sheet = one kind for one month ─────────
create table public.mgmt_sheets (
  id uuid primary key default gen_random_uuid(),
  month date not null check (month = date_trunc('month', month)::date),
  kind text not null check (kind in ('salary', 'generic')),
  rate numeric(7,5) check (rate is null or (rate >= 0 and rate <= 1)),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (month, kind),
  check ((kind = 'generic') = (rate is not null))
);
alter table public.mgmt_sheets enable row level security;
create function public.mgmt_sheets_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'sheets cannot be deleted'; end if;
  if old.closed_at is not null or new.closed_at is null or new.id is distinct from old.id
     or new.month is distinct from old.month or new.kind is distinct from old.kind or new.rate is distinct from old.rate then
    raise exception 'a sheet can only be closed, once';
  end if;
  return new;
end $$;
create trigger mgmt_sheets_guard before update or delete on public.mgmt_sheets
  for each row execute function public.mgmt_sheets_guard();

-- ───────── custom salary columns: global, with an effective month, so months carry on by themselves ─────────
create table public.mgmt_salary_columns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  sign smallint not null check (sign in (1, -1)),
  active_from date not null check (active_from = date_trunc('month', active_from)::date),
  retired_from date check (retired_from is null or (retired_from = date_trunc('month', retired_from)::date and retired_from > active_from)),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index mgmt_salary_columns_name on public.mgmt_salary_columns (lower(trim(name))) where retired_from is null;
alter table public.mgmt_salary_columns enable row level security;
-- A column's name and sign never change (the old app needed a "sign flip" migration); it can only be retired, once.
create function public.mgmt_columns_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'columns cannot be deleted'; end if;
  if old.retired_from is not null or new.retired_from is null or new.id is distinct from old.id or new.name is distinct from old.name
     or new.sign is distinct from old.sign or new.active_from is distinct from old.active_from then
    raise exception 'a column can only be retired, once';
  end if;
  return new;
end $$;
create trigger mgmt_salary_columns_guard before update or delete on public.mgmt_salary_columns
  for each row execute function public.mgmt_columns_guard();

-- ───────── rows (append-only revisions) ─────────
create table public.mgmt_salary_rows (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  sheet_id uuid not null references public.mgmt_sheets(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  revision int not null check (revision >= 0),
  ho_salary numeric(14,2) not null check (abs(ho_salary) <= 1000000000),
  days int not null default 31 check (days between 0 and 31),
  extras jsonb not null default '{}'::jsonb check (jsonb_typeof(extras) = 'object'),
  advance_used numeric(14,2) not null default 0,
  generic_used numeric(14,2) not null default 0,
  net numeric(14,2) not null,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sheet_id, staff_id, revision)
);
create index mgmt_salary_rows_sheet on public.mgmt_salary_rows (sheet_id, staff_id, revision desc);
alter table public.mgmt_salary_rows enable row level security;
create trigger mgmt_salary_rows_append_only before update or delete on public.mgmt_salary_rows
  for each row execute function public.mgmt_append_only();

create table public.mgmt_generic_rows (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  sheet_id uuid not null references public.mgmt_sheets(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  revision int not null check (revision >= 0),
  generic_sale numeric(14,2) not null check (abs(generic_sale) <= 1000000000),
  extra numeric(14,2) not null default 0 check (abs(extra) <= 1000000000),
  incentive numeric(14,2) not null,
  final numeric(14,2) not null,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sheet_id, staff_id, revision)
);
create index mgmt_generic_rows_sheet on public.mgmt_generic_rows (sheet_id, staff_id, revision desc);
alter table public.mgmt_generic_rows enable row level security;
create trigger mgmt_generic_rows_append_only before update or delete on public.mgmt_generic_rows
  for each row execute function public.mgmt_append_only();

-- ───────── read policies (wrapped form) ─────────
create policy mgmt_rates_read on public.mgmt_rates for select to authenticated
  using ((select public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view') or public.has_perm('mgmt.incentive') or public.has_perm('mgmt.rates')));
create policy mgmt_sheets_read on public.mgmt_sheets for select to authenticated
  using ((select public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')));
create policy mgmt_salary_columns_read on public.mgmt_salary_columns for select to authenticated
  using ((select public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')));
create policy mgmt_salary_rows_read on public.mgmt_salary_rows for select to authenticated
  using ((select public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')));
create policy mgmt_generic_rows_read on public.mgmt_generic_rows for select to authenticated
  using ((select public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')));
grant select on public.mgmt_rates, public.mgmt_sheets, public.mgmt_salary_columns, public.mgmt_salary_rows, public.mgmt_generic_rows to authenticated;

-- ───────── internal helpers (callable only by other Manager functions) ─────────
create function public.mgmt_rate_now(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select rate from public.mgmt_rates where rate_key = p_key order by seq desc limit 1
$$;

-- The credit entries of a month (kind 'entry', signed): the salary advance (MGR-16).
create function public.mgmt_advance_for(p_month date, p_staff uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.mgmt_credit_entries
  where staff_id = p_staff and kind = 'entry' and entry_date >= p_month and entry_date < (p_month + interval '1 month')::date
$$;

create function public.mgmt_generic_final_for(p_month date, p_staff uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select g.final from public.mgmt_generic_rows g join public.mgmt_sheets s on s.id = g.sheet_id
                   where s.kind = 'generic' and s.month = p_month and g.staff_id = p_staff order by g.revision desc limit 1), 0)
$$;

-- Net = round(HO) - round(advance) + round(generic final) + sum(sign x round(custom column)), columns in effect that month.
create function public.mgmt_salary_net(p_ho numeric, p_advance numeric, p_generic numeric, p_extras jsonb, p_month date) returns numeric
language sql stable security definer set search_path = public as $$
  select public.mgmt_rup(p_ho) - public.mgmt_rup(p_advance) + public.mgmt_rup(p_generic)
    + coalesce((select sum(c.sign * public.mgmt_rup((p_extras ->> c.id::text)::numeric))
                from public.mgmt_salary_columns c
                where c.active_from <= p_month and (c.retired_from is null or p_month < c.retired_from) and p_extras ? c.id::text), 0)
$$;

-- ───────── rates ─────────
create function public.mgmt_rates_list() returns table (rate_key text, rate numeric, reason text, set_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view') or public.has_perm('mgmt.incentive') or public.has_perm('mgmt.rates')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select distinct on (r.rate_key) r.rate_key, r.rate, r.reason, r.created_at from public.mgmt_rates r order by r.rate_key, r.seq desc;
end $$;

create function public.mgmt_rate_set(p_rate_key text, p_rate numeric, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; old_r numeric; v_id uuid; res jsonb; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_perm('mgmt.rates') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'rate_set');
  if cached is not null then return cached; end if;
  if p_rate_key not in ('generic_staff') then raise exception 'unknown rate'; end if;
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

-- ───────── custom salary columns ─────────
create function public.mgmt_salary_columns(p_month date)
returns table (column_id uuid, name text, sign int, active_from date, retired_from date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  return query select c.id, c.name, c.sign::int, c.active_from, c.retired_from from public.mgmt_salary_columns c
    where c.active_from <= p_month and (c.retired_from is null or p_month < c.retired_from) order by c.created_at, c.id;
end $$;

create function public.mgmt_salary_column_add(p_name text, p_sign int, p_from date, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; cached jsonb; v_id uuid; res jsonb; v_name text := trim(coalesce(p_name, ''));
begin
  if not public.has_perm('mgmt.salary') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'salary_column_add');
  if cached is not null then return cached; end if;
  if length(v_name) not between 1 and 40 then raise exception 'a column name must be 1 to 40 characters'; end if;
  if p_sign not in (1, -1) then raise exception 'a column either adds (+) or subtracts (-)'; end if;
  if p_from is null or p_from <> date_trunc('month', p_from)::date or p_from > date_trunc('month', today)::date or p_from < date '2000-01-01' then
    raise exception 'start month must be the first of a month that has begun';
  end if;
  begin
    insert into public.mgmt_salary_columns (name, sign, active_from, created_by) values (v_name, p_sign, p_from, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'a column with that name already exists';
  end;
  perform public.log_activity('mgmt.salary_column_added', 'mgmt_salary_columns', v_id::text, null,
    jsonb_build_object('name', v_name, 'sign', p_sign, 'active_from', p_from), null);
  res := jsonb_build_object('id', v_id);
  perform public.mgmt_idem_put(p_key, 'salary_column_add', res);
  return res;
end $$;

create function public.mgmt_salary_column_retire(p_column_id uuid, p_from date, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; cached jsonb; c public.mgmt_salary_columns; res jsonb;
begin
  if not public.has_perm('mgmt.salary') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'salary_column_retire');
  if cached is not null then return cached; end if;
  select * into c from public.mgmt_salary_columns where id = p_column_id for update;
  if not found then raise exception 'unknown column'; end if;
  if c.retired_from is not null then raise exception 'this column is already retired'; end if;
  if p_from is null or p_from <> date_trunc('month', p_from)::date or p_from <= c.active_from or p_from > (date_trunc('month', today) + interval '1 month')::date then
    raise exception 'retire from the first of a month after it started, no later than next month';
  end if;
  -- a retired column must not hide money: refuse while any current row, from that month on, still holds an amount in it
  if exists (
    select 1 from (select distinct on (r.sheet_id, r.staff_id) r.extras, s.month from public.mgmt_salary_rows r
                   join public.mgmt_sheets s on s.id = r.sheet_id order by r.sheet_id, r.staff_id, r.revision desc) x
    where x.month >= p_from and coalesce((x.extras ->> p_column_id::text)::numeric, 0) <> 0) then
    raise exception 'amounts still exist in this column from that month on';
  end if;
  update public.mgmt_salary_columns set retired_from = p_from where id = p_column_id;
  perform public.log_activity('mgmt.salary_column_retired', 'mgmt_salary_columns', p_column_id::text, null,
    jsonb_build_object('name', c.name, 'retired_from', p_from), null);
  res := jsonb_build_object('id', p_column_id);
  perform public.mgmt_idem_put(p_key, 'salary_column_retire', res);
  return res;
end $$;

-- ───────── Generic sheet ─────────
create function public.mgmt_generic_month(p_month date)
returns table (staff_id uuid, full_name text, staff_code text, designation text, sort_order int, active boolean,
               has_row boolean, revision int, generic_sale numeric, extra numeric, rate numeric, incentive numeric, final numeric, closed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_sheet public.mgmt_sheets; v_rate numeric;
begin
  if not (public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'generic';
  v_rate := coalesce(v_sheet.rate, public.mgmt_rate_now('generic_staff'));
  return query
  with cur as (
    select distinct on (g.staff_id) g.* from public.mgmt_generic_rows g where g.sheet_id = v_sheet.id order by g.staff_id, g.revision desc
  )
  select s.id, s.full_name, d.staff_code, d.designation, coalesce(d.sort_order, 999), s.active, (cur.id is not null), cur.revision,
         coalesce(cur.generic_sale, 0), coalesce(cur.extra, 0), v_rate, coalesce(cur.incentive, 0), coalesce(cur.final, 0), (v_sheet.closed_at is not null)
  from public.staff s
  left join public.mgmt_staff_details d on d.staff_id = s.id
  left join cur on cur.staff_id = s.id
  where s.active or cur.id is not null
  order by coalesce(d.sort_order, 999), s.full_name, s.id;
end $$;

create function public.mgmt_generic_save(p_month date, p_rows jsonb, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; v_sheet public.mgmt_sheets; e jsonb; cur public.mgmt_generic_rows; v_staff uuid;
  v_sale numeric; v_extra numeric; v_inc numeric; v_fin numeric; v_changed int := 0; v_same int := 0; res jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_perm('mgmt.salary') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'generic_save');
  if cached is not null then return cached; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month > date_trunc('month', today)::date or p_month < date '2000-01-01' then
    raise exception 'pick a month that has begun, as the first of the month';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then raise exception 'rows must be a list of at most 300'; end if;
  insert into public.mgmt_sheets (month, kind, rate, created_by) values (p_month, 'generic', public.mgmt_rate_now('generic_staff'), auth.uid())
    on conflict (month, kind) do nothing;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'generic' for update;
  if v_sheet.closed_at is not null and (v_reason is null or length(v_reason) < 3) then raise exception 'this month is closed: a reason is required to revise it'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;

  for e in select * from jsonb_array_elements(p_rows) loop
    if coalesce(e ->> 'staff_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'a row has no valid staff id'; end if;
    v_staff := (e ->> 'staff_id')::uuid;
    if not exists (select 1 from public.staff where id = v_staff) then raise exception 'unknown staff member'; end if;
    if coalesce(e ->> 'generic_sale', '') !~ '^-?[0-9]+(\.[0-9]+)?$' or coalesce(e ->> 'extra', '0') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'amounts must be numbers'; end if;
    v_sale := public.mgmt_rup((e ->> 'generic_sale')::numeric);
    v_extra := public.mgmt_rup(coalesce(e ->> 'extra', '0')::numeric);
    if abs(v_sale) > 1000000000 or abs(v_extra) > 1000000000 then raise exception 'an amount is out of range'; end if;
    v_inc := public.mgmt_rup(v_sale * v_sheet.rate);
    v_fin := v_inc + v_extra;
    select * into cur from public.mgmt_generic_rows where sheet_id = v_sheet.id and staff_id = v_staff order by revision desc limit 1;
    if cur.id is null and v_sale = 0 and v_extra = 0 then continue; end if;
    if cur.id is not null and cur.generic_sale = v_sale and cur.extra = v_extra then v_same := v_same + 1; continue; end if;
    insert into public.mgmt_generic_rows (sheet_id, staff_id, revision, generic_sale, extra, incentive, final, reason, created_by)
      values (v_sheet.id, v_staff, coalesce(cur.revision + 1, 0), v_sale, v_extra, v_inc, v_fin, v_reason, auth.uid());
    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    perform public.log_activity('mgmt.generic_saved', 'mgmt_sheets', v_sheet.id::text, null,
      jsonb_build_object('month', p_month, 'rows_changed', v_changed, 'closed', v_sheet.closed_at is not null), v_reason);
  end if;
  res := jsonb_build_object('sheet_id', v_sheet.id, 'changed', v_changed, 'unchanged', v_same);
  perform public.mgmt_idem_put(p_key, 'generic_save', res);
  return res;
end $$;

-- ───────── Salary sheet ─────────
-- advance / generic show the saved figures once the month is closed, live figures before that. advance_live and generic_live
-- are always the live figures so a mismatch with a closed month can be flagged (MGR-16). credit_deduction is what the credit
-- sheet deducts as "salary" that month, for the same flag.
create function public.mgmt_salary_month(p_month date)
returns table (staff_id uuid, full_name text, staff_code text, designation text, sort_order int, active boolean,
               has_row boolean, revision int, ho_salary numeric, ho_carried boolean, days int, extras jsonb,
               advance numeric, advance_live numeric, generic numeric, generic_live numeric, credit_deduction numeric,
               net numeric, closed boolean, entries jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_sheet public.mgmt_sheets; v_closed boolean;
begin
  if not (public.has_perm('mgmt.salary') or public.has_perm('mgmt.salary_view')) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'salary';
  v_closed := v_sheet.closed_at is not null;
  return query
  with cur as (
    select distinct on (r.staff_id) r.* from public.mgmt_salary_rows r where r.sheet_id = v_sheet.id order by r.staff_id, r.revision desc
  ), carry as (
    select distinct on (r.staff_id) r.staff_id, r.ho_salary from public.mgmt_salary_rows r join public.mgmt_sheets s on s.id = r.sheet_id
    where s.kind = 'salary' and s.month < p_month order by r.staff_id, s.month desc, r.revision desc
  ), adv as (
    select e.staff_id,
      coalesce(sum(e.amount) filter (where e.kind = 'entry'), 0) as a,
      coalesce(-sum(e.amount) filter (where e.kind = 'salary_deduction'), 0) as cd,
      coalesce(jsonb_agg(jsonb_build_object('entry_date', e.entry_date, 'description', e.description, 'amount', e.amount)
        order by e.entry_date, e.seq) filter (where e.kind = 'entry'), '[]'::jsonb) as ent
    from public.mgmt_credit_entries e where e.entry_date >= p_month and e.entry_date < (p_month + interval '1 month')::date group by e.staff_id
  ), base as (
    select s.id as sid, s.full_name as fname, d.staff_code as scode, d.designation as desg, coalesce(d.sort_order, 999) as so, s.active as act,
      (cur.id is not null) as hr, cur.revision as rev, coalesce(cur.ho_salary, carry.ho_salary, 0) as ho,
      (cur.id is null and carry.staff_id is not null) as carried, coalesce(cur.days, 31) as dys, coalesce(cur.extras, '{}'::jsonb) as ex,
      coalesce(adv.a, 0) as adv_live, public.mgmt_generic_final_for(p_month, s.id) as gen_live, coalesce(adv.cd, 0) as cdd,
      coalesce(adv.ent, '[]'::jsonb) as ent, cur.advance_used as au, cur.generic_used as gu, cur.net as saved_net
    from public.staff s
    left join public.mgmt_staff_details d on d.staff_id = s.id
    left join cur on cur.staff_id = s.id
    left join carry on carry.staff_id = s.id
    left join adv on adv.staff_id = s.id
    where s.active or cur.id is not null
  )
  select b.sid, b.fname, b.scode, b.desg, b.so, b.act, b.hr, b.rev, b.ho, b.carried, b.dys, b.ex,
    case when v_closed and b.hr then b.au else b.adv_live end,
    b.adv_live,
    case when v_closed and b.hr then b.gu else b.gen_live end,
    b.gen_live, b.cdd,
    case when v_closed and b.hr then b.saved_net else public.mgmt_salary_net(b.ho, b.adv_live, b.gen_live, b.ex, p_month) end,
    v_closed, b.ent
  from base b order by b.so, b.fname, b.sid;
end $$;

create function public.mgmt_salary_save(p_month date, p_rows jsonb, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; v_sheet public.mgmt_sheets; e jsonb; cur public.mgmt_salary_rows; v_staff uuid; kv record;
  v_ho numeric; v_days int; v_extras jsonb; n numeric; v_adv numeric; v_gen numeric; v_net numeric;
  v_changed int := 0; v_same int := 0; res jsonb; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_perm('mgmt.salary') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'salary_save');
  if cached is not null then return cached; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month > date_trunc('month', today)::date or p_month < date '2000-01-01' then
    raise exception 'pick a month that has begun, as the first of the month';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then raise exception 'rows must be a list of at most 300'; end if;
  insert into public.mgmt_sheets (month, kind, created_by) values (p_month, 'salary', auth.uid()) on conflict (month, kind) do nothing;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'salary' for update;
  if v_sheet.closed_at is not null and (v_reason is null or length(v_reason) < 3) then raise exception 'this month is closed: a reason is required to revise it'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;

  for e in select * from jsonb_array_elements(p_rows) loop
    if coalesce(e ->> 'staff_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'a row has no valid staff id'; end if;
    v_staff := (e ->> 'staff_id')::uuid;
    if not exists (select 1 from public.staff where id = v_staff) then raise exception 'unknown staff member'; end if;
    if coalesce(e ->> 'ho_salary', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'HO salary must be a number'; end if;
    v_ho := public.mgmt_rup((e ->> 'ho_salary')::numeric);
    if abs(v_ho) > 1000000000 then raise exception 'an amount is out of range'; end if;
    if coalesce(e ->> 'days', '31') !~ '^[0-9]{1,2}$' then raise exception 'days must be 0 to 31'; end if;
    v_days := coalesce(e ->> 'days', '31')::int;
    if v_days > 31 then raise exception 'days must be 0 to 31'; end if;
    v_extras := '{}'::jsonb;
    if e ? 'extras' and jsonb_typeof(e -> 'extras') <> 'object' then raise exception 'extras must be an object'; end if;
    for kv in select key, value from jsonb_each_text(coalesce(e -> 'extras', '{}'::jsonb)) loop
      if not exists (select 1 from public.mgmt_salary_columns c where c.id::text = kv.key and c.active_from <= p_month
                     and (c.retired_from is null or p_month < c.retired_from)) then
        raise exception 'unknown or retired salary column';
      end if;
      if kv.value !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'column amounts must be numbers'; end if;
      n := public.mgmt_rup(kv.value::numeric);
      if abs(n) > 1000000000 then raise exception 'an amount is out of range'; end if;
      if n <> 0 then v_extras := v_extras || jsonb_build_object(kv.key, n); end if;
    end loop;
    v_adv := public.mgmt_advance_for(p_month, v_staff);
    v_gen := public.mgmt_generic_final_for(p_month, v_staff);
    v_net := public.mgmt_salary_net(v_ho, v_adv, v_gen, v_extras, p_month);
    select * into cur from public.mgmt_salary_rows where sheet_id = v_sheet.id and staff_id = v_staff order by revision desc limit 1;
    if cur.id is null and v_ho = 0 and v_extras = '{}'::jsonb and v_days = 31 then continue; end if;
    if cur.id is not null and cur.ho_salary = v_ho and cur.days = v_days and cur.extras = v_extras
       and cur.advance_used = public.mgmt_rup(v_adv) and cur.generic_used = v_gen then
      v_same := v_same + 1; continue;
    end if;
    insert into public.mgmt_salary_rows (sheet_id, staff_id, revision, ho_salary, days, extras, advance_used, generic_used, net, reason, created_by)
      values (v_sheet.id, v_staff, coalesce(cur.revision + 1, 0), v_ho, v_days, v_extras, public.mgmt_rup(v_adv), v_gen, v_net, v_reason, auth.uid());
    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    perform public.log_activity('mgmt.salary_saved', 'mgmt_sheets', v_sheet.id::text, null,
      jsonb_build_object('month', p_month, 'rows_changed', v_changed, 'closed', v_sheet.closed_at is not null), v_reason);
  end if;
  res := jsonb_build_object('sheet_id', v_sheet.id, 'changed', v_changed, 'unchanged', v_same);
  perform public.mgmt_idem_put(p_key, 'salary_save', res);
  return res;
end $$;

-- ───────── Close month ─────────
-- Salary is closed after Generic (the salary figures include the generic final). Closing Salary refreshes each row's saved
-- advance and generic so the closed month keeps exactly the numbers the owner saw when closing.
create function public.mgmt_sheet_close(p_month date, p_kind text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cached jsonb; v_sheet public.mgmt_sheets; cur public.mgmt_salary_rows; v_adv numeric; v_gen numeric; v_net numeric; n int := 0; res jsonb;
begin
  if not public.has_perm('mgmt.close_month') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'sheet_close');
  if cached is not null then return cached; end if;
  if p_kind not in ('salary', 'generic') then raise exception 'unknown sheet'; end if;
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

-- ───────── grants ─────────
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_rup(numeric), public.mgmt_sheets_guard(), public.mgmt_columns_guard(),
  public.mgmt_rate_now(text), public.mgmt_advance_for(date, uuid), public.mgmt_generic_final_for(date, uuid),
  public.mgmt_salary_net(numeric, numeric, numeric, jsonb, date),
  public.mgmt_rates_list(), public.mgmt_rate_set(text, numeric, text, uuid),
  public.mgmt_salary_columns(date), public.mgmt_salary_column_add(text, int, date, uuid), public.mgmt_salary_column_retire(uuid, date, uuid),
  public.mgmt_generic_month(date), public.mgmt_generic_save(date, jsonb, text, uuid),
  public.mgmt_salary_month(date), public.mgmt_salary_save(date, jsonb, text, uuid), public.mgmt_sheet_close(date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mgmt_rates_list(), public.mgmt_rate_set(text, numeric, text, uuid),
  public.mgmt_salary_columns(date), public.mgmt_salary_column_add(text, int, date, uuid), public.mgmt_salary_column_retire(uuid, date, uuid),
  public.mgmt_generic_month(date), public.mgmt_generic_save(date, jsonb, text, uuid),
  public.mgmt_salary_month(date), public.mgmt_salary_save(date, jsonb, text, uuid), public.mgmt_sheet_close(date, text, uuid) to authenticated;
