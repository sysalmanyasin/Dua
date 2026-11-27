-- 0704_ops_closing_summary: the Owner's "Latest closing summary" on Home (range 0700-0749). Owner only: returns null for anyone
-- without ops.view (which also needs the second factor), like ops_bi_summary. The figures come from Closing's own internal
-- read (closing_ops_summary, 0227); this function holds no closing formula and never reads a closing table itself.
create or replace function public.ops_closing_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('ops.view') then return null; end if;
  return public.closing_ops_summary();
end $$;
revoke all on function public.ops_closing_summary() from public, anon, authenticated;
grant execute on function public.ops_closing_summary() to authenticated;
