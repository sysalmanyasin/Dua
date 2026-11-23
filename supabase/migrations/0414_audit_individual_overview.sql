-- 0414_audit_individual_overview — Individual audits of one month, grouped by person (F6 / P5).
--  * audit_individual_overview(p_month): every Individual round of the month with who counted it, when, and how it turned out.
--    People A–Z, each person's rounds newest first. Read only.
--  * Who may call it: audit.view or audit.manage; rows only from an engagement the caller may view (audit_can_view).
--  * The month is 'YYYY-MM'; empty means the current month in Asia/Karachi. A bad month is refused (invalid_month).
--  * Variance figures are NULL, not 0, until the round is compiled. An Individual round compiles itself on submit (0412).

create function public.audit_individual_overview(p_month text default null)
returns table (month text, person_id uuid, person_name text, engagement_id uuid, round_id uuid, round_label text, state text,
               started_at timestamptz, compiled_at timestamptz, item_count int, variance_count int, variance_value numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_month text := nullif(btrim(coalesce(p_month, '')), '');
begin
  if not (public.has_perm('audit.view') or public.has_perm('audit.manage')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_month is null then v_month := to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM'); end if;
  if v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'month not valid' using errcode = '22023', hint = 'invalid_month';
  end if;

  return query
  select e.scope_month, a.auditor_id, coalesce(public.audit_person_name(a.auditor_id), 'Unknown'), e.id, r.id,
         public.audit_round_label(r.round_number, r.round_suffix), r.state,
         coalesce(a.started_at, a.created_at), r.compiled_at,
         k.item_count, k.variance_count, k.variance_value
  from public.audit_engagements e
  join public.audit_rounds r on r.engagement_id = e.id
  join public.audit_assignments a on a.round_id = r.id and a.status <> 'revoked' and a.method = 'individual-self-pick'
  left join lateral (select c.item_count, c.variance_count, c.variance_value from public.audit_compilations c
                     where c.round_id = r.id order by c.revision desc limit 1) k on r.state in ('compiled', 'final')
  where e.scope_type = 'individual' and e.scope_month = v_month and public.audit_can_view(e.id)
  order by lower(coalesce(public.audit_person_name(a.auditor_id), 'Unknown')), a.auditor_id,
           coalesce(a.started_at, a.created_at) desc, r.id;
end $$;

revoke all on function public.audit_individual_overview(text) from public, anon, authenticated;
grant execute on function public.audit_individual_overview(text) to authenticated;
