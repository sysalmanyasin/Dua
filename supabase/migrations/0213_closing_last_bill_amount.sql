-- 0213_closing_last_bill_amount: the old Closing app's "Last Bill Amount" field (typed on the POS section, shown on the printed sheet,
-- never used in a calculation). Adds the column and teaches the three functions that write or copy the typed figures about it:
--   closing_apply_payload  reads 'last_bill_amt' from the draft payload,
--   closing_correct / closing_reopen  copy it onto the new revision (otherwise a corrected closing would lose it).
-- The functions are patched from their live definitions with a guard: if a replacement does not match, the migration stops.
-- No money rule changes; closing_calc / closing_build_input / closing_write_result are untouched.
alter table public.closings add column last_bill_amt numeric(14, 2) not null default 0 check (last_bill_amt >= 0);

do $mig$
declare d text; d2 text; fn text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'closing_apply_payload';
  d2 := replace(d,
    $a$    last_bill_no = case when p ? 'last_bill_no' then public.closing_qty(p -> 'last_bill_no', 'last_bill_no')::int else last_bill_no end,$a$,
    $a$    last_bill_no = case when p ? 'last_bill_no' then public.closing_qty(p -> 'last_bill_no', 'last_bill_no')::int else last_bill_no end,
    last_bill_amt = case when p ? 'last_bill_amt' then public.closing_qty(p -> 'last_bill_amt', 'last_bill_amt') else last_bill_amt end,$a$);
  if d is null or d2 = d then raise exception 'closing_apply_payload was not patched'; end if;
  execute d2;

  foreach fn in array array['closing_correct', 'closing_reopen'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    d2 := replace(d, 'last_bill_no, comp_sale', 'last_bill_no, last_bill_amt, comp_sale');
    if d is null or d2 = d then raise exception '% was not patched', fn; end if;
    execute d2;
  end loop;
end $mig$;
