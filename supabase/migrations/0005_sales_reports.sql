-- 0005: report views for Sales. They follow the caller's permissions (security_invoker), so only people
-- who may see sales history can read them.

-- One row per day with the figures the Cash to be Deposited report needs.
create view public.v_daily_report with (security_invoker = true) as
select d.business_date, d.total, d.comp_sale, d.diff, d.customers, d.fdpp_pos, d.fdpp_consumer, d.cash_to_deposit,
       d.low_sale_reason,
       coalesce(sum(l.amount) filter (where l.method_code = 'cash_sale'), 0) as cash_sale,
       coalesce(sum(abs(l.amount)) filter (where l.method_code = 'cash_returns'), 0) as cash_returns
from public.daily_sales d
left join public.daily_sale_lines l on l.business_date = d.business_date
group by d.business_date;

grant select on public.v_daily_report to authenticated;
