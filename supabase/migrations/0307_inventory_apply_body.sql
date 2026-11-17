-- 0307_inventory_apply_body.sql — Inventory module: end the hourly "statement timeout" failures.
--
-- Root cause (measured on the live project, 17 Nov 2026). The Edge Function sent the whole Dropbox file (about 6.7 MB of
-- JSON) as ONE named argument, p_payload, of inventory_apply_sync(). For a function with named arguments PostgREST
-- first reads the request body with json_to_record(...) and pulls p_payload out of it as jsonb. On a document this size
-- that extraction alone took 3 to 6 seconds on the live database (pg_stat_statements: mean 4.8 s, fastest 1.9 s, slowest
-- 7.9 s for the call), and that time counts against the 8-second statement limit of the API role BEFORE the function
-- starts. The function itself needs only about 0.8 s (measured, rolled back). So a normal run used 60% of the budget
-- and a slightly busy moment pushed it over: the "~7% of hourly runs fail, retry does not help" pattern.
--
-- Fix. A function with a SINGLE UNNAMED json/jsonb parameter receives the request body whole: PostgREST skips
-- json_to_record, and the body is parsed once (about 0.1 s). This migration adds that entry point. The body is
--   { "meta": { "source", "triggered_by", "force", "content_hash" }, "products": [...], "payment_summary": [...], ... }
-- and the function hands it to the existing inventory_apply_sync() unchanged (the extra "meta" key is ignored there).
-- inventory_apply_sync() itself is not touched: same logic, same locks, same guard, same log rows.
--
-- Grants: service role only, exactly like inventory_apply_sync (nobody else can sync).
create or replace function public.inventory_apply_sync_body(jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce($1 -> 'meta', '{}'::jsonb);
begin
  if jsonb_typeof($1) is distinct from 'object' then
    raise exception 'sync body must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_typeof(v_meta) is distinct from 'object' then
    raise exception 'sync body meta must be a JSON object' using errcode = '22023';
  end if;
  return public.inventory_apply_sync(
    $1,
    coalesce(nullif(v_meta ->> 'source', ''), 'dropbox'),
    nullif(v_meta ->> 'triggered_by', '')::uuid,
    coalesce((v_meta ->> 'force')::boolean, false),
    nullif(v_meta ->> 'content_hash', ''));
end $$;

revoke all on function public.inventory_apply_sync_body(jsonb) from public, anon, authenticated;
grant execute on function public.inventory_apply_sync_body(jsonb) to service_role;

comment on function public.inventory_apply_sync_body(jsonb) is
  'Whole-body entry point for the hourly sync (single unnamed jsonb parameter, so PostgREST does not re-parse the payload). Service role only.';
