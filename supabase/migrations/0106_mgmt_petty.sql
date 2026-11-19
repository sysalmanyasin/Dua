-- 0106_mgmt_petty: Petty Detail, the monthly petty cash vouchers (rule R11, MGR-12, MGR-24). Key: mgmt.petty_cash (see AND edit).
--
-- A month holds several GROUPS (a voucher with a title such as a period) and each group holds LINES (description + amount).
-- Totals only, no balance (that is what the old Petty Detail was). Every group is an append-only document: a save adds a new
-- REVISION of a group, and only when it changed; removing a group is a revision too, so nothing is ever erased. A closed month
-- needs a reason to be revised. Amounts are whole rupees (floor(x + 0.5)).

create table public.mgmt_petty_groups (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  sheet_id uuid not null references public.mgmt_sheets(id) on delete restrict,
  group_key uuid not null,
  revision int not null check (revision >= 0),
  title text not null check (length(trim(title)) between 1 and 60),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 200),
  total numeric(14,2) not null,
  removed boolean not null default false,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (sheet_id, group_key, revision)
);
create index mgmt_petty_groups_sheet on public.mgmt_petty_groups (sheet_id, group_key, revision desc);
alter table public.mgmt_petty_groups enable row level security;
create trigger mgmt_petty_groups_append_only before update or delete on public.mgmt_petty_groups
  for each row execute function public.mgmt_append_only();
create policy mgmt_petty_groups_read on public.mgmt_petty_groups for select to authenticated
  using ((select public.has_perm('mgmt.petty_cash')));
grant select on public.mgmt_petty_groups to authenticated;

-- The current groups of a month, in the order they were first created. Removed groups are not listed.
create function public.mgmt_petty_month(p_month date)
returns table (group_key uuid, title text, lines jsonb, total numeric, revision int, closed boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_sheet public.mgmt_sheets;
begin
  if not public.has_perm('mgmt.petty_cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'month must be the first day of a month'; end if;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'petty';
  return query
  select c.group_key, c.title, c.lines, c.total, c.revision, (v_sheet.closed_at is not null)
  from (select distinct on (g.group_key) g.group_key, g.title, g.lines, g.total, g.revision, g.removed,
               (select min(g2.seq) from public.mgmt_petty_groups g2 where g2.sheet_id = g.sheet_id and g2.group_key = g.group_key) as first_seq
        from public.mgmt_petty_groups g where g.sheet_id = v_sheet.id order by g.group_key, g.revision desc) c
  where not c.removed order by c.first_seq;
end $$;

-- Saves the whole month: p_groups = [{group_key, title, lines: [{description, amount}], removed?}]. The browser makes the
-- group_key for a new group.
create function public.mgmt_petty_save(p_month date, p_groups jsonb, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; v_sheet public.mgmt_sheets; g jsonb; ln jsonb; cur public.mgmt_petty_groups; v_gk uuid; v_title text;
  v_lines jsonb; v_total numeric; v_amt numeric; v_desc text; v_changed int := 0; v_same int := 0; res jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.has_perm('mgmt.petty_cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'petty_save');
  if cached is not null then return cached; end if;
  if p_month is null or p_month <> date_trunc('month', p_month)::date or p_month > date_trunc('month', today)::date or p_month < date '2000-01-01' then
    raise exception 'pick a month that has begun, as the first of the month';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 100 then raise exception 'groups must be a list of at most 100'; end if;
  insert into public.mgmt_sheets (month, kind, created_by) values (p_month, 'petty', auth.uid()) on conflict (month, kind) do nothing;
  select * into v_sheet from public.mgmt_sheets where month = p_month and kind = 'petty' for update;
  if v_sheet.closed_at is not null and (v_reason is null or length(v_reason) < 3) then raise exception 'this month is closed: a reason is required to revise it'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(g) <> 'object' then raise exception 'a group must be an object'; end if;
    if coalesce(g ->> 'group_key', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'a group has no valid id'; end if;
    v_gk := (g ->> 'group_key')::uuid;
    select * into cur from public.mgmt_petty_groups where sheet_id = v_sheet.id and group_key = v_gk order by revision desc limit 1;

    if coalesce((g ->> 'removed')::boolean, false) then
      if cur.id is null or cur.removed then continue; end if;
      insert into public.mgmt_petty_groups (sheet_id, group_key, revision, title, lines, total, removed, reason, created_by)
        values (v_sheet.id, v_gk, cur.revision + 1, cur.title, cur.lines, cur.total, true, v_reason, auth.uid());
      v_changed := v_changed + 1;
      continue;
    end if;

    v_title := trim(coalesce(g ->> 'title', ''));
    if length(v_title) not between 1 and 60 then raise exception 'a group needs a title of 1 to 60 characters'; end if;
    if jsonb_typeof(g -> 'lines') is distinct from 'array' then raise exception 'a group needs a list of lines'; end if;
    if jsonb_array_length(g -> 'lines') = 0 then raise exception 'a group needs at least one line'; end if;
    if jsonb_array_length(g -> 'lines') > 200 then raise exception 'a group can have at most 200 lines'; end if;
    v_lines := '[]'::jsonb; v_total := 0;
    for ln in select * from jsonb_array_elements(g -> 'lines') loop
      if jsonb_typeof(ln) <> 'object' then raise exception 'a line must be an object'; end if;
      v_desc := trim(coalesce(ln ->> 'description', ''));
      if length(v_desc) not between 1 and 120 then raise exception 'each line needs a description of 1 to 120 characters'; end if;
      if coalesce(ln ->> 'amount', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'line amounts must be numbers'; end if;
      v_amt := public.mgmt_rup((ln ->> 'amount')::numeric);
      if v_amt = 0 then raise exception 'a line amount cannot be zero'; end if;
      if abs(v_amt) > 1000000000 then raise exception 'an amount is out of range'; end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_desc, 'amount', v_amt));
      v_total := v_total + v_amt;
    end loop;

    if cur.id is not null and not cur.removed and cur.title = v_title and cur.lines = v_lines then v_same := v_same + 1; continue; end if;
    insert into public.mgmt_petty_groups (sheet_id, group_key, revision, title, lines, total, removed, reason, created_by)
      values (v_sheet.id, v_gk, coalesce(cur.revision + 1, 0), v_title, v_lines, v_total, false, v_reason, auth.uid());
    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    perform public.log_activity('mgmt.petty_saved', 'mgmt_sheets', v_sheet.id::text, null,
      jsonb_build_object('month', p_month, 'groups_changed', v_changed, 'closed', v_sheet.closed_at is not null), v_reason);
  end if;
  res := jsonb_build_object('sheet_id', v_sheet.id, 'changed', v_changed, 'unchanged', v_same);
  perform public.mgmt_idem_put(p_key, 'petty_save', res);
  return res;
end $$;

-- "Copy to next month" (old behaviour): clones the current groups of one month, with their amounts, into a month that has none.
create function public.mgmt_petty_copy(p_from date, p_to date, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; v_from public.mgmt_sheets; v_to public.mgmt_sheets; c record; n int := 0; res jsonb;
begin
  if not public.has_perm('mgmt.petty_cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'petty_copy');
  if cached is not null then return cached; end if;
  if p_from is null or p_to is null or p_from <> date_trunc('month', p_from)::date or p_to <> date_trunc('month', p_to)::date then
    raise exception 'months must be the first day of a month';
  end if;
  if p_from = p_to then raise exception 'pick two different months'; end if;
  if p_to > date_trunc('month', today)::date or p_to < date '2000-01-01' then raise exception 'the target month must have begun'; end if;
  select * into v_from from public.mgmt_sheets where month = p_from and kind = 'petty';
  if v_from.id is null then raise exception 'there is nothing to copy from that month'; end if;
  if exists (select 1 from public.mgmt_sheets s join public.mgmt_petty_groups g on g.sheet_id = s.id where s.month = p_to and s.kind = 'petty') then
    raise exception 'that month already has petty cash groups';
  end if;
  insert into public.mgmt_sheets (month, kind, created_by) values (p_to, 'petty', auth.uid()) on conflict (month, kind) do nothing;
  select * into v_to from public.mgmt_sheets where month = p_to and kind = 'petty' for update;
  if v_to.closed_at is not null then raise exception 'the target month is closed'; end if;
  for c in
    select x.title, x.lines, x.total from (select distinct on (g.group_key) g.group_key, g.title, g.lines, g.total, g.removed,
        (select min(g2.seq) from public.mgmt_petty_groups g2 where g2.sheet_id = g.sheet_id and g2.group_key = g.group_key) as first_seq
      from public.mgmt_petty_groups g where g.sheet_id = v_from.id order by g.group_key, g.revision desc) x
    where not x.removed order by x.first_seq
  loop
    insert into public.mgmt_petty_groups (sheet_id, group_key, revision, title, lines, total, removed, reason, created_by)
      values (v_to.id, gen_random_uuid(), 0, c.title, c.lines, c.total, false, 'copied from ' || to_char(p_from, 'YYYY-MM'), auth.uid());
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'there is nothing to copy from that month'; end if;
  perform public.log_activity('mgmt.petty_copied', 'mgmt_sheets', v_to.id::text, null,
    jsonb_build_object('from', p_from, 'to', p_to, 'groups', n), null);
  res := jsonb_build_object('sheet_id', v_to.id, 'groups', n);
  perform public.mgmt_idem_put(p_key, 'petty_copy', res);
  return res;
end $$;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_petty_month(date), public.mgmt_petty_save(date, jsonb, text, uuid), public.mgmt_petty_copy(date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.mgmt_petty_month(date), public.mgmt_petty_save(date, jsonb, text, uuid), public.mgmt_petty_copy(date, date, uuid)
  to authenticated;
