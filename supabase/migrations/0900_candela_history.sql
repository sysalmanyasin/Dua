-- 0900_candela_history.sql — Candela Sales: permanent history of daily payments and customer credit.
-- Range 0900-0999 assigned to candela-sales by the owner (14 Nov 2026).
--
-- Why: the Candela feed carries only the last 4 days, and inventory_apply_sync replaces the landing tables
-- (sales_payment_summary, sales_credit_by_customer) on every run. These tables keep every day for good.
--
-- How: statement-level triggers on the two landing tables copy each incoming batch into the history tables inside the
-- SAME transaction as the sync. inventory_apply_sync itself is not edited, so nothing Inventory owns changes, and a
-- failed sync rolls the copy back with everything else. Days outside a batch are never touched. A repeat sync of the
-- same figures changes nothing; a changed figure keeps the old values in candela_changes.
--
-- Customer rows: Candela sends only a name. The same name (ignoring case and extra spaces) is ONE customer (owner, 14 Nov).
-- This table holds credit sales per customer per day. It is NOT an outstanding balance or an invoice list.

insert into public.permissions (key, description) values
 ('candela.view', 'See Candela sales history, payment breakdowns and customer credit summaries (owner)'),
 ('candela.today_total', 'See today''s Candela sales total only (one number)');

-- ───────── tables ─────────
create table public.candela_daily_payments (
  sale_day      date primary key,
  cash_sale     numeric(14,2) not null default 0,
  card_sale     numeric(14,2) not null default 0,
  credit_sale   numeric(14,2) not null default 0,
  total_sale    numeric(14,2) not null default 0,
  revision      integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.candela_credit_daily (
  sale_day      date not null,
  customer_key  text not null,
  customer_name text not null,
  credit_amount numeric(14,2) not null default 0,
  receipt_count integer not null default 0,
  revision      integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (sale_day, customer_key)
);
create index candela_credit_daily_customer_idx on public.candela_credit_daily (customer_key, sale_day);

-- Every time Candela changes a figure that was already stored, the old and new values are kept here. Append-only.
create table public.candela_changes (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('payment', 'credit')),
  sale_day     date not null,
  customer_key text,
  old_values   jsonb not null,
  new_values   jsonb not null,
  changed_at   timestamptz not null default now()
);
create index candela_changes_day_idx on public.candela_changes (sale_day, changed_at);

alter table public.candela_daily_payments enable row level security;
alter table public.candela_credit_daily enable row level security;
alter table public.candela_changes enable row level security;

-- Owner only (candela.view). Wrapped in a select so the check runs once per query, not once per row.
create policy candela_daily_payments_read on public.candela_daily_payments for select to authenticated
  using ((select public.has_perm('candela.view')));
create policy candela_credit_daily_read on public.candela_credit_daily for select to authenticated
  using ((select public.has_perm('candela.view')));
create policy candela_changes_read on public.candela_changes for select to authenticated
  using ((select public.has_perm('candela.view')));

revoke all on public.candela_daily_payments, public.candela_credit_daily, public.candela_changes from public, anon, authenticated;
grant select on public.candela_daily_payments, public.candela_credit_daily, public.candela_changes to authenticated;
-- no insert/update/delete grant and no write policy: only the triggers below (security definer) write.

-- ───────── one customer = one normalised name ─────────
create function public.candela_customer_key(p_name text) returns text
language sql immutable parallel safe set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

-- ───────── trigger: copy each incoming payment-summary batch into history ─────────
create function public.candela_keep_payments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- keep the old figures when an already-stored day changes
  insert into public.candela_changes (kind, sale_day, old_values, new_values)
  select 'payment', n.sale_day,
         jsonb_build_object('cash_sale', c.cash_sale, 'card_sale', c.card_sale, 'credit_sale', c.credit_sale, 'total_sale', c.total_sale),
         jsonb_build_object('cash_sale', round(n.cash_sale, 2), 'card_sale', round(n.card_sale, 2),
                            'credit_sale', round(n.credit_sale, 2), 'total_sale', round(n.total_sale, 2))
  from new_rows n
  join public.candela_daily_payments c on c.sale_day = n.sale_day
  where (c.cash_sale, c.card_sale, c.credit_sale, c.total_sale)
        is distinct from (round(n.cash_sale, 2), round(n.card_sale, 2), round(n.credit_sale, 2), round(n.total_sale, 2));

  insert into public.candela_daily_payments as c (sale_day, cash_sale, card_sale, credit_sale, total_sale)
  select n.sale_day, round(n.cash_sale, 2), round(n.card_sale, 2), round(n.credit_sale, 2), round(n.total_sale, 2)
  from new_rows n
  on conflict (sale_day) do update set
    cash_sale = excluded.cash_sale, card_sale = excluded.card_sale,
    credit_sale = excluded.credit_sale, total_sale = excluded.total_sale,
    revision = c.revision + case when (c.cash_sale, c.card_sale, c.credit_sale, c.total_sale)
                                    is distinct from (excluded.cash_sale, excluded.card_sale, excluded.credit_sale, excluded.total_sale)
                                 then 1 else 0 end,
    updated_at = case when (c.cash_sale, c.card_sale, c.credit_sale, c.total_sale)
                         is distinct from (excluded.cash_sale, excluded.card_sale, excluded.credit_sale, excluded.total_sale)
                      then now() else c.updated_at end,
    last_seen_at = now();
  return null;
end $$;

-- ───────── trigger: same for customer credit (rows of one customer on one day are added together) ─────────
create function public.candela_keep_credit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  with b as (
    select n.sale_day, public.candela_customer_key(n.customer_name) as customer_key,
           (array_agg(n.customer_name order by n.credit_amount desc, n.customer_name))[1] as customer_name,
           round(sum(n.credit_amount), 2) as credit_amount, sum(n.receipt_count)::integer as receipt_count
    from new_rows n
    group by n.sale_day, public.candela_customer_key(n.customer_name)
  ), logged as (
    -- keep the old figures when an already-stored customer/day changes
    insert into public.candela_changes (kind, sale_day, customer_key, old_values, new_values)
    select 'credit', b.sale_day, b.customer_key,
           jsonb_build_object('credit_amount', c.credit_amount, 'receipt_count', c.receipt_count),
           jsonb_build_object('credit_amount', b.credit_amount, 'receipt_count', b.receipt_count)
    from b
    join public.candela_credit_daily c on c.sale_day = b.sale_day and c.customer_key = b.customer_key
    where (c.credit_amount, c.receipt_count) is distinct from (b.credit_amount, b.receipt_count)
  )
  insert into public.candela_credit_daily as c (sale_day, customer_key, customer_name, credit_amount, receipt_count)
  select b.sale_day, b.customer_key, case when b.customer_key = '' then '(no name)' else btrim(b.customer_name) end,
         b.credit_amount, b.receipt_count
  from b
  on conflict (sale_day, customer_key) do update set
    credit_amount = excluded.credit_amount, receipt_count = excluded.receipt_count,
    revision = c.revision + case when (c.credit_amount, c.receipt_count)
                                    is distinct from (excluded.credit_amount, excluded.receipt_count) then 1 else 0 end,
    updated_at = case when (c.credit_amount, c.receipt_count)
                         is distinct from (excluded.credit_amount, excluded.receipt_count) then now() else c.updated_at end,
    last_seen_at = now();
  return null;
end $$;

revoke all on function public.candela_keep_payments(), public.candela_keep_credit(), public.candela_customer_key(text)
  from public, anon, authenticated;

create trigger candela_keep_payments_trg after insert on public.sales_payment_summary
  referencing new table as new_rows for each statement execute function public.candela_keep_payments();
create trigger candela_keep_credit_trg after insert on public.sales_credit_by_customer
  referencing new table as new_rows for each statement execute function public.candela_keep_credit();

-- ───────── capture what is in the landing tables right now (nothing is lost on first apply) ─────────
insert into public.candela_daily_payments (sale_day, cash_sale, card_sale, credit_sale, total_sale)
select sale_day, round(cash_sale, 2), round(card_sale, 2), round(credit_sale, 2), round(total_sale, 2)
from public.sales_payment_summary
on conflict (sale_day) do nothing;

insert into public.candela_credit_daily (sale_day, customer_key, customer_name, credit_amount, receipt_count)
select sale_day, public.candela_customer_key(customer_name),
       case when public.candela_customer_key(customer_name) = '' then '(no name)' else btrim((array_agg(customer_name order by credit_amount desc, customer_name))[1]) end,
       round(sum(credit_amount), 2), sum(receipt_count)::integer
from public.sales_credit_by_customer
group by sale_day, public.candela_customer_key(customer_name)
on conflict (sale_day, customer_key) do nothing;

-- ───────── the one number staff may see ─────────
create function public.candela_today_total() returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('candela.today_total') or public.has_perm('candela.view')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select total_sale from public.candela_daily_payments
          where sale_day = (now() at time zone 'Asia/Karachi')::date);
end $$;
revoke all on function public.candela_today_total() from public, anon, authenticated;
grant execute on function public.candela_today_total() to authenticated;
