-- 0107_mgmt_ledgers: one ledger engine for Expense, Jazz Cash and the owner's own Misc Sections, plus the Jazz Cash Balance Tally.
-- Rules R15-R17 and MGR-9, 17, 22. Key: mgmt.ledgers (see AND edit).
--
-- Confirmed by the owner (13 Nov 2026):
--   * Expense ledger = the credit Head Office owes the branch: every expense ADDS to it, cash received from Head Office REDUCES it.
--     A negative balance means the branch holds Head Office cash.
--   * Jazz Cash ledger = Jazz Cash money held: Received ADDS; Transfer (and the other outgoing categories) REDUCE.
--   * Opening balance is ZERO for every ledger. The balance is the running sum of the entries in date order.
-- Design rules (MGR-22): amounts are always positive and the CATEGORY carries the direction (adds / reduces). A category's direction
-- never changes (make a new category instead), and each entry stores the direction it was made with, so a balance can never change
-- retroactively. Entries are never edited or deleted: a mistake is a reversal (same date, opposite direction, mandatory reason).

create sequence public.mgmt_ledger_code_seq;

create table public.mgmt_ledgers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (length(trim(name)) between 1 and 40),
  kind text not null check (kind in ('expense', 'jazzcash', 'misc')),
  has_shift boolean not null default false,
  positive_label text not null check (length(trim(positive_label)) between 1 and 60),
  negative_label text not null check (length(trim(negative_label)) between 1 and 60),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index mgmt_ledgers_name on public.mgmt_ledgers (lower(trim(name)));
alter table public.mgmt_ledgers enable row level security;
create trigger mgmt_ledgers_append_only before update or delete on public.mgmt_ledgers
  for each row execute function public.mgmt_append_only();

create table public.mgmt_ledger_categories (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.mgmt_ledgers(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 40),
  direction smallint not null check (direction in (1, -1)),
  sort int not null default 100,
  retired_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index mgmt_ledger_categories_name on public.mgmt_ledger_categories (ledger_id, lower(trim(name))) where retired_at is null;
alter table public.mgmt_ledger_categories enable row level security;
-- A category's name and direction never change (the old app needed a "sign flip" migration). It can only be retired, once.
create function public.mgmt_categories_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'categories cannot be deleted'; end if;
  if old.retired_at is not null or new.retired_at is null or new.id is distinct from old.id or new.ledger_id is distinct from old.ledger_id
     or new.name is distinct from old.name or new.direction is distinct from old.direction or new.sort is distinct from old.sort then
    raise exception 'a category can only be retired, once';
  end if;
  return new;
end $$;
create trigger mgmt_ledger_categories_guard before update or delete on public.mgmt_ledger_categories
  for each row execute function public.mgmt_categories_guard();

create table public.mgmt_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  ledger_id uuid not null references public.mgmt_ledgers(id) on delete restrict,
  category_id uuid not null references public.mgmt_ledger_categories(id) on delete restrict,
  entry_date date not null,
  shift text check (shift is null or shift in ('Morning', 'Evening', 'Night', 'Both', 'Off')),
  description text not null default '' check (length(description) <= 200),
  amount numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  effect smallint not null check (effect in (1, -1)),
  source text not null default 'manual' check (source in ('manual', 'closing_inbox')),
  reverses_id uuid unique references public.mgmt_ledger_entries(id),
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (reverses_id is null or (reason is not null and length(trim(reason)) >= 3))
);
create index mgmt_ledger_entries_ledger on public.mgmt_ledger_entries (ledger_id, entry_date, seq);
alter table public.mgmt_ledger_entries enable row level security;
create trigger mgmt_ledger_entries_append_only before update or delete on public.mgmt_ledger_entries
  for each row execute function public.mgmt_append_only();

-- ───────── Balance Tally: a daily count of the accounts, against what the "expense app" says ─────────
create table public.mgmt_tally_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 40),
  sort int not null default 100,
  retired_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index mgmt_tally_accounts_name on public.mgmt_tally_accounts (lower(trim(name))) where retired_at is null;
alter table public.mgmt_tally_accounts enable row level security;
create function public.mgmt_tally_accounts_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'tally accounts cannot be deleted'; end if;
  if old.retired_at is not null or new.retired_at is null or new.id is distinct from old.id or new.name is distinct from old.name or new.sort is distinct from old.sort then
    raise exception 'a tally account can only be retired, once';
  end if;
  return new;
end $$;
create trigger mgmt_tally_accounts_guard before update or delete on public.mgmt_tally_accounts
  for each row execute function public.mgmt_tally_accounts_guard();

create table public.mgmt_tally_snapshots (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  snap_date date not null,
  revision int not null check (revision >= 0),
  ledger_balance numeric(14,2) not null,
  accounts jsonb not null check (jsonb_typeof(accounts) = 'array'),
  app_total numeric(14,2) not null,
  total numeric(14,2) not null,
  difference numeric(14,2) not null,
  reason text check (reason is null or length(reason) <= 200),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (snap_date, revision)
);
alter table public.mgmt_tally_snapshots enable row level security;
create trigger mgmt_tally_snapshots_append_only before update or delete on public.mgmt_tally_snapshots
  for each row execute function public.mgmt_append_only();

-- ───────── read policies (wrapped form) ─────────
create policy mgmt_ledgers_read on public.mgmt_ledgers for select to authenticated using ((select public.has_perm('mgmt.ledgers')));
create policy mgmt_ledger_categories_read on public.mgmt_ledger_categories for select to authenticated using ((select public.has_perm('mgmt.ledgers')));
create policy mgmt_ledger_entries_read on public.mgmt_ledger_entries for select to authenticated using ((select public.has_perm('mgmt.ledgers')));
create policy mgmt_tally_accounts_read on public.mgmt_tally_accounts for select to authenticated using ((select public.has_perm('mgmt.ledgers')));
create policy mgmt_tally_snapshots_read on public.mgmt_tally_snapshots for select to authenticated using ((select public.has_perm('mgmt.ledgers')));
grant select on public.mgmt_ledgers, public.mgmt_ledger_categories, public.mgmt_ledger_entries, public.mgmt_tally_accounts, public.mgmt_tally_snapshots to authenticated;

-- ───────── starting data: the two built-in ledgers and their categories (no money, no people) ─────────
insert into public.mgmt_ledgers (code, name, kind, has_shift, positive_label, negative_label) values
 ('expense', 'Expenses', 'expense', false, 'Head Office owes you', 'You hold Head Office cash'),
 ('jazzcash', 'Jazz Cash', 'jazzcash', true, 'Jazz Cash money held', 'Transferred out more than received');
insert into public.mgmt_ledger_categories (ledger_id, name, direction, sort)
  select l.id, c.name, c.direction, c.sort from public.mgmt_ledgers l join (values
   ('expense', 'Bill', 1, 10), ('expense', 'Fuel/HO', 1, 20), ('expense', 'Soap/Tissue', 1, 30), ('expense', 'Refreshment', 1, 40),
   ('expense', 'Extra', 1, 50), ('expense', 'Guard Incentive', 1, 60), ('expense', 'Cash received from Head Office', -1, 70),
   ('jazzcash', 'Received', 1, 10), ('jazzcash', 'Patty Incentive', -1, 20), ('jazzcash', 'Generic Incentive', -1, 30),
   ('jazzcash', 'Strips/Adjustments', -1, 40), ('jazzcash', 'Transfer', -1, 50)) as c(code, name, direction, sort) on c.code = l.code;
insert into public.mgmt_tally_accounts (name, sort) values
 ('My Jazz Cash App', 10), ('ABL', 20), ('Bank Alflah', 30), ('Easypaisa', 40), ('Pharmacy (Cash)', 50), ('Cash in Hand', 60);

-- ───────── internal: the balance of a ledger, optionally as of a date ─────────
create function public.mgmt_ledger_balance(p_ledger uuid, p_asof date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(effect * amount), 0) from public.mgmt_ledger_entries
  where ledger_id = p_ledger and (p_asof is null or entry_date <= p_asof)
$$;

-- ───────── reads ─────────
create function public.mgmt_ledgers_list()
returns table (ledger_id uuid, code text, name text, kind text, has_shift boolean, positive_label text, negative_label text,
               balance numeric, entry_count int, categories jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select l.id, l.code, l.name, l.kind, l.has_shift, l.positive_label, l.negative_label, public.mgmt_ledger_balance(l.id),
    (select count(*)::int from public.mgmt_ledger_entries e where e.ledger_id = l.id),
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'direction', c.direction) order by c.sort, c.created_at, c.id)
              from public.mgmt_ledger_categories c where c.ledger_id = l.id and c.retired_at is null), '[]'::jsonb)
  from public.mgmt_ledgers l order by case l.kind when 'expense' then 1 when 'jazzcash' then 2 else 3 end, l.created_at, l.id;
end $$;

-- Every entry of a ledger with its running balance after it (computed over ALL entries in date order, then filtered by the range).
create function public.mgmt_ledger_view(p_ledger uuid, p_from date default null, p_to date default null)
returns table (entry_id uuid, entry_date date, shift text, category_id uuid, category_name text, category_direction int,
               description text, amount numeric, effect int, source text, reverses_id uuid, reversed_by uuid, reason text, balance_after numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.mgmt_ledgers where id = p_ledger) then raise exception 'unknown ledger'; end if;
  return query
  with run as (
    select e.*, sum(e.effect * e.amount) over (order by e.entry_date, e.seq rows between unbounded preceding and current row) as bal
    from public.mgmt_ledger_entries e where e.ledger_id = p_ledger
  )
  select r.id, r.entry_date, r.shift, r.category_id, c.name, c.direction::int, r.description, r.amount, r.effect::int, r.source,
         r.reverses_id, rv.id, r.reason, r.bal
  from run r join public.mgmt_ledger_categories c on c.id = r.category_id
  left join public.mgmt_ledger_entries rv on rv.reverses_id = r.id
  where (p_from is null or r.entry_date >= p_from) and (p_to is null or r.entry_date <= p_to)
  order by r.entry_date, r.seq;
end $$;

-- ───────── writes ─────────
create function public.mgmt_ledger_add(p_ledger uuid, p_category uuid, p_date date, p_shift text, p_description text, p_amount numeric, p_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; l public.mgmt_ledgers; c public.mgmt_ledger_categories; v_id uuid; res jsonb;
  v_desc text := trim(coalesce(p_description, '')); v_shift text := nullif(trim(coalesce(p_shift, '')), '');
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'ledger_add');
  if cached is not null then return cached; end if;
  select * into l from public.mgmt_ledgers where id = p_ledger;
  if not found then raise exception 'unknown ledger'; end if;
  select * into c from public.mgmt_ledger_categories where id = p_category and ledger_id = p_ledger;
  if not found then raise exception 'that category does not belong to this ledger'; end if;
  if c.retired_at is not null then raise exception 'that category is retired'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'enter an amount above zero'; end if;
  if p_amount > 1000000000 or p_amount <> round(p_amount, 2) then raise exception 'amount is out of range or has more than 2 decimals'; end if;
  if p_date is null or p_date > today or p_date < date '2000-01-01' then raise exception 'date cannot be in the future'; end if;
  if length(v_desc) > 200 then raise exception 'description is too long'; end if;
  if l.has_shift then
    if v_shift is null then raise exception 'pick a shift'; end if;
    if v_shift not in ('Morning', 'Evening', 'Night', 'Both', 'Off') then raise exception 'unknown shift'; end if;
  elsif v_shift is not null then raise exception 'this ledger has no shifts';
  end if;
  insert into public.mgmt_ledger_entries (ledger_id, category_id, entry_date, shift, description, amount, effect, created_by)
    values (p_ledger, p_category, p_date, v_shift, v_desc, p_amount, c.direction, auth.uid()) returning id into v_id;
  perform public.log_activity('mgmt.ledger_added', 'mgmt_ledger_entries', v_id::text, null,
    jsonb_build_object('ledger', l.code, 'category', c.name, 'entry_date', p_date, 'amount', p_amount, 'effect', c.direction), null);
  res := jsonb_build_object('id', v_id, 'entry_date', p_date);
  perform public.mgmt_idem_put(p_key, 'ledger_add', res);
  return res;
end $$;

create function public.mgmt_ledger_reverse(p_entry_id uuid, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; e public.mgmt_ledger_entries; v_id uuid; res jsonb; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'ledger_reverse');
  if cached is not null then return cached; end if;
  if length(v_reason) not between 3 and 200 then raise exception 'a reason of 3 to 200 characters is required'; end if;
  select * into e from public.mgmt_ledger_entries where id = p_entry_id for update;
  if not found then raise exception 'unknown entry'; end if;
  if e.reverses_id is not null then raise exception 'a reversal cannot be reversed: add a new entry instead'; end if;
  if exists (select 1 from public.mgmt_ledger_entries where reverses_id = p_entry_id) then raise exception 'this entry is already reversed'; end if;
  -- same date, same category, opposite direction: the month reads as if the mistake never happened, and both lines stay visible
  insert into public.mgmt_ledger_entries (ledger_id, category_id, entry_date, shift, description, amount, effect, source, reverses_id, reason, created_by)
    values (e.ledger_id, e.category_id, e.entry_date, e.shift, left('Reversal: ' || e.description, 200), e.amount, -e.effect, 'manual', e.id, v_reason, auth.uid())
    returning id into v_id;
  perform public.log_activity('mgmt.ledger_reversed', 'mgmt_ledger_entries', e.id::text,
    jsonb_build_object('entry_date', e.entry_date, 'amount', e.amount, 'effect', e.effect), jsonb_build_object('reversal_id', v_id), v_reason);
  res := jsonb_build_object('id', v_id, 'reverses_id', e.id);
  perform public.mgmt_idem_put(p_key, 'ledger_reverse', res);
  return res;
end $$;

-- A new Misc Section: its own ledger with the owner's categories. p_categories = [{name, direction}] with direction 1 (adds) or -1 (reduces).
create function public.mgmt_ledger_section_create(p_name text, p_categories jsonb, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; v_name text := trim(coalesce(p_name, '')); v_id uuid; c jsonb; i int := 0; res jsonb;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'ledger_section');
  if cached is not null then return cached; end if;
  if length(v_name) not between 1 and 40 then raise exception 'a section name must be 1 to 40 characters'; end if;
  if p_categories is null or jsonb_typeof(p_categories) <> 'array' or jsonb_array_length(p_categories) not between 1 and 20 then raise exception 'a section needs 1 to 20 categories'; end if;
  begin
    insert into public.mgmt_ledgers (code, name, kind, has_shift, positive_label, negative_label, created_by)
      values ('misc_' || nextval('public.mgmt_ledger_code_seq'), v_name, 'misc', false, 'Balance', 'Balance (below zero)', auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'a ledger with that name already exists';
  end;
  for c in select * from jsonb_array_elements(p_categories) loop
    i := i + 10;
    if jsonb_typeof(c) <> 'object' or length(trim(coalesce(c ->> 'name', ''))) not between 1 and 40 then raise exception 'each category needs a name of 1 to 40 characters'; end if;
    if coalesce(c ->> 'direction', '') not in ('1', '-1') then raise exception 'each category either adds (1) or reduces (-1)'; end if;
    begin
      insert into public.mgmt_ledger_categories (ledger_id, name, direction, sort, created_by)
        values (v_id, trim(c ->> 'name'), (c ->> 'direction')::smallint, i, auth.uid());
    exception when unique_violation then raise exception 'two categories have the same name';
    end;
  end loop;
  perform public.log_activity('mgmt.ledger_section_created', 'mgmt_ledgers', v_id::text, null, jsonb_build_object('name', v_name, 'categories', jsonb_array_length(p_categories)), null);
  res := jsonb_build_object('id', v_id);
  perform public.mgmt_idem_put(p_key, 'ledger_section', res);
  return res;
end $$;

create function public.mgmt_ledger_category_add(p_ledger uuid, p_name text, p_direction int, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; v_name text := trim(coalesce(p_name, '')); v_id uuid; res jsonb; v_sort int;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'ledger_category_add');
  if cached is not null then return cached; end if;
  if not exists (select 1 from public.mgmt_ledgers where id = p_ledger) then raise exception 'unknown ledger'; end if;
  if length(v_name) not between 1 and 40 then raise exception 'a category name must be 1 to 40 characters'; end if;
  if p_direction not in (1, -1) then raise exception 'a category either adds (1) or reduces (-1)'; end if;
  select coalesce(max(sort), 0) + 10 into v_sort from public.mgmt_ledger_categories where ledger_id = p_ledger;
  begin
    insert into public.mgmt_ledger_categories (ledger_id, name, direction, sort, created_by) values (p_ledger, v_name, p_direction, v_sort, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'a category with that name already exists';
  end;
  perform public.log_activity('mgmt.ledger_category_added', 'mgmt_ledger_categories', v_id::text, null, jsonb_build_object('name', v_name, 'direction', p_direction), null);
  res := jsonb_build_object('id', v_id);
  perform public.mgmt_idem_put(p_key, 'ledger_category_add', res);
  return res;
end $$;

create function public.mgmt_ledger_category_retire(p_category uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; c public.mgmt_ledger_categories; res jsonb;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'ledger_category_retire');
  if cached is not null then return cached; end if;
  select * into c from public.mgmt_ledger_categories where id = p_category for update;
  if not found then raise exception 'unknown category'; end if;
  if c.retired_at is not null then raise exception 'this category is already retired'; end if;
  if (select count(*) from public.mgmt_ledger_categories where ledger_id = c.ledger_id and retired_at is null) <= 1 then raise exception 'a ledger needs at least one category'; end if;
  update public.mgmt_ledger_categories set retired_at = now() where id = p_category;
  perform public.log_activity('mgmt.ledger_category_retired', 'mgmt_ledger_categories', p_category::text, null, jsonb_build_object('name', c.name), null);
  res := jsonb_build_object('id', p_category);
  perform public.mgmt_idem_put(p_key, 'ledger_category_retire', res);
  return res;
end $$;

-- ───────── Balance Tally ─────────
create function public.mgmt_tally_accounts_list() returns table (account_id uuid, name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select a.id, a.name from public.mgmt_tally_accounts a where a.retired_at is null order by a.sort, a.created_at, a.id;
end $$;

create function public.mgmt_tally_account_add(p_name text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; v_name text := trim(coalesce(p_name, '')); v_id uuid; res jsonb; v_sort int;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'tally_account_add');
  if cached is not null then return cached; end if;
  if length(v_name) not between 1 and 40 then raise exception 'an account name must be 1 to 40 characters'; end if;
  select coalesce(max(sort), 0) + 10 into v_sort from public.mgmt_tally_accounts;
  begin
    insert into public.mgmt_tally_accounts (name, sort, created_by) values (v_name, v_sort, auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'an account with that name already exists';
  end;
  perform public.log_activity('mgmt.tally_account_added', 'mgmt_tally_accounts', v_id::text, null, jsonb_build_object('name', v_name), null);
  res := jsonb_build_object('id', v_id);
  perform public.mgmt_idem_put(p_key, 'tally_account_add', res);
  return res;
end $$;

create function public.mgmt_tally_account_retire(p_account uuid, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cached jsonb; a public.mgmt_tally_accounts; res jsonb;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'tally_account_retire');
  if cached is not null then return cached; end if;
  select * into a from public.mgmt_tally_accounts where id = p_account for update;
  if not found then raise exception 'unknown account'; end if;
  if a.retired_at is not null then raise exception 'this account is already retired'; end if;
  update public.mgmt_tally_accounts set retired_at = now() where id = p_account;
  perform public.log_activity('mgmt.tally_account_retired', 'mgmt_tally_accounts', p_account::text, null, jsonb_build_object('name', a.name), null);
  res := jsonb_build_object('id', p_account);
  perform public.mgmt_idem_put(p_key, 'tally_account_retire', res);
  return res;
end $$;

-- The count for one date (latest revision), or none yet. live_ledger_balance is the Jazz Cash balance as of that date.
create function public.mgmt_tally_get(p_date date)
returns table (has_snapshot boolean, revision int, ledger_balance numeric, accounts jsonb, app_total numeric, total numeric, difference numeric, live_ledger_balance numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare s public.mgmt_tally_snapshots; v_live numeric;
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null then raise exception 'pick a date'; end if;
  select * into s from public.mgmt_tally_snapshots where snap_date = p_date order by revision desc limit 1;
  v_live := public.mgmt_ledger_balance((select id from public.mgmt_ledgers where code = 'jazzcash'), p_date);
  return query select (s.id is not null), s.revision, coalesce(s.ledger_balance, v_live), coalesce(s.accounts, '[]'::jsonb),
                      coalesce(s.app_total, 0), coalesce(s.total, v_live), coalesce(s.difference, v_live), v_live;
end $$;

create function public.mgmt_tally_list(p_limit int default 30)
returns table (snap_date date, revision int, total numeric, app_total numeric, difference numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select x.snap_date, x.revision, x.total, x.app_total, x.difference
  from (select distinct on (s.snap_date) s.snap_date, s.revision, s.total, s.app_total, s.difference from public.mgmt_tally_snapshots s order by s.snap_date, s.revision desc) x
  order by x.snap_date desc limit least(greatest(coalesce(p_limit, 30), 1), 365);
end $$;

-- p_accounts = [{account_id, amount}] for the active accounts (a missing account counts as 0). The Jazz Cash ledger balance as of the date
-- is added automatically (it is money held). Changing a date that already has a count adds a revision and needs a reason.
create function public.mgmt_tally_save(p_date date, p_accounts jsonb, p_app_total numeric, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  cached jsonb; cur public.mgmt_tally_snapshots; a record; e jsonb; v_list jsonb := '[]'::jsonb; v_amt numeric; v_sum numeric := 0;
  v_ledger numeric; v_total numeric; v_id uuid; res jsonb; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_seen uuid[] := '{}';
begin
  if not public.has_perm('mgmt.ledgers') then raise exception 'not allowed' using errcode = '42501'; end if;
  cached := public.mgmt_idem_get(p_key, 'tally_save');
  if cached is not null then return cached; end if;
  if p_date is null or p_date > today or p_date < date '2000-01-01' then raise exception 'date cannot be in the future'; end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then raise exception 'accounts must be a list'; end if;
  if p_app_total is null or abs(p_app_total) > 1000000000 or p_app_total <> round(p_app_total, 2) then raise exception 'the app total is out of range or has more than 2 decimals'; end if;
  if v_reason is not null and length(v_reason) > 200 then raise exception 'reason is too long'; end if;
  for e in select * from jsonb_array_elements(p_accounts) loop
    if coalesce(e ->> 'account_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'an account has no valid id'; end if;
    if (e ->> 'account_id')::uuid = any (v_seen) then raise exception 'an account is listed twice'; end if;
    v_seen := v_seen || (e ->> 'account_id')::uuid;
    select * into a from public.mgmt_tally_accounts where id = (e ->> 'account_id')::uuid and retired_at is null;
    if not found then raise exception 'unknown or retired account'; end if;
    if coalesce(e ->> 'amount', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'account amounts must be numbers'; end if;
    v_amt := (e ->> 'amount')::numeric;
    if abs(v_amt) > 1000000000 or v_amt <> round(v_amt, 2) then raise exception 'an amount is out of range or has more than 2 decimals'; end if;
    v_list := v_list || jsonb_build_array(jsonb_build_object('account_id', a.id, 'name', a.name, 'amount', v_amt));
    v_sum := v_sum + v_amt;
  end loop;
  v_ledger := public.mgmt_ledger_balance((select id from public.mgmt_ledgers where code = 'jazzcash'), p_date);
  v_total := v_ledger + v_sum;
  select * into cur from public.mgmt_tally_snapshots where snap_date = p_date order by revision desc limit 1;
  if cur.id is not null and cur.accounts = v_list and cur.app_total = p_app_total and cur.ledger_balance = v_ledger then
    res := jsonb_build_object('unchanged', true, 'revision', cur.revision);
    perform public.mgmt_idem_put(p_key, 'tally_save', res);
    return res;
  end if;
  if cur.id is not null and (v_reason is null or length(v_reason) < 3) then raise exception 'this date already has a count: a reason is required to change it'; end if;
  insert into public.mgmt_tally_snapshots (snap_date, revision, ledger_balance, accounts, app_total, total, difference, reason, created_by)
    values (p_date, coalesce(cur.revision + 1, 0), v_ledger, v_list, p_app_total, v_total, v_total - p_app_total, v_reason, auth.uid()) returning id into v_id;
  perform public.log_activity('mgmt.tally_saved', 'mgmt_tally_snapshots', v_id::text, null, jsonb_build_object('snap_date', p_date, 'revision', coalesce(cur.revision + 1, 0)), v_reason);
  res := jsonb_build_object('id', v_id, 'revision', coalesce(cur.revision + 1, 0), 'difference', v_total - p_app_total);
  perform public.mgmt_idem_put(p_key, 'tally_save', res);
  return res;
end $$;

-- ───────── grants ─────────
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.mgmt_categories_guard(), public.mgmt_tally_accounts_guard(), public.mgmt_ledger_balance(uuid, date),
  public.mgmt_ledgers_list(), public.mgmt_ledger_view(uuid, date, date), public.mgmt_ledger_add(uuid, uuid, date, text, text, numeric, uuid),
  public.mgmt_ledger_reverse(uuid, text, uuid), public.mgmt_ledger_section_create(text, jsonb, uuid), public.mgmt_ledger_category_add(uuid, text, int, uuid),
  public.mgmt_ledger_category_retire(uuid, uuid), public.mgmt_tally_accounts_list(), public.mgmt_tally_account_add(text, uuid),
  public.mgmt_tally_account_retire(uuid, uuid), public.mgmt_tally_get(date), public.mgmt_tally_list(int),
  public.mgmt_tally_save(date, jsonb, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.mgmt_ledgers_list(), public.mgmt_ledger_view(uuid, date, date), public.mgmt_ledger_add(uuid, uuid, date, text, text, numeric, uuid),
  public.mgmt_ledger_reverse(uuid, text, uuid), public.mgmt_ledger_section_create(text, jsonb, uuid), public.mgmt_ledger_category_add(uuid, text, int, uuid),
  public.mgmt_ledger_category_retire(uuid, uuid), public.mgmt_tally_accounts_list(), public.mgmt_tally_account_add(text, uuid),
  public.mgmt_tally_account_retire(uuid, uuid), public.mgmt_tally_get(date), public.mgmt_tally_list(int),
  public.mgmt_tally_save(date, jsonb, numeric, text, uuid) to authenticated;
