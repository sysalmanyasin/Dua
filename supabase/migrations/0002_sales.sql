-- 0002_sales: daily sales, payment methods, revisions. See docs/SALES_DESIGN.md.
-- All writes go through sales_save_day(); browsers get no direct write access.

create table public.payment_methods (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (length(trim(label)) between 1 and 60),
  section text not null check (section in ('Cash', 'Banks', 'Credit Clients')),
  sign text not null check (sign in ('add', 'sub', 'none')),
  sort int not null default 100,
  show_in_entry boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.daily_sales (
  business_date date primary key check (business_date >= date '2000-01-01'),
  comp_sale numeric(14, 2),
  customers integer check (customers is null or customers >= 0),
  fdpp_pos numeric(14, 2),
  fdpp_consumer numeric(14, 2),
  amount_received numeric(14, 2),
  load_sale numeric(14, 2),
  cash_to_deposit numeric(14, 2),
  low_sale_reason text,
  total numeric(14, 2) not null,
  diff numeric(14, 2) generated always as (floor(total - coalesce(comp_sale, 0) + 0.5)) stored,
  revision integer not null default 1,
  source text not null default 'app' check (source in ('app', 'import')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_sale_lines (
  business_date date not null references public.daily_sales (business_date) on delete cascade,
  method_code text not null references public.payment_methods (code),
  amount numeric(14, 2) not null,
  primary key (business_date, method_code)
);

-- Immutable history: the previous version of a day, kept whenever it is corrected.
-- (Lines are a JSON snapshot here on purpose: this table is a frozen audit record, never queried for reports.)
create table public.daily_sales_revisions (
  id bigserial primary key,
  business_date date not null,
  revision integer not null,
  header jsonb not null,
  lines jsonb not null,
  replaced_by uuid references auth.users (id),
  replaced_at timestamptz not null default now(),
  reason text not null
);
create index daily_sales_revisions_date on public.daily_sales_revisions (business_date, revision);

-- Months that exist only as monthly figures (no daily detail).
create table public.monthly_history (
  month date primary key check (month = date_trunc('month', month)::date),
  total numeric(14, 2) not null,
  comp_sale numeric(14, 2),
  customers integer,
  note text,
  source text not null default 'import'
);
create table public.monthly_history_lines (
  month date not null references public.monthly_history (month) on delete cascade,
  method_code text not null references public.payment_methods (code),
  amount numeric(14, 2) not null,
  primary key (month, method_code)
);

create table public.sales_save_keys (
  key uuid primary key,
  user_id uuid not null,
  result jsonb not null,
  at timestamptz not null default now()
);

create trigger daily_sales_updated before update on public.daily_sales
  for each row execute function public.set_updated_at();

-- ───────── the one formula ─────────
-- Add columns count with their sign (a negative client value reduces the day, as the original stored totals do).
-- Subtract columns always subtract, whatever sign was typed. Info-only columns are ignored.
-- Rounds like JavaScript Math.round so the browser preview and the database agree to the rupee.
create or replace function public.sales_compute_total(p_lines jsonb) returns numeric
language sql stable set search_path = public as $$
  select floor(coalesce(sum(
    case m.sign
      when 'add' then (l ->> 'amount')::numeric
      when 'sub' then -abs((l ->> 'amount')::numeric)
      else 0
    end), 0) + 0.5)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  join public.payment_methods m on m.code = l ->> 'method'
$$;

-- ───────── save a day (new or corrected) ─────────
create or replace function public.sales_save_day(p_date date, p_header jsonb, p_lines jsonb, p_reason text, p_key uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  existing public.daily_sales;
  prev jsonb;
  new_total numeric;
  new_rev int;
  res jsonb;
  seen text[] := '{}';
  l jsonb;
  m_amt numeric;
  m_code text;
  cached public.sales_save_keys;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_key is null then raise exception 'idempotency key required'; end if;

  select * into cached from public.sales_save_keys where key = p_key;
  if found then
    if cached.user_id <> auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
    return cached.result;
  end if;

  if p_date is null or p_date > today then raise exception 'date cannot be in the future'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'lines must be a list'; end if;
  if jsonb_typeof(coalesce(p_header, '{}'::jsonb)) <> 'object' then raise exception 'header must be an object'; end if;

  select * into existing from public.daily_sales where business_date = p_date for update;
  if not found then
    if not public.has_perm('sales.enter') then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if not public.has_perm('sales.edit') then raise exception 'not allowed' using errcode = '42501'; end if;
    if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required to correct a saved day'; end if;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    m_code := l ->> 'method';
    m_amt := (l ->> 'amount')::numeric;
    if m_code is null or m_amt is null then raise exception 'each line needs a method and an amount'; end if;
    if abs(m_amt) > 1000000000 then raise exception 'amount out of range'; end if;
    if m_code = any (seen) then raise exception 'method % appears twice', m_code; end if;
    if not exists (select 1 from public.payment_methods pm where pm.code = m_code and pm.active) then
      raise exception 'unknown or inactive method %', m_code;
    end if;
    seen := seen || m_code;
  end loop;

  new_total := public.sales_compute_total(p_lines);

  if existing.business_date is not null then
    prev := to_jsonb(existing) - 'diff';
    insert into public.daily_sales_revisions (business_date, revision, header, lines, replaced_by, reason)
    values (p_date, existing.revision, prev,
      coalesce((select jsonb_agg(jsonb_build_object('method', method_code, 'amount', amount)) from public.daily_sale_lines where business_date = p_date), '[]'::jsonb),
      auth.uid(), p_reason);
    delete from public.daily_sale_lines where business_date = p_date;
    new_rev := existing.revision + 1;
    update public.daily_sales set
      comp_sale = nullif(p_header ->> 'comp_sale', '')::numeric,
      customers = nullif(p_header ->> 'customers', '')::integer,
      fdpp_pos = nullif(p_header ->> 'fdpp_pos', '')::numeric,
      fdpp_consumer = nullif(p_header ->> 'fdpp_consumer', '')::numeric,
      amount_received = nullif(p_header ->> 'amount_received', '')::numeric,
      load_sale = nullif(p_header ->> 'load_sale', '')::numeric,
      cash_to_deposit = nullif(p_header ->> 'cash_to_deposit', '')::numeric,
      low_sale_reason = nullif(trim(p_header ->> 'low_sale_reason'), ''),
      total = new_total, revision = new_rev, source = 'app'
    where business_date = p_date;
  else
    new_rev := 1;
    insert into public.daily_sales (business_date, comp_sale, customers, fdpp_pos, fdpp_consumer, amount_received,
      load_sale, cash_to_deposit, low_sale_reason, total, revision, created_by)
    values (p_date,
      nullif(p_header ->> 'comp_sale', '')::numeric, nullif(p_header ->> 'customers', '')::integer,
      nullif(p_header ->> 'fdpp_pos', '')::numeric, nullif(p_header ->> 'fdpp_consumer', '')::numeric,
      nullif(p_header ->> 'amount_received', '')::numeric, nullif(p_header ->> 'load_sale', '')::numeric,
      nullif(p_header ->> 'cash_to_deposit', '')::numeric, nullif(trim(p_header ->> 'low_sale_reason'), ''),
      new_total, 1, auth.uid());
  end if;

  insert into public.daily_sale_lines (business_date, method_code, amount)
  select p_date, x ->> 'method', (x ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  where (x ->> 'amount')::numeric <> 0;

  select jsonb_build_object('business_date', d.business_date, 'total', d.total, 'diff', d.diff, 'revision', d.revision)
    into res from public.daily_sales d where d.business_date = p_date;

  perform public.log_activity(case when new_rev = 1 then 'sales.created' else 'sales.corrected' end, 'daily_sales', p_date::text,
    prev, res, p_reason);
  insert into public.sales_save_keys (key, user_id, result) values (p_key, auth.uid(), res);
  return res;
end $$;

-- ───────── what staff may see: only the most recent closed day ─────────
create or replace function public.sales_last_closed_day() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; r record;
begin
  if not (public.has_perm('sales.view_last_day') or public.has_perm('sales.view_history')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select business_date, total into r from public.daily_sales where business_date < today order by business_date desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('business_date', r.business_date, 'total', r.total);
end $$;

-- ───────── derived monthly view (follows the caller's permissions) ─────────
create view public.v_monthly with (security_invoker = true) as
select date_trunc('month', business_date)::date as month,
       count(*)::int as days, sum(total) as total, sum(comp_sale) as comp_sale, sum(customers)::int as customers,
       floor(sum(total) - coalesce(sum(comp_sale), 0) + 0.5) as diff
from public.daily_sales group by 1;

-- ───────── RLS and grants ─────────
alter table public.payment_methods enable row level security;
alter table public.daily_sales enable row level security;
alter table public.daily_sale_lines enable row level security;
alter table public.daily_sales_revisions enable row level security;
alter table public.monthly_history enable row level security;
alter table public.monthly_history_lines enable row level security;
alter table public.sales_save_keys enable row level security;

create policy methods_read on public.payment_methods for select to authenticated
  using (public.has_perm('sales.enter') or public.has_perm('sales.edit') or public.has_perm('sales.view_history'));
create policy daily_read on public.daily_sales for select to authenticated using (public.has_perm('sales.view_history'));
create policy lines_read on public.daily_sale_lines for select to authenticated using (public.has_perm('sales.view_history'));
create policy revisions_read on public.daily_sales_revisions for select to authenticated using (public.has_perm('sales.view_history'));
create policy monthly_hist_read on public.monthly_history for select to authenticated using (public.has_perm('sales.view_history'));
create policy monthly_hist_lines_read on public.monthly_history_lines for select to authenticated using (public.has_perm('sales.view_history'));
-- sales_save_keys: no policy = service role only.

grant select on public.payment_methods, public.daily_sales, public.daily_sale_lines, public.daily_sales_revisions,
  public.monthly_history, public.monthly_history_lines, public.v_monthly to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.sales_compute_total(jsonb), public.sales_save_day(date, jsonb, jsonb, text, uuid),
  public.sales_last_closed_day() from public, anon, authenticated;
grant execute on function public.sales_compute_total(jsonb), public.sales_save_day(date, jsonb, jsonb, text, uuid),
  public.sales_last_closed_day() to authenticated;

-- ───────── seed: built-in payment methods ─────────
insert into public.payment_methods (code, label, section, sign, sort, show_in_entry) values
 ('cash_sale', 'Cash Sale', 'Cash', 'add', 10, true),
 ('cash_returns', 'Cash Returns', 'Cash', 'sub', 20, true),
 ('hbl', 'HBL', 'Banks', 'add', 30, false),
 ('mcb', 'MCB', 'Banks', 'add', 40, false),
 ('bank_alfalah', 'Bank Alfalah', 'Banks', 'add', 50, true),
 ('bank_al_habib', 'Bank Al Habib', 'Banks', 'add', 60, true),
 ('meezan_bank', 'Meezan Bank', 'Banks', 'add', 70, false),
 ('askari_bank', 'Askari', 'Credit Clients', 'add', 80, true),
 ('askari_returns', 'Askari Returns', 'Credit Clients', 'sub', 90, false),
 ('pso', 'PSO', 'Credit Clients', 'add', 100, true),
 ('pso_returns', 'PSO Returns', 'Credit Clients', 'sub', 110, false),
 ('nespak', 'NESPAK', 'Credit Clients', 'add', 120, true),
 ('nespak_returns', 'NESPAK Returns', 'Credit Clients', 'sub', 130, false),
 ('parco', 'PARCO', 'Credit Clients', 'add', 140, true),
 ('parco_returns', 'PARCO Returns', 'Credit Clients', 'sub', 150, false),
 ('tepa', 'TEPA', 'Credit Clients', 'add', 160, true),
 ('tepa_returns', 'TEPA Returns', 'Credit Clients', 'sub', 170, false),
 ('lda', 'LDA', 'Credit Clients', 'add', 180, true),
 ('lda_returns', 'LDA Returns', 'Credit Clients', 'sub', 190, false),
 ('gourmet', 'Gourmet', 'Credit Clients', 'add', 200, false),
 ('wapda_hospital', 'Wapda Hospital', 'Credit Clients', 'add', 210, false),
 ('bth', 'BTH', 'Credit Clients', 'add', 220, false),
 ('berger_paints', 'Berger Paints', 'Credit Clients', 'add', 230, false),
 ('ecolean_pk', 'Ecolean PK', 'Credit Clients', 'add', 240, false),
 ('style_textile', 'Style Textile', 'Credit Clients', 'add', 250, false),
 ('syed_babar_ali', 'Syed Babar Ali Foundation', 'Credit Clients', 'add', 260, false),
 ('rahnuma_ngo', 'Rahnuma NGO', 'Credit Clients', 'add', 270, false),
 ('health_pass', 'Health Pass', 'Credit Clients', 'add', 280, false),
 ('nisar_spinning', 'Nisar Spinning Mills', 'Credit Clients', 'add', 290, false),
 ('food_panda', 'Food Panda', 'Credit Clients', 'add', 300, false),
 ('f_issue', 'F/Issue', 'Credit Clients', 'add', 310, true);
