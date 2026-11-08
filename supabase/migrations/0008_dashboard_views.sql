-- 0008: summary views behind the Sales Dashboard. They follow the caller's permissions (security_invoker),
-- so only people who may see sales history can read them.

-- One row per day: the total and how much of it came from cash, banks and credit clients.
create view public.v_daily_full with (security_invoker = true) as
select d.business_date, d.total, d.comp_sale, d.customers,
  coalesce(sum(case m.sign when 'add' then l.amount when 'sub' then -abs(l.amount) else 0 end) filter (where m.section = 'Cash'), 0) as cash,
  coalesce(sum(case m.sign when 'add' then l.amount when 'sub' then -abs(l.amount) else 0 end) filter (where m.section = 'Banks'), 0) as banks,
  coalesce(sum(case m.sign when 'add' then l.amount when 'sub' then -abs(l.amount) else 0 end) filter (where m.section = 'Credit Clients'), 0) as credit
from public.daily_sales d
left join public.daily_sale_lines l on l.business_date = d.business_date
left join public.payment_methods m on m.code = l.method_code
group by d.business_date;

-- One row per month: from daily detail where it exists, otherwise from the monthly-only figures.
create view public.v_monthly_full with (security_invoker = true) as
select date_trunc('month', business_date)::date as month, count(*)::int as days, sum(total) as total, sum(comp_sale) as comp_sale,
       sum(customers)::int as customers, sum(cash) as cash, sum(banks) as banks, sum(credit) as credit, false as monthly_only
from public.v_daily_full group by 1
union all
select h.month, 0, h.total, h.comp_sale, h.customers,
  coalesce(sum(case m.sign when 'add' then hl.amount when 'sub' then -abs(hl.amount) else 0 end) filter (where m.section = 'Cash'), 0),
  coalesce(sum(case m.sign when 'add' then hl.amount when 'sub' then -abs(hl.amount) else 0 end) filter (where m.section = 'Banks'), 0),
  coalesce(sum(case m.sign when 'add' then hl.amount when 'sub' then -abs(hl.amount) else 0 end) filter (where m.section = 'Credit Clients'), 0),
  true
from public.monthly_history h
left join public.monthly_history_lines hl on hl.month = h.month
left join public.payment_methods m on m.code = hl.method_code
where not exists (select 1 from public.daily_sales s where date_trunc('month', s.business_date)::date = h.month)
group by h.month, h.total, h.comp_sale, h.customers;

-- All-time sales per credit client (for the "top clients" chart).
create view public.v_client_totals with (security_invoker = true) as
select m.code, m.label, sum(x.amount) as total
from (
  select method_code, amount from public.daily_sale_lines
  union all
  select method_code, amount from public.monthly_history_lines
) x
join public.payment_methods m on m.code = x.method_code
where m.section = 'Credit Clients' and m.sign = 'add'
group by m.code, m.label;

grant select on public.v_daily_full, public.v_monthly_full, public.v_client_totals to authenticated;
