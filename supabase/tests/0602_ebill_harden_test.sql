\set ON_ERROR_STOP on
-- 0602: the immutability trigger helper is not callable by clients, and still protects the invoices.
begin;
do $t$ begin
  if has_function_privilege('anon', 'public.ebill_no_change()', 'execute') or has_function_privilege('authenticated', 'public.ebill_no_change()', 'execute') then
    raise exception 'FAIL: clients can execute ebill_no_change';
  end if;
  raise notice 'pass: clients cannot execute the trigger helper';
end $t$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t');
insert into public.ebill_devices(device_id, registered_by) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1');
insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
  values ('30000000-0000-0000-0000-000000000001','EB-T-1', current_date, '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','A','Cash',10,10,10,now());
do $t$ begin
  begin update public.ebill_invoices set net_total = 1; exception when others then raise notice 'pass: the freeze trigger still works without public execute'; return; end;
  raise exception 'FAIL: invoice was updated';
end $t$;
rollback;
