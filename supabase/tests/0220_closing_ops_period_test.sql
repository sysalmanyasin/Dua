-- Tests for 0220_closing_ops_period.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t');
insert into public.closing_slots(id, business_date, kind, seq) values
  ('20000000-0000-0000-0000-000000000001', '2026-11-10', 'evening', 9999),
  ('20000000-0000-0000-0000-000000000002', '2026-11-10', 'morning', 20),
  ('20000000-0000-0000-0000-000000000003', '2026-11-11', 'evening', 9999),
  ('20000000-0000-0000-0000-000000000004', '2026-11-30', 'evening', 9999);
insert into public.closings(id, slot_id, status, entered_by, idempotency_key) values
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid()),
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid()),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid()),
  ('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid());
update public.closings set status = 'submitted', submitted_at = now() where id in ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004');
-- 10 Nov: two submitted (one date); 11 Nov: one draft; 30 Nov: outside the window
select pg_temp.ok((select days_with_closing from public.closing_ops_period('2026-11-01', '2026-11-20')) = 1, 'two closings on one date count as one day');
select pg_temp.ok((select submitted from public.closing_ops_period('2026-11-01', '2026-11-20')) = 2, 'both submitted closings are counted');
select pg_temp.ok((select open_drafts from public.closing_ops_period('2026-11-01', '2026-11-20')) = 1, 'the open draft is counted');
select pg_temp.ok((select days_with_closing from public.closing_ops_period('2026-11-01', '2026-11-30')) = 2, 'a wider window includes the later date');
select pg_temp.ok((select days_with_closing from public.closing_ops_period('2026-10-01', '2026-10-31')) = 0, 'an empty window gives zero, not null');
select pg_temp.ok((select count(*) from pg_proc p where p.proname = 'closing_ops_period' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the browser roles cannot call it');
rollback;
