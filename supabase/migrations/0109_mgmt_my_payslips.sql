-- 0109_mgmt_my_payslips: a person's OWN payslips, read only (Manager range 0100-0199).
-- Staff payroll is personal. This function takes no person as input: it finds the caller's own staff record through their
-- login and returns only that record's CLOSED months, using the values Manager saved when it closed the month (the same
-- values the Manager sheet shows for a closed month), so there is no second calculation. Months still open are not shown.
-- Nobody holds the permission by default: the owner grants payroll.view_own to the people who should see their own payslip.
insert into public.permissions (key, description) values
  ('payroll.view_own', 'See your own closed payslips on Home (read only). Granted by the owner to named people; no role carries it')
on conflict (key) do nothing;

create or replace function public.mgmt_my_payslips(p_months integer default 3) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid;
begin
  if not public.has_perm('payroll.view_own') then return null; end if;
  select staff_id into me from public.profiles where user_id = auth.uid();
  if me is null then return jsonb_build_object('payslips', '[]'::jsonb); end if;
  return jsonb_build_object('payslips', coalesce((
    select jsonb_agg(p order by (p ->> 'month') desc) from (
      select jsonb_build_object(
        'month', s.month,
        'closed_at', s.closed_at,
        'base_salary', public.mgmt_rup(r.ho_salary),
        'days', r.days,
        'advance_deducted', public.mgmt_rup(r.advance_used),
        'incentive', public.mgmt_rup(r.generic_used),
        'other', coalesce((
          select jsonb_agg(jsonb_build_object('name', c.name, 'sign', c.sign, 'amount', public.mgmt_rup((r.extras ->> c.id::text)::numeric)) order by c.name)
            from public.mgmt_salary_columns c
           where c.active_from <= s.month and (c.retired_from is null or s.month < c.retired_from) and r.extras ? c.id::text), '[]'::jsonb),
        'net', r.net) as p
        from public.mgmt_sheets s
        join lateral (select * from public.mgmt_salary_rows x where x.sheet_id = s.id and x.staff_id = me order by x.revision desc limit 1) r on true
       where s.kind = 'salary' and s.closed_at is not null
       order by s.month desc
       limit greatest(1, least(coalesce(p_months, 3), 12))) q), '[]'::jsonb));
end $$;
revoke all on function public.mgmt_my_payslips(integer) from public, anon, authenticated;
grant execute on function public.mgmt_my_payslips(integer) to authenticated;
