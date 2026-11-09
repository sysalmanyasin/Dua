-- 20261110090000: managing payment fields (add your own bank or client column, rename, hide, reorder, switch off).
-- A field that already has saved figures can be renamed, hidden or switched off, but never changed from add to subtract
-- (or moved between sections), because that would silently change old totals.

create or replace function public.payment_method_save(p_code text, p_label text, p_section text, p_sign text, p_show boolean, p_active boolean) returns text
language plpgsql security definer set search_path = public as $$
declare cur public.payment_methods; base text; newcode text; n int := 1;
begin
  if not public.has_perm('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_label is null or length(trim(p_label)) not between 1 and 60 then raise exception 'name must be 1 to 60 characters'; end if;
  if p_section not in ('Cash', 'Banks', 'Credit Clients') then raise exception 'bad section'; end if;
  if p_sign not in ('add', 'sub', 'none') then raise exception 'bad type'; end if;

  if p_code is null then
    base := trim(both '_' from regexp_replace(lower(trim(p_label)), '[^a-z0-9]+', '_', 'g'));
    base := 'c_' || coalesce(nullif(left(base, 34), ''), 'field');
    newcode := base;
    while exists (select 1 from public.payment_methods where code = newcode) loop
      n := n + 1;
      newcode := left(base, 36) || '_' || n;
    end loop;
    insert into public.payment_methods (code, label, section, sign, sort, show_in_entry, active)
    values (newcode, trim(p_label), p_section, p_sign, (select coalesce(max(sort), 0) + 10 from public.payment_methods), coalesce(p_show, true), true);
    perform public.log_activity('field.created', 'payment_methods', newcode, null, jsonb_build_object('label', trim(p_label), 'section', p_section, 'sign', p_sign), null);
    return newcode;
  end if;

  select * into cur from public.payment_methods where code = p_code for update;
  if not found then raise exception 'unknown field'; end if;
  if (cur.sign <> p_sign or cur.section <> p_section)
     and (exists (select 1 from public.daily_sale_lines where method_code = p_code) or exists (select 1 from public.monthly_history_lines where method_code = p_code)) then
    raise exception 'this field already has saved figures, so its type and section cannot change: hide it and add a new field instead';
  end if;
  update public.payment_methods set label = trim(p_label), section = p_section, sign = p_sign,
    show_in_entry = coalesce(p_show, show_in_entry), active = coalesce(p_active, active) where code = p_code;
  perform public.log_activity('field.updated', 'payment_methods', p_code,
    jsonb_build_object('label', cur.label, 'section', cur.section, 'sign', cur.sign, 'show', cur.show_in_entry, 'active', cur.active),
    jsonb_build_object('label', trim(p_label), 'section', p_section, 'sign', p_sign, 'show', coalesce(p_show, cur.show_in_entry), 'active', coalesce(p_active, cur.active)), null);
  return p_code;
end $$;

-- Puts the listed fields in the given order (fields not listed keep their place after them).
create or replace function public.payment_methods_reorder(p_codes text[]) returns void
language plpgsql security definer set search_path = public as $$
declare c text; i int := 0;
begin
  if not public.has_perm('settings.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(array_length(p_codes, 1), 0) > 200 then raise exception 'too many fields'; end if;
  foreach c in array coalesce(p_codes, '{}') loop
    i := i + 1;
    update public.payment_methods set sort = i * 10 where code = c;
  end loop;
  update public.payment_methods set sort = sort + i * 10 where code <> all (coalesce(p_codes, '{}')) and sort <= i * 10;
  perform public.log_activity('field.reordered', 'payment_methods', null, null, to_jsonb(p_codes), null);
end $$;

-- The settings screen needs to see switched-off fields too.
create policy methods_admin_read on public.payment_methods for select to authenticated using (public.has_perm('settings.manage'));

revoke all on function public.payment_method_save(text, text, text, text, boolean, boolean), public.payment_methods_reorder(text[]) from public, anon, authenticated;
grant execute on function public.payment_method_save(text, text, text, text, boolean, boolean), public.payment_methods_reorder(text[]) to authenticated;

-- Sale Book: every month with the amount of each payment field (daily detail where it exists, monthly figures otherwise).
create view public.v_monthly_methods with (security_invoker = true) as
select date_trunc('month', l.business_date)::date as month, l.method_code, sum(l.amount) as amount
from public.daily_sale_lines l group by 1, 2
union all
select hl.month, hl.method_code, hl.amount
from public.monthly_history_lines hl
where not exists (select 1 from public.daily_sales s where date_trunc('month', s.business_date)::date = hl.month);
grant select on public.v_monthly_methods to authenticated;
