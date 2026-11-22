-- 0015_core_trigger_search_path: pins the search_path of the two core trigger functions the Supabase security
-- advisor still flags as function_search_path_mutable (21 Nov 2026 audit): public.set_updated_at and
-- public.activity_log_immutable. Both were created in 0001 without a pinned path.
-- Neither is security definer, neither reads a table, and the only unqualified name either uses is now() (pg_catalog,
-- always searched first), so pinning changes no behaviour. The audit log stays append-only.
-- Both also kept the built-in PUBLIC execute right from 0001. A trigger function cannot be called directly and Postgres
-- does not check EXECUTE when a trigger fires, so nothing relies on it; it is removed to match the other guard functions.
alter function public.set_updated_at() set search_path = public;
alter function public.activity_log_immutable() set search_path = public;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.activity_log_immutable() from public, anon, authenticated;
