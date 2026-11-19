-- 0401_audit_core: Audit module, slice A1. Brief: docs/modules/audit.md (AUD-1..AUD-13). Rules: docs/MODULES.md section 5.
--  * seeds the new audit.* permission keys (audit.count, audit.manage, audit.review already exist in 0001_core)
--  * flow tables: engagements, members, rounds, round items, assignments, assignment items
--  * round items freeze at lock; the round state machine is enforced by a trigger as well as by the functions
--  * browsers get select only; every write is an audit_* function that checks the permission, validates, logs, and
--    refuses with a machine code in the error HINT (the English message is for logs only)
--  * stale writes are refused with version_conflict; creates are idempotent by a client-made key
-- Counting, compile, corrections, finals, barcode and expiry come in later migrations (0402 onward).

-- ───────── 1. permissions ─────────
insert into public.permissions (key, description) values
 ('audit.individual', 'Start own Individual Audits'),
 ('audit.view', 'See audit engagements, rounds, progress and compiled results'),
 ('audit.assign', 'Assign, move and revoke audit assignments'),
 ('audit.compile', 'Compile audit rounds and generate the next round'),
 ('audit.suggest', 'Propose a corrected audit count with a reason'),
 ('audit.finalize', 'Create the audit Final Snapshot'),
 ('audit.reopen', 'Reopen a submitted audit assignment'),
 ('audit.report', 'Export audit reports'),
 ('audit.templates', 'Create and edit audit templates'),
 ('audit.barcode_scan', 'Scan barcodes while counting'),
 ('audit.barcode_register', 'Register and verify barcodes, report conflicts'),
 ('audit.barcode_admin', 'Resolve barcode conflicts, disable or reassign a barcode'),
 ('audit.expiry_log', 'Log near-expiry stock'),
 ('audit.expiry_manage', 'Manage racks, rack assignment and locked expiry entries')
on conflict (key) do nothing;

-- ───────── 2. tables ─────────
create table public.audit_engagements (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 3 and 120),
  scope_type text not null check (scope_type in ('full', 'selected', 'single', 'template', 'individual')),
  scope_companies text[] not null default '{}',
  scope_codes text[] not null default '{}',
  scope_month text check (scope_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  counting_method text not null default 'manual' check (counting_method in ('manual', 'barcode', 'hybrid')),
  status text not null default 'open' check (status in ('open', 'archived', 'closed')),
  created_by uuid not null references auth.users (id),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_type = 'individual') = (scope_month is not null)),
  check (scope_type not in ('selected', 'single') or cardinality(scope_companies) >= 1),
  check (scope_type <> 'single' or cardinality(scope_companies) = 1),
  check (scope_type <> 'template' or cardinality(scope_codes) >= 1)
);
alter table public.audit_engagements enable row level security;
-- one rolling Individual engagement per month (R8)
create unique index audit_engagements_one_individual_month on public.audit_engagements (scope_month) where scope_type = 'individual';
create trigger audit_engagements_updated before update on public.audit_engagements
  for each row execute function public.set_updated_at();

create table public.audit_members (
  engagement_id uuid not null references public.audit_engagements (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  role text not null check (role in ('lead', 'deputy', 'counter', 'observer')),
  added_by uuid not null references auth.users (id),
  added_at timestamptz not null default now(),
  primary key (engagement_id, user_id)
);
alter table public.audit_members enable row level security;
create index audit_members_user on public.audit_members (user_id);

create table public.audit_rounds (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.audit_engagements (id),
  round_number int not null check (round_number >= 1),
  round_suffix text check (round_suffix ~ '^[A-Z]$'),
  unit text not null check (unit in ('company', 'item')),
  state text not null default 'draft' check (state in ('draft', 'locked', 'counting', 'compiled', 'final')),
  base_round_id uuid references public.audit_rounds (id),
  version int not null default 1 check (version >= 1),
  created_by uuid not null references auth.users (id),
  idempotency_key uuid not null unique,
  locked_at timestamptz,
  compiled_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.audit_rounds enable row level security;
create unique index audit_rounds_number on public.audit_rounds (engagement_id, round_number, coalesce(round_suffix, ''));
create index audit_rounds_engagement on public.audit_rounds (engagement_id);
create trigger audit_rounds_updated before update on public.audit_rounds
  for each row execute function public.set_updated_at();

-- R2/R11: the frozen item list of a round. Each item has its own id; counts will point at it. A blank code is allowed
-- (the old app had such items) and duplicates are kept, never merged away: an audit must not silently lose an item.
create table public.audit_round_items (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.audit_rounds (id) on delete cascade,
  engagement_id uuid not null references public.audit_engagements (id),
  position int not null check (position >= 1),
  code text not null default '',
  company text not null check (length(btrim(company)) > 0),
  name text not null,
  system_qty numeric not null,
  retail_price numeric(14, 2) not null default 0 check (retail_price >= 0),
  prev_variance numeric,
  source_item_id uuid references public.audit_round_items (id),
  created_at timestamptz not null default now(),
  unique (round_id, position)
);
alter table public.audit_round_items enable row level security;
create index audit_round_items_round_code on public.audit_round_items (round_id, code);

create table public.audit_assignments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.audit_rounds (id),
  engagement_id uuid not null references public.audit_engagements (id),
  auditor_id uuid not null references auth.users (id),
  status text not null default 'assigned' check (status in ('assigned', 'counting', 'submitted', 'revoked')),
  method text not null default 'auto-company',
  template_name text,
  started_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.audit_assignments enable row level security;
-- one live assignment per person per round; one open self-pick per person (R8)
create unique index audit_assignments_one_per_person on public.audit_assignments (round_id, auditor_id) where status <> 'revoked';
create unique index audit_assignments_one_open_self_pick on public.audit_assignments (auditor_id)
  where method = 'individual-self-pick' and status in ('assigned', 'counting');
create index audit_assignments_engagement on public.audit_assignments (engagement_id);
create index audit_assignments_auditor on public.audit_assignments (auditor_id);
create trigger audit_assignments_updated before update on public.audit_assignments
  for each row execute function public.set_updated_at();

-- an item belongs to at most one live assignment in its round (stricter than the old overlap warning)
create table public.audit_assignment_items (
  assignment_id uuid not null references public.audit_assignments (id) on delete cascade,
  round_id uuid not null references public.audit_rounds (id),
  engagement_id uuid not null references public.audit_engagements (id),
  round_item_id uuid not null references public.audit_round_items (id),
  primary key (assignment_id, round_item_id),
  unique (round_id, round_item_id)
);
alter table public.audit_assignment_items enable row level security;

-- ───────── 3. guards (evidence cannot be changed, states cannot jump) ─────────
create function public.audit_rounds_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'only a draft round can be deleted' using errcode = '55000', hint = 'round_not_draft';
    end if;
    return old;
  end if;
  if old.state = 'final' then
    raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final';
  end if;
  if new.engagement_id is distinct from old.engagement_id or new.round_number is distinct from old.round_number
     or new.round_suffix is distinct from old.round_suffix or new.unit is distinct from old.unit
     or new.base_round_id is distinct from old.base_round_id or new.idempotency_key is distinct from old.idempotency_key
     or new.created_by is distinct from old.created_by then
    raise exception 'round identity cannot change' using errcode = '55000', hint = 'round_identity';
  end if;
  if new.state <> old.state and not ((old.state, new.state) in
     (('draft', 'locked'), ('locked', 'counting'), ('counting', 'compiled'), ('compiled', 'counting'), ('compiled', 'final'))) then
    raise exception 'illegal round move % to %', old.state, new.state using errcode = '55000', hint = 'illegal_transition';
  end if;
  return new;
end $$;
create trigger audit_rounds_guard before update or delete on public.audit_rounds
  for each row execute function public.audit_rounds_guard();

create function public.audit_round_items_guard() returns trigger language plpgsql as $$
declare v_state text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'round items never change' using errcode = '55000', hint = 'items_frozen';
  end if;
  select state into v_state from public.audit_rounds where id = case when tg_op = 'DELETE' then old.round_id else new.round_id end;
  if v_state is not null and v_state <> 'draft' then
    raise exception 'round items are frozen once the round is locked' using errcode = '55000', hint = 'items_frozen';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger audit_round_items_guard before insert or update or delete on public.audit_round_items
  for each row execute function public.audit_round_items_guard();

create function public.audit_assignments_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'revoked' then
    raise exception 'a revoked assignment cannot change' using errcode = '55000', hint = 'assignment_revoked';
  end if;
  if new.round_id is distinct from old.round_id or new.engagement_id is distinct from old.engagement_id then
    raise exception 'assignment identity cannot change' using errcode = '55000', hint = 'assignment_identity';
  end if;
  return new;
end $$;
create trigger audit_assignments_guard before update on public.audit_assignments
  for each row execute function public.audit_assignments_guard();

-- ───────── 4. internal helpers ─────────
create function public.audit_require(p_key text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_key) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
end $$;

create function public.audit_active_user(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles pr where pr.user_id = p_user and pr.disabled_at is null
                 and (pr.expires_at is null or pr.expires_at > now()))
$$;

-- manage sees every engagement; audit.view sees only those the person was added to (AUD-3). The owner holds both.
create function public.audit_can_view(p_engagement uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.has_perm('audit.manage')
      or (public.has_perm('audit.view')
          and exists (select 1 from public.audit_members m where m.engagement_id = p_engagement and m.user_id = auth.uid()))
$$;

create function public.audit_check_version(p_current int, p_expected int) returns void language plpgsql immutable as $$
begin
  if p_expected is not null and p_expected <> p_current then
    raise exception 'the round changed since it was loaded' using errcode = '40001', hint = 'version_conflict';
  end if;
end $$;

-- The product list for a round comes from Inventory's published interface (MODULES.md 8.1). It is not built yet
-- (Inventory slice I4); until it exists a round cannot be created and the caller is told so by a machine code.
create function public.audit_scope_products(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric)
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('public.inventory_products_for_scope(jsonb)') is null then
    raise exception 'the inventory interface is not available yet' using errcode = '55000', hint = 'inventory_interface_missing';
  end if;
  return query execute
    'select p.code::text, p.name::text, p.company::text, p.qty::numeric, p.price::numeric from public.inventory_products_for_scope($1) p'
    using p_scope;
end $$;

-- ───────── 5. engagements and members ─────────
create function public.audit_engagement_create(p_key uuid, p_name text, p_scope_type text,
  p_companies text[] default '{}', p_codes text[] default '{}', p_method text default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_owner uuid; v_comp text[]; v_codes text[];
begin
  perform public.audit_require('audit.manage');
  if p_key is null then raise exception 'a key is required' using errcode = '22023', hint = 'key_required'; end if;
  select id, created_by into v_id, v_owner from public.audit_engagements where idempotency_key = p_key;
  if found then
    if v_owner = auth.uid() then return v_id; end if;
    raise exception 'this key belongs to someone else' using errcode = '42501', hint = 'key_in_use';
  end if;
  if p_scope_type not in ('full', 'selected', 'single', 'template') then
    raise exception 'invalid scope' using errcode = '22023', hint = 'invalid_scope'; -- individual engagements have their own function
  end if;
  if p_method not in ('manual', 'barcode', 'hybrid') then
    raise exception 'invalid counting method' using errcode = '22023', hint = 'invalid_method';
  end if;
  v_comp := coalesce((select array_agg(c order by c) from (select distinct btrim(x) c from unnest(coalesce(p_companies, '{}')) x where btrim(x) <> '') s), '{}');
  v_codes := coalesce((select array_agg(c order by c) from (select distinct btrim(x) c from unnest(coalesce(p_codes, '{}')) x where btrim(x) <> '') s), '{}');
  if cardinality(v_comp) > 500 or cardinality(v_codes) > 5000 then
    raise exception 'scope too large' using errcode = '22023', hint = 'invalid_scope';
  end if;
  begin
    insert into public.audit_engagements (name, scope_type, scope_companies, scope_codes, counting_method, created_by, idempotency_key)
    values (btrim(coalesce(p_name, '')), p_scope_type,
            case when p_scope_type in ('selected', 'single') then v_comp else '{}' end,
            case when p_scope_type = 'template' then v_codes else '{}' end,
            p_method, auth.uid(), p_key)
    returning id into v_id;
  exception when check_violation then
    raise exception 'invalid name or scope' using errcode = '22023', hint = 'invalid_scope';
  end;
  perform public.log_activity('audit.engagement_created', 'audit_engagements', v_id::text, null,
    jsonb_build_object('scope_type', p_scope_type, 'method', p_method), null);
  return v_id;
end $$;

-- p_role null removes the person from the engagement
create function public.audit_member_set(p_engagement uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  perform public.audit_require('audit.manage');
  if not exists (select 1 from public.audit_engagements where id = p_engagement) then
    raise exception 'engagement not found' using errcode = '22023', hint = 'engagement_not_found';
  end if;
  select role into v_old from public.audit_members where engagement_id = p_engagement and user_id = p_user;
  if p_role is null then
    delete from public.audit_members where engagement_id = p_engagement and user_id = p_user;
  else
    if p_role not in ('lead', 'deputy', 'counter', 'observer') then
      raise exception 'invalid role' using errcode = '22023', hint = 'invalid_role';
    end if;
    if not public.audit_active_user(p_user) then
      raise exception 'that person is not active' using errcode = '22023', hint = 'auditor_unavailable';
    end if;
    insert into public.audit_members (engagement_id, user_id, role, added_by) values (p_engagement, p_user, p_role, auth.uid())
    on conflict (engagement_id, user_id) do update set role = excluded.role, added_by = auth.uid(), added_at = now();
  end if;
  perform public.log_activity('audit.member_set', 'audit_engagements', p_engagement::text,
    jsonb_build_object('user', p_user, 'role', v_old), jsonb_build_object('user', p_user, 'role', p_role), null);
end $$;

-- ───────── 6. rounds ─────────
-- p_scope null uses the engagement's own scope. A lettered sub-round (1A, 1B) needs p_suffix and the round it extends.
create function public.audit_round_create(p_key uuid, p_engagement uuid, p_unit text,
  p_scope jsonb default null, p_suffix text default null, p_base_round uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e public.audit_engagements; v_id uuid; v_owner uuid; v_num int; v_base public.audit_rounds; v_scope jsonb; v_n int;
begin
  perform public.audit_require('audit.manage');
  if p_key is null then raise exception 'a key is required' using errcode = '22023', hint = 'key_required'; end if;
  select id, created_by into v_id, v_owner from public.audit_rounds where idempotency_key = p_key;
  if found then
    if v_owner = auth.uid() then return v_id; end if;
    raise exception 'this key belongs to someone else' using errcode = '42501', hint = 'key_in_use';
  end if;
  if p_unit not in ('company', 'item') then raise exception 'invalid unit' using errcode = '22023', hint = 'invalid_unit'; end if;
  select * into e from public.audit_engagements where id = p_engagement for update;
  if not found then raise exception 'engagement not found' using errcode = '22023', hint = 'engagement_not_found'; end if;
  if e.status <> 'open' then raise exception 'the engagement is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;

  if p_base_round is not null then
    select * into v_base from public.audit_rounds where id = p_base_round and engagement_id = p_engagement;
    if not found then raise exception 'base round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  end if;
  if p_suffix is not null then
    if p_base_round is null then raise exception 'a sub-round needs the round it extends' using errcode = '22023', hint = 'base_round_required'; end if;
    v_num := v_base.round_number;
  else
    select coalesce(max(round_number), 0) + 1 into v_num from public.audit_rounds where engagement_id = p_engagement and round_suffix is null;
  end if;

  v_scope := coalesce(p_scope, jsonb_build_object('type', e.scope_type, 'companies', to_jsonb(e.scope_companies),
                                                   'codes', to_jsonb(e.scope_codes), 'month', e.scope_month));
  begin
    insert into public.audit_rounds (engagement_id, round_number, round_suffix, unit, base_round_id, created_by, idempotency_key)
    values (p_engagement, v_num, p_suffix, p_unit, p_base_round, auth.uid(), p_key) returning id into v_id;
  exception when check_violation then
    raise exception 'invalid suffix' using errcode = '22023', hint = 'invalid_suffix';
  when unique_violation then
    raise exception 'that round already exists' using errcode = '23505', hint = 'round_exists';
  end;

  insert into public.audit_round_items (round_id, engagement_id, position, code, company, name, system_qty, retail_price)
  select v_id, p_engagement, row_number() over (order by s.company, s.code, s.name), s.code, s.company, s.name, s.qty, s.price
  from (
    select coalesce(btrim(p.code), '') as code,
           coalesce(nullif(btrim(p.company), ''), 'Unassigned Manufacturer') as company,
           coalesce(p.name, '') as name, coalesce(p.qty, 0) as qty, greatest(round(coalesce(p.price, 0), 2), 0) as price
    from public.audit_scope_products(v_scope) p
  ) s;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'the scope has no products' using errcode = '22023', hint = 'no_items'; end if;
  if v_n > 20000 then raise exception 'too many items' using errcode = '22023', hint = 'too_many_items'; end if;

  perform public.log_activity('audit.round_created', 'audit_rounds', v_id::text, null,
    jsonb_build_object('engagement', p_engagement, 'number', v_num, 'suffix', p_suffix, 'unit', p_unit, 'items', v_n), null);
  return v_id;
end $$;

-- ───────── 7. assignments (draft rounds only, except revoke) ─────────
-- Greedy split: largest company first, to the person with the least load; ties go to the earlier name in the list.
-- 'company' balances by number of companies, 'volume' by number of items. An item-unit round splits item by item.
create function public.audit_assign_auto(p_round uuid, p_auditors uuid[], p_split text default 'company', p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_aud uuid[]; v_asg uuid[]; v_loads numeric[]; v_n int; j int; best int; g record; v_item uuid; v_new uuid; v_ver int; v_summary jsonb;
begin
  perform public.audit_require('audit.assign');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  if r.state <> 'draft' then raise exception 'the round is locked' using errcode = '55000', hint = 'round_not_draft'; end if;
  if p_split not in ('company', 'volume') then raise exception 'invalid split' using errcode = '22023', hint = 'invalid_split'; end if;

  select coalesce(array_agg(u order by o), '{}') into v_aud
  from (select u, min(o) o from unnest(coalesce(p_auditors, '{}')) with ordinality t(u, o) where u is not null group by u) s;
  v_n := cardinality(v_aud);
  if v_n < 1 or v_n > 50 then raise exception 'choose between 1 and 50 auditors' using errcode = '22023', hint = 'invalid_auditors'; end if;
  for j in 1 .. v_n loop
    if not public.audit_active_user(v_aud[j]) then
      raise exception 'an auditor is not active' using errcode = '22023', hint = 'auditor_unavailable';
    end if;
  end loop;

  delete from public.audit_assignment_items where round_id = p_round;
  delete from public.audit_assignments where round_id = p_round;
  v_asg := '{}';
  v_loads := array_fill(0::numeric, array[v_n]);
  for j in 1 .. v_n loop
    insert into public.audit_assignments (round_id, engagement_id, auditor_id, method, created_by)
    values (p_round, r.engagement_id, v_aud[j], 'auto-' || p_split, auth.uid()) returning id into v_new;
    v_asg := v_asg || v_new;
  end loop;

  for g in
    select company, array_agg(id order by position) as ids, count(*) as n_items
    from public.audit_round_items where round_id = p_round group by company order by count(*) desc, company
  loop
    if r.unit = 'item' then
      foreach v_item in array g.ids loop
        best := 1;
        for j in 2 .. v_n loop if v_loads[j] < v_loads[best] then best := j; end if; end loop;
        insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
        values (v_asg[best], p_round, r.engagement_id, v_item);
        v_loads[best] := v_loads[best] + 1;
      end loop;
    else
      best := 1;
      for j in 2 .. v_n loop if v_loads[j] < v_loads[best] then best := j; end if; end loop;
      insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
      select v_asg[best], p_round, r.engagement_id, x from unnest(g.ids) x;
      v_loads[best] := v_loads[best] + case when p_split = 'company' then 1 else g.n_items end;
    end if;
  end loop;

  delete from public.audit_assignments a where a.round_id = p_round
    and not exists (select 1 from public.audit_assignment_items i where i.assignment_id = a.id);
  update public.audit_rounds set version = version + 1 where id = p_round returning version into v_ver;

  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', a.id, 'auditor_id', a.auditor_id,
           'items', (select count(*) from public.audit_assignment_items i where i.assignment_id = a.id),
           'companies', (select count(distinct ri.company) from public.audit_assignment_items i
                         join public.audit_round_items ri on ri.id = i.round_item_id where i.assignment_id = a.id))
         order by a.created_at, a.id), '[]') into v_summary
  from public.audit_assignments a where a.round_id = p_round;
  perform public.log_activity('audit.assigned_auto', 'audit_rounds', p_round::text, null,
    jsonb_build_object('split', p_split, 'auditors', v_n), null);
  return jsonb_build_object('version', v_ver, 'assignments', v_summary);
end $$;

create function public.audit_assign_move(p_round uuid, p_items uuid[], p_to uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_target uuid; v_ver int; v_found int; v_want int;
begin
  perform public.audit_require('audit.assign');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  if r.state <> 'draft' then raise exception 'the round is locked' using errcode = '55000', hint = 'round_not_draft'; end if;
  v_want := coalesce(cardinality(p_items), 0);
  if v_want < 1 or v_want > 5000 then raise exception 'choose between 1 and 5000 items' using errcode = '22023', hint = 'invalid_items'; end if;
  if not public.audit_active_user(p_to) then raise exception 'the auditor is not active' using errcode = '22023', hint = 'auditor_unavailable'; end if;
  select count(*) into v_found from public.audit_assignment_items where round_id = p_round and round_item_id = any (p_items);
  if v_found <> (select count(distinct x) from unnest(p_items) x) then
    raise exception 'an item is not assigned in this round' using errcode = '22023', hint = 'item_not_assigned';
  end if;

  select id into v_target from public.audit_assignments where round_id = p_round and auditor_id = p_to and status <> 'revoked';
  if v_target is null then
    insert into public.audit_assignments (round_id, engagement_id, auditor_id, method, created_by)
    values (p_round, r.engagement_id, p_to, 'manual', auth.uid()) returning id into v_target;
  end if;
  update public.audit_assignment_items set assignment_id = v_target where round_id = p_round and round_item_id = any (p_items);
  delete from public.audit_assignments a where a.round_id = p_round
    and not exists (select 1 from public.audit_assignment_items i where i.assignment_id = a.id);
  update public.audit_rounds set version = version + 1 where id = p_round returning version into v_ver;
  perform public.log_activity('audit.assign_moved', 'audit_rounds', p_round::text, null,
    jsonb_build_object('to', p_to, 'items', v_want), null);
  return jsonb_build_object('version', v_ver, 'assignment_id', v_target);
end $$;

-- Frees a person's items. After lock the items stay unassigned until a reassignment slice handles them.
create function public.audit_assign_revoke(p_assignment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.audit_assignments; v_state text; v_freed int;
begin
  perform public.audit_require('audit.assign');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  select * into a from public.audit_assignments where id = p_assignment for update;
  if not found then raise exception 'assignment not found' using errcode = '22023', hint = 'assignment_not_found'; end if;
  if a.status = 'revoked' then return; end if;
  if a.status = 'submitted' then raise exception 'a submitted assignment must be reopened, not revoked' using errcode = '55000', hint = 'assignment_submitted'; end if;
  select state into v_state from public.audit_rounds where id = a.round_id for update;
  if v_state = 'final' then raise exception 'a final round cannot change' using errcode = '55000', hint = 'round_final'; end if;
  delete from public.audit_assignment_items where assignment_id = p_assignment;
  get diagnostics v_freed = row_count;
  update public.audit_assignments set status = 'revoked' where id = p_assignment;
  update public.audit_rounds set version = version + 1 where id = a.round_id;
  perform public.log_activity('audit.assign_revoked', 'audit_assignments', p_assignment::text,
    jsonb_build_object('auditor', a.auditor_id, 'status', a.status), jsonb_build_object('freed_items', v_freed), p_reason);
end $$;

-- ───────── 8. lock ─────────
-- Freezes the item list (the guard trigger then refuses any change). Every item must be assigned exactly once.
create function public.audit_round_lock(p_round uuid, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_items int; v_free int; v_status text; v_ver int; v_at timestamptz;
begin
  perform public.audit_require('audit.manage');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  if r.state <> 'draft' then raise exception 'the round is already locked' using errcode = '55000', hint = 'round_not_draft'; end if;
  select status into v_status from public.audit_engagements where id = r.engagement_id;
  if v_status <> 'open' then raise exception 'the engagement is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;
  select count(*) into v_items from public.audit_round_items where round_id = p_round;
  if v_items = 0 then raise exception 'the round has no items' using errcode = '22023', hint = 'no_items'; end if;
  select count(*) into v_free from public.audit_round_items ri
    where ri.round_id = p_round and not exists (select 1 from public.audit_assignment_items i where i.round_item_id = ri.id);
  if v_free > 0 then
    raise exception '% items are not assigned', v_free using errcode = '55000', hint = 'items_unassigned';
  end if;
  update public.audit_rounds set state = 'locked', locked_at = now(), version = version + 1
    where id = p_round returning version, locked_at into v_ver, v_at;
  perform public.log_activity('audit.round_locked', 'audit_rounds', p_round::text, null, jsonb_build_object('items', v_items), null);
  return jsonb_build_object('state', 'locked', 'version', v_ver, 'locked_at', v_at, 'items', v_items);
end $$;

-- ───────── 9. read policies (no write policy: writes go through the functions above) ─────────
create policy audit_engagements_read on public.audit_engagements for select to authenticated
  using (public.audit_can_view(id));
create policy audit_members_read on public.audit_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_perm('audit.manage')));
create policy audit_rounds_read on public.audit_rounds for select to authenticated
  using (public.audit_can_view(engagement_id));
create policy audit_round_items_read on public.audit_round_items for select to authenticated
  using (public.audit_can_view(engagement_id));
create policy audit_assignments_read on public.audit_assignments for select to authenticated
  using (auditor_id = (select auth.uid()) or (select public.has_perm('audit.assign')) or public.audit_can_view(engagement_id));
create policy audit_assignment_items_read on public.audit_assignment_items for select to authenticated
  using (public.audit_can_view(engagement_id) or (select public.has_perm('audit.assign'))
         or exists (select 1 from public.audit_assignments a where a.id = assignment_id and a.auditor_id = (select auth.uid())));

grant select on public.audit_engagements, public.audit_members, public.audit_rounds, public.audit_round_items,
  public.audit_assignments, public.audit_assignment_items to authenticated;

-- ───────── 10. grants: the browser calls only the public functions ─────────
revoke all on function public.audit_require(text), public.audit_active_user(uuid), public.audit_check_version(int, int),
  public.audit_scope_products(jsonb), public.audit_rounds_guard(), public.audit_round_items_guard(), public.audit_assignments_guard()
  from public, anon, authenticated;
revoke all on function public.audit_can_view(uuid), public.audit_engagement_create(uuid, text, text, text[], text[], text),
  public.audit_member_set(uuid, uuid, text), public.audit_round_create(uuid, uuid, text, jsonb, text, uuid),
  public.audit_assign_auto(uuid, uuid[], text, int), public.audit_assign_move(uuid, uuid[], uuid, int),
  public.audit_assign_revoke(uuid, text), public.audit_round_lock(uuid, int) from public, anon, authenticated;
grant execute on function public.audit_can_view(uuid), public.audit_engagement_create(uuid, text, text, text[], text[], text),
  public.audit_member_set(uuid, uuid, text), public.audit_round_create(uuid, uuid, text, jsonb, text, uuid),
  public.audit_assign_auto(uuid, uuid[], text, int), public.audit_assign_move(uuid, uuid[], uuid, int),
  public.audit_assign_revoke(uuid, text), public.audit_round_lock(uuid, int) to authenticated;
