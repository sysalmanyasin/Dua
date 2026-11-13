-- 0205_closing_trigger_grants: the three Closing trigger functions were created in 0201 without revoking the default
-- EXECUTE for PUBLIC, so `anon` and signed-in users could see them as RPC endpoints (a call fails: they are trigger-only,
-- but nothing should be exposed that does not need to be). Triggers keep working: the privilege is checked only when the
-- trigger is created. Also fixes the mutable search_path advisory on closing_results_append_only.
revoke all on function public.closing_lock_closing(), public.closing_lock_children(), public.closing_results_append_only()
  from public, anon, authenticated;
alter function public.closing_results_append_only() set search_path = public;
