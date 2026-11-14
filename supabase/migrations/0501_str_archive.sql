-- 0501 (STR): the one definition of an STR's stage, and a short history of transfers.
-- Candela's export only carries the last few days, and the feed (0009/0302) deletes and reinserts the two feed tables on
-- every sync. STR keeps its own copy so an older transfer can still be found (STR-3, owner 13/14 Nov 2026: history is
-- kept for one month, fetched only when asked for or searched). The copy starts at the first run: nothing older than what
-- the feed holds then can be recovered, and nothing is imported from the old apps.
-- STR only READS the feed tables; it never writes to them. No foreign key points at them (they are rewritten hourly).

-- Stage: received if receive_status = 'Received', else dispatched if dispatch_status = 'Dispatched', else awaited.
-- str_status (Open/Close) is not used for stage. Every screen, search and alert goes through this one function.
create or replace function public.str_stage(p_dispatch_status text, p_receive_status text) returns text
language sql immutable parallel safe set search_path = public as $$
  select case when p_receive_status = 'Received' then 'received'
              when p_dispatch_status = 'Dispatched' then 'dispatched'
              else 'awaited' end
$$;
revoke all on function public.str_stage(text, text) from public, anon;
grant execute on function public.str_stage(text, text) to authenticated, service_role;

create table public.str_archive_headers (
  str_id           bigint primary key,
  str_number       text not null default '',
  master_str_id    text not null default '',
  ref_no           text not null default '',
  media            text not null default '',
  str_status       text not null default '',
  str_date         date,
  issued_by        text not null default '',
  dispatched_date  date,
  dispatch_status  text not null default '',
  dispatched_by    text not null default '',
  receive_date     date,
  receive_status   text not null default '',
  received_by      text not null default '',
  comments         text not null default '',
  dispatch_branch  text not null default '',
  receive_branch   text not null default '',
  direction        text not null default '' check (direction in ('in', 'out', '')),
  no_of_boxes      text not null default '',
  synced_at        timestamptz not null,
  archived_at      timestamptz not null default now()
);
create index str_archive_headers_date_idx on public.str_archive_headers (str_date desc);

create table public.str_archive_lines (
  str_id          bigint not null,
  str_item_id     integer not null,
  product_code    text not null default '',
  product_name    text not null default '',
  str_qty         numeric not null default 0,
  dispatch_qty    numeric,
  receive_qty     numeric,
  product_price   numeric not null default 0,
  cost_price      numeric not null default 0,
  primary key (str_id, str_item_id)
);
create index str_archive_lines_code_idx on public.str_archive_lines (product_code);

alter table public.str_archive_headers enable row level security;
alter table public.str_archive_lines enable row level security;
create policy str_archive_headers_read on public.str_archive_headers for select to authenticated
  using ((select public.has_perm('str.view')));
create policy str_archive_lines_read on public.str_archive_lines for select to authenticated
  using ((select public.has_perm('str.view')));
revoke all on public.str_archive_headers, public.str_archive_lines from public, anon, authenticated;
grant select on public.str_archive_headers to authenticated;
-- No cost_price for plain reads (see 0500).
grant select (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, receive_qty, product_price)
  on public.str_archive_lines to authenticated;
grant all on public.str_archive_headers, public.str_archive_lines to service_role;

-- How long history is kept, in whole months (owner 14 Nov 2026: one month). Changed through settings_set.
insert into public.settings (key, value, staff_visible) values ('str.history_months', '1', false)
on conflict (key) do nothing;

-- Copy what the feed holds now. The newest version of each STR wins. Lines are replaced per STR (so a corrected or removed
-- line follows the feed), but only for STRs that have lines in the feed right now: a header that arrives without lines
-- never wipes the lines already kept.
create or replace function public.str_archive_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_headers int; v_lines int;
begin
  insert into public.str_archive_headers (str_id, str_number, master_str_id, ref_no, media, str_status, str_date, issued_by,
    dispatched_date, dispatch_status, dispatched_by, receive_date, receive_status, received_by, comments,
    dispatch_branch, receive_branch, direction, no_of_boxes, synced_at)
  select h.str_id, h.str_number, h.master_str_id, h.ref_no, h.media, h.str_status, h.str_date, h.issued_by,
    h.dispatched_date, h.dispatch_status, h.dispatched_by, h.receive_date, h.receive_status, h.received_by, h.comments,
    h.dispatch_branch, h.receive_branch, h.direction, h.no_of_boxes, h.synced_at
  from public.str_headers h
  on conflict (str_id) do update set
    str_number = excluded.str_number, master_str_id = excluded.master_str_id, ref_no = excluded.ref_no, media = excluded.media,
    str_status = excluded.str_status, str_date = excluded.str_date, issued_by = excluded.issued_by,
    dispatched_date = excluded.dispatched_date, dispatch_status = excluded.dispatch_status, dispatched_by = excluded.dispatched_by,
    receive_date = excluded.receive_date, receive_status = excluded.receive_status, received_by = excluded.received_by,
    comments = excluded.comments, dispatch_branch = excluded.dispatch_branch, receive_branch = excluded.receive_branch,
    direction = excluded.direction, no_of_boxes = excluded.no_of_boxes, synced_at = excluded.synced_at, archived_at = now();
  get diagnostics v_headers = row_count;

  delete from public.str_archive_lines where str_id in (select l.str_id from public.str_line_items l);
  insert into public.str_archive_lines (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, receive_qty,
    product_price, cost_price)
  select distinct on (l.str_id, l.str_item_id) l.str_id, l.str_item_id, l.product_code, l.product_name, l.str_qty,
    l.dispatch_qty, l.receive_qty, l.product_price, l.cost_price
  from public.str_line_items l
  order by l.str_id, l.str_item_id, l.id;
  get diagnostics v_lines = row_count;
  return jsonb_build_object('headers', v_headers, 'lines', v_lines);
end $$;

-- Drop what is older than the history setting (whole months, counted from today in Pakistan).
create or replace function public.str_archive_prune() returns integer
language plpgsql security definer set search_path = public as $$
declare v_months int; v_removed int;
begin
  v_months := greatest(1, least(coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'str.history_months'), 1), 24));
  delete from public.str_archive_headers a
  where coalesce(a.str_date, a.archived_at::date) < ((now() at time zone 'Asia/Karachi')::date - make_interval(months => v_months));
  get diagnostics v_removed = row_count;
  delete from public.str_archive_lines l where not exists (select 1 from public.str_archive_headers a where a.str_id = l.str_id);
  return v_removed;
end $$;

revoke all on function public.str_archive_sync(), public.str_archive_prune() from public, anon, authenticated;
grant execute on function public.str_archive_sync(), public.str_archive_prune() to service_role;

-- Hourly, 20 minutes past (the feed runs on the hour). Where pg_cron is missing (CI, a restored test project) this does
-- nothing; an existing job of the same name is left alone; it holds no secret.
do $cron$
begin
  begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
  exception when others then
    raise notice 'could not enable pg_cron here: %', sqlerrm;
  end;
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not available: STR archive schedule skipped';
  elsif not exists (select 1 from cron.job where jobname = 'str-archive-hourly') then
    perform cron.schedule('str-archive-hourly', '20 * * * *', 'select public.str_archive_sync(); select public.str_archive_prune();');
  end if;
end $cron$;

-- Capture whatever the feed holds right now.
select public.str_archive_sync();
