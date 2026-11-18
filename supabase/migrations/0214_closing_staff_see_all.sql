-- 0214_closing_staff_see_all: staff with closing.enter_own may READ every submitted closing (read-only; nothing is written, no money rule changes).
-- 0212 limited a cashier to the sheets they entered. The owner wants all saved closings visible to staff, like the old app.
--   closing_can_read          any closing-permitted user may read a submitted closing (drafts stay private to their author)
--   closing_book_own          same page object as before, now every submitted closing for everyone with closing access
--   closing_saved_list(limit) light list of submitted closings (for the start page: calendar dots, Open / PDF, next slot)
create or replace function public.closing_can_read(p_closing uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.closings c
    where c.id = p_closing and c.status = 'submitted'
      and (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review')
           or public.has_perm('closing.correct') or public.has_perm('closing.settings'))
  )
$$;

create or replace function public.closing_book_own(p_from date default null, p_to date default null, p_limit int default 60, p_closing uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(public.closing_page_json(x.id) order by x.business_date desc, x.seq desc) from (
      select c.id, s.business_date, s.seq
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      where c.status = 'submitted'
        and (p_closing is null or c.id = p_closing)
        and (p_from is null or s.business_date >= p_from)
        and (p_to is null or s.business_date <= p_to)
      order by s.business_date desc, s.seq desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) x), '[]'::jsonb);
end $$;

create function public.closing_saved_list(p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review')
          or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return coalesce((
    select jsonb_agg(x order by x.business_date desc, x.seq desc) from (
      select c.id as closing_id, c.idempotency_key as key, s.business_date, s.kind, s.seq, c.mode, c.status, c.revision, c.is_opening,
             c.supersedes_id, c.draft_version as version, c.submitted_at, c.updated_at, st.full_name as staff
      from public.closings c join public.closing_slots s on s.id = c.slot_id
      left join public.staff st on st.id = c.responsible_staff_id
      where c.status = 'submitted'
      order by s.business_date desc, s.seq desc
      limit greatest(1, least(coalesce(p_limit, 100), 300))
    ) x), '[]'::jsonb);
end $$;
revoke all on function public.closing_saved_list(int) from public, anon, authenticated;
grant execute on function public.closing_saved_list(int) to authenticated;
