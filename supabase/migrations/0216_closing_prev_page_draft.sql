-- 0216_closing_prev_page_draft: the "previous closing" card and the live shift-sale / customer deltas read the closing a draft
-- carries from through closing_prev_page(draft_id). Since 0214, that function asked closing_can_read(draft_id), which is only true
-- for SUBMITTED closings, so for every draft it answered "not allowed". The card showed "You are not allowed to do that" and the
-- deltas had no previous figures to compare with.
-- Fix: authorise on the DRAFT (its author, or anyone with view_all / review / correct), then return the submitted source closing.
-- Read-only; nothing is written and no money rule changes. Existing grants are kept by CREATE OR REPLACE.
create or replace function public.closing_prev_page(p_closing uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if not found or not (
       public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
       or (public.has_perm('closing.enter_own') and (c.entered_by = auth.uid() or c.corrected_by = auth.uid()))
     ) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if c.source_closing_id is null then return null; end if;
  -- closing_page_json only returns submitted closings, and 0214 lets every closing user read those
  return public.closing_page_json(c.source_closing_id);
end $$;
