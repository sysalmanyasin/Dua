-- 0017_foundation_rls_auto_enable_revoke: Foundation. Closes the last advisor finding about rls_auto_enable() that is not
-- by design.
-- rls_auto_enable() is the project's event-trigger function "ensure_rls": it switches row level security on for every new
-- table in public. It is provided by the platform, so it exists on the live project but not on the plain PostgreSQL used by
-- CI; this migration therefore does nothing when the function is absent.
-- It was already revoked from PUBLIC and anon (13 Nov 2026). Signed-in users still held EXECUTE, which only lets them
-- call a trigger function that refuses to run outside a trigger, but the security advisor flags it. An event trigger does not
-- need the DDL-running role to hold EXECUTE (tested on PostgreSQL 16 with tables made by a role without it, by a signed-in
-- role, by the owner and by a superuser, including CREATE TABLE AS: all got row level security), so the grant is removed.
-- service_role and the owner keep EXECUTE. Rollback, if the platform ever needs it:
--   grant execute on function public.rls_auto_enable() to authenticated;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
