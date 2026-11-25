-- 0225_closing_list_variance: the start page shows each closing's variance next to the person responsible.
-- Range 0200-0299 (Closing). Additive and read-only: the two list functions keep their names, arguments, grants and every
-- existing key; they gain `shift_variance` and `final_variance` (null for a draft, which has no stored result yet).
begin;

create or replace function public.closing_saved_list(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review')
          or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.business_date desc, x.seq desc) from (
      select c.id as closing_id, c.idempotency_key as key, s.business_date, s.kind, s.seq, c.mode, c.status, c.revision, c.is_opening,
             c.supersedes_id, c.draft_version as version, c.submitted_at, c.updated_at, st.full_name as staff,
             r.shift_variance, r.final_variance
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      left join public.staff st on st.id = c.responsible_staff_id
      left join public.closing_results r on r.closing_id = c.id
      where c.status = 'submitted'
      order by s.business_date desc, s.seq desc
      limit greatest(1, least(coalesce(p_limit, 100), 300))
    ) x), '[]'::jsonb);
end $$;

create or replace function public.closing_my_recent(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.business_date desc, x.seq desc, x.revision desc) from (
      select c.id as closing_id, c.idempotency_key as key, s.business_date, s.kind, s.seq, c.mode, c.status, c.revision, c.is_opening,
             c.supersedes_id, c.draft_version as version, c.submitted_at, c.updated_at,
             (c.entered_by = auth.uid()) as mine, st.full_name as staff,
             r.shift_variance, r.final_variance
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      left join public.staff st on st.id = c.responsible_staff_id
      left join public.closing_results r on r.closing_id = c.id
      where c.status in ('draft', 'submitted')
        and ((c.supersedes_id is null and c.entered_by = auth.uid())
          or (c.supersedes_id is not null and c.status = 'draft' and c.corrected_by = auth.uid())
          or (c.status = 'draft' and c.supersedes_id is null and not c.is_opening
              and (public.has_perm('closing.enter_own') or public.closing_is_owner())))
      order by s.business_date desc, s.seq desc, c.revision desc
      limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) x), '[]');
end $$;

commit;
