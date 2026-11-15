-- 0621_ebill_staff_list.sql — what the Emergency Billing settings page needs about each login: PIN set or not, limits, may they bill.
-- Core tables are not readable from the browser, so this is a gated function. It never returns a PIN hash.

create or replace function public.ebill_staff_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('ebill.manage') or public.has_perm('ebill.set_pin')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', pr.user_id,
      'username', pr.username,
      'full_name', coalesce(s.full_name, pr.username),
      'role', pr.role_template,
      'disabled', pr.disabled_at is not null,
      'can_bill', pr.role_template = 'admin' or exists (select 1 from public.user_permissions up
                    where up.user_id = pr.user_id and up.perm_key = 'ebill.use' and up.effect = 'grant')
                  and not exists (select 1 from public.user_permissions up
                    where up.user_id = pr.user_id and up.perm_key = 'ebill.use' and up.effect = 'deny'),
      'has_pin', pn.user_id is not null,
      'pin_set_at', pn.set_at,
      'locked', coalesce(pn.locked_until > now(), false),
      'max_discount_pct', l.max_discount_pct,
      'max_discount_amount', l.max_discount_amount
    ) order by coalesce(s.full_name, pr.username))
    from public.profiles pr
    left join public.staff s on s.id = pr.staff_id
    left join public.ebill_pins pn on pn.user_id = pr.user_id
    left join public.ebill_staff_limits l on l.user_id = pr.user_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.ebill_staff_list() from public, anon, authenticated;
grant execute on function public.ebill_staff_list() to authenticated;
