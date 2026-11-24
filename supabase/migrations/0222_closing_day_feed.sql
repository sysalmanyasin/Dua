-- 0222_closing_day_feed.sql — Closing publishes ONE read-only interface for Sales' Add Entry auto-pull.
-- Range 0200-0299 (Closing). Registered in docs/MODULES.md section 8.1.
--
-- closing_day_feed(p_date) returns the figures of the SUBMITTED evening closing of that business day, or null when
-- there is none (no evening closing yet, or it is still a draft). It returns only what Sales needs: the system cash
-- total and the two card machines. It never returns drafts, and it does not widen who may read closings: the gate is
-- the same one closing_saved_list uses (migration 0214).
--
-- Sales reads it as: cash_sale = sys_cash, Bank Alfalah = alfalah, Bank Alfalah 2 = keenu.
create function public.closing_day_feed(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review')
          or public.has_perm('closing.correct') or public.has_perm('closing.settings')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_date is null then return null; end if;
  select jsonb_build_object(
           'closing_id', c.id, 'business_date', s.business_date, 'mode', c.mode, 'revision', c.revision,
           'submitted_at', c.submitted_at, 'sys_cash', c.sys_cash, 'alfalah', c.alfalah, 'keenu', c.keenu)
    into r
  from public.closings c
  join public.closing_slots s on s.id = c.slot_id
  where s.business_date = p_date and s.kind = 'evening' and c.status = 'submitted' and not c.is_opening
  order by c.revision desc
  limit 1;
  return r;
end $$;

revoke all on function public.closing_day_feed(date) from public, anon, authenticated;
grant execute on function public.closing_day_feed(date) to authenticated;
