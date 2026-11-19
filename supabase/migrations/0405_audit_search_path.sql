-- 0405_audit_search_path — pins the search path on the audit helper and guard functions.
-- The Supabase security advisor flagged these five as having a role-mutable search_path. None is security definer and
-- none reads other tables by bare name, so this is hygiene only: behaviour does not change.
alter function public.audit_check_version(int, int) set search_path = public;
alter function public.audit_rounds_guard() set search_path = public;
alter function public.audit_round_items_guard() set search_path = public;
alter function public.audit_assignments_guard() set search_path = public;
alter function public.audit_append_only() set search_path = public;
