-- 0901_candela_day_feed.sql — Candela Sales publishes ONE read-only interface for Sales' Add Entry auto-pull.
-- Range 0900-0999 (Candela Sales). Registered in docs/MODULES.md section 8.1.
--
-- candela_day_feed(p_date) returns what Candela sent for one business day: the payment summary and the customer-wise
-- credit rows, or null when Candela sent neither. The gate is candela.view (owner only), exactly like the history
-- tables: this function does not widen who may see Candela figures, and staff keep only candela_today_total().
create function public.candela_day_feed(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pay jsonb; cr jsonb;
begin
  if not public.has_perm('candela.view') then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_date is null then return null; end if;
  select jsonb_build_object('cash_sale', p.cash_sale, 'card_sale', p.card_sale, 'credit_sale', p.credit_sale,
                            'total_sale', p.total_sale, 'revision', p.revision)
    into pay from public.candela_daily_payments p where p.sale_day = p_date;
  select coalesce(jsonb_agg(jsonb_build_object('name', c.customer_name, 'amount', c.credit_amount, 'receipts', c.receipt_count)
                            order by c.customer_name), '[]'::jsonb)
    into cr from public.candela_credit_daily c where c.sale_day = p_date;
  if pay is null and jsonb_array_length(cr) = 0 then return null; end if;
  return jsonb_build_object('sale_day', p_date, 'payments', pay, 'credit', cr);
end $$;

revoke all on function public.candela_day_feed(date) from public, anon, authenticated;
grant execute on function public.candela_day_feed(date) to authenticated;
