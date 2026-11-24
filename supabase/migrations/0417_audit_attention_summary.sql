-- 0417_audit_attention_summary — what needs the person's attention, with the rounds behind each number (F7 / N4). Read only.
--  * audit_attention_summary(): three lists, each only for a person who holds the key to act on it:
--      ready       audit.compile  rounds counting where every active assignment is submitted (at least one), Individual audits excluded
--      conflicts   audit.review   compiled rounds with conflicts still open in the latest compilation (n = how many)
--      corrections audit.review   corrections proposed and waiting in a round that is not final (n = how many)
--  * Only engagements the caller may see results of (audit_can_see_results). A badge number is the sum of n, or the row count for ready,
--    so it always equals the list it opens. Allowed to any person holding an audit key; others are refused (not_allowed).

create function public.audit_attention_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ready jsonb := '[]'; v_conf jsonb := '[]'; v_corr jsonb := '[]';
begin
  if not (public.has_perm('audit.view') or public.has_perm('audit.manage') or public.has_perm('audit.assign') or public.has_perm('audit.compile')
          or public.has_perm('audit.review') or public.has_perm('audit.report') or public.has_perm('audit.finalize')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;

  if public.has_perm('audit.compile') then
    select coalesce(jsonb_agg(jsonb_build_object('engagement_id', e.id, 'engagement_name', e.name, 'round_id', r.id,
             'round_label', public.audit_round_label(r.round_number, r.round_suffix), 'n', 1) order by e.name, r.round_number, r.id), '[]')
      into v_ready
    from public.audit_rounds r join public.audit_engagements e on e.id = r.engagement_id
    where r.state = 'counting' and e.scope_type <> 'individual' and public.audit_can_see_results(e.id)
      and exists (select 1 from public.audit_assignments a where a.round_id = r.id and a.status <> 'revoked')
      and not exists (select 1 from public.audit_assignments a where a.round_id = r.id and a.status not in ('revoked', 'submitted'));
  end if;

  if public.has_perm('audit.review') then
    select coalesce(jsonb_agg(jsonb_build_object('engagement_id', e.id, 'engagement_name', e.name, 'round_id', r.id,
             'round_label', public.audit_round_label(r.round_number, r.round_suffix), 'n', x.n) order by e.name, r.round_number, r.id), '[]')
      into v_conf
    from public.audit_rounds r join public.audit_engagements e on e.id = r.engagement_id
    join lateral (select count(*)::int n from public.audit_conflicts k
                  where k.compilation_id = (select c.id from public.audit_compilations c where c.round_id = r.id order by c.revision desc limit 1)
                    and k.resolved_side is null) x on x.n > 0
    where r.state = 'compiled' and public.audit_can_see_results(e.id);

    select coalesce(jsonb_agg(jsonb_build_object('engagement_id', e.id, 'engagement_name', e.name, 'round_id', r.id,
             'round_label', public.audit_round_label(r.round_number, r.round_suffix), 'n', x.n) order by e.name, r.round_number, r.id), '[]')
      into v_corr
    from public.audit_rounds r join public.audit_engagements e on e.id = r.engagement_id
    join lateral (select count(*)::int n from public.audit_corrections c where c.round_id = r.id and c.status = 'proposed') x on x.n > 0
    where r.state <> 'final' and public.audit_can_see_results(e.id);
  end if;

  return jsonb_build_object('ready', v_ready, 'conflicts', v_conf, 'corrections', v_corr);
end $$;

revoke all on function public.audit_attention_summary() from public, anon, authenticated;
grant execute on function public.audit_attention_summary() to authenticated;
