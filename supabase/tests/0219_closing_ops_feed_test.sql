-- Tests for 0219_closing_ops_feed.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Ayesha Khan');
insert into public.closing_slots(id, business_date, kind, seq) values
  ('20000000-0000-0000-0000-000000000001', '2026-11-18', 'evening', 9999),
  ('20000000-0000-0000-0000-000000000002', '2026-11-19', 'evening', 9999),
  ('20000000-0000-0000-0000-000000000003', '2026-11-20', 'evening', 9999);
-- 18 Nov: submitted with two deposit rows and one struck-through row; 19 Nov: draft saved 20 hours ago; 20 Nov: draft saved now
insert into public.closings(id, slot_id, status, entered_by, idempotency_key, responsible_staff_id) values
  ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','draft', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '10000000-0000-0000-0000-000000000001');
insert into public.closings(id, slot_id, status, entered_by, idempotency_key, updated_at) values
  ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), now() - interval '20 hours'),
  ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','draft','00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), now());
insert into public.closing_deposits(closing_id, label, amount, deleted_at) values
  ('30000000-0000-0000-0000-000000000001','Bank A', 100000, null),
  ('30000000-0000-0000-0000-000000000001','Bank B', 50000, null),
  ('30000000-0000-0000-0000-000000000001','Struck', 999999, now());
update public.closings set status = 'submitted', submitted_at = now() - interval '2 days' where id = '30000000-0000-0000-0000-000000000001';

select pg_temp.ok((select count(*) from public.closing_ops_feed(10)) = 3, 'the feed lists drafts and submitted closings');
select pg_temp.ok((select kind from public.closing_ops_feed(10) limit 1) = 'draft', 'newest first: the draft saved now leads');
select pg_temp.ok((select count(*) from public.closing_ops_feed(1)) = 1, 'the limit is respected');
select pg_temp.ok((select responsible from public.closing_ops_feed(10) where kind = 'submitted') = 'Ayesha Khan', 'the responsible person is named');
select pg_temp.ok((select count(*) from public.closing_ops_open_drafts(12)) = 1, 'only the draft older than 12 hours is open too long');
select pg_temp.ok((select count(*) from public.closing_ops_open_drafts(24)) = 0, 'nothing is open too long at 24 hours');
select pg_temp.ok(public.closing_ops_deposits('2026-11-18') = 150000, 'deposits add up the live rows and skip struck-through rows');
select pg_temp.ok(public.closing_ops_deposits('2026-11-19') is null, 'a date with no submitted closing has no deposit figure');

-- internal only: the browser roles cannot call them
select pg_temp.ok((select count(*) from pg_proc p where p.proname in ('closing_ops_feed','closing_ops_open_drafts','closing_ops_deposits')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the browser roles cannot call the closing feed functions');
rollback;
