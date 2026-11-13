-- 0201_closing_tables: shift closing (staff-facing). Brief: docs/modules/closing.md. Rules: docs/BUSINESS_RULES.md 3-7.
-- Every write goes through RPC functions (0202+); browsers get select only. Submitted closings are immutable (D-12).

-- ── slots ────────────────────────────────────────────────────────────────────────────────────────
-- Night starts the day (C1). seq orders the slots of one date: night 10, morning 20, handovers 30.., evening 9999.
create table public.closing_slots (
  id uuid primary key default gen_random_uuid(),
  business_date date not null check (business_date >= date '2000-01-01'),
  kind text not null check (kind in ('night', 'morning', 'evening', 'handover')),
  seq int not null,
  created_at timestamptz not null default now(),
  unique (business_date, kind, seq),
  unique (business_date, seq),
  check (
    (kind = 'night' and seq = 10) or (kind = 'morning' and seq = 20) or
    (kind = 'evening' and seq = 9999) or (kind = 'handover' and seq between 21 and 9998)
  )
);
create index closing_slots_date on public.closing_slots (business_date);

-- ── the closing itself ───────────────────────────────────────────────────────────────────────────
create table public.closings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.closing_slots (id),
  mode text not null default 'shift' check (mode in ('shift', 'final')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'superseded')),
  revision int not null default 1 check (revision >= 1),
  supersedes_id uuid references public.closings (id),
  responsible_staff_id uuid references public.staff (id),
  entered_by uuid not null references auth.users (id),
  idempotency_key uuid not null unique,
  submitted_at timestamptz,
  correction_reason text,
  -- inputs typed by the cashier
  sys_cash numeric(14, 2) not null default 0,
  last_bill_no integer not null default 0 check (last_bill_no >= 0),
  comp_sale numeric(14, 2) not null default 0,
  alfalah numeric(14, 2) not null default 0,
  keenu numeric(14, 2) not null default 0,
  ret_manual_1 numeric(14, 2) not null default 0,
  ret_manual_2 numeric(14, 2) not null default 0,
  ret_manual_3 numeric(14, 2) not null default 0,
  ret_system numeric(14, 2) not null default 0,
  book_bill_1 numeric(14, 2) not null default 0,
  book_bill_2 numeric(14, 2) not null default 0,
  extra_cash numeric(14, 2) not null default 0,
  credit_adj numeric(14, 2) not null default 0,
  credit_adj_line_id uuid not null default gen_random_uuid(), -- stable across revisions (feed to Manager, C9)
  prev_mediq numeric(14, 2) not null default 0,
  final_sys_returns numeric(14, 2) not null default 0,
  -- hand overrides (null = use the calculated value)
  ov_shift_sale numeric(14, 2),
  ov_customers integer check (ov_customers is null or ov_customers >= 0),
  ov_curr_cc numeric(14, 2),
  ov_prev_cash numeric(14, 2),
  -- carried in from the previous slot, stored with their source
  prev_cc numeric(14, 2) not null default 0,
  prev_credit numeric(14, 2) not null default 0,
  prev_deposits numeric(14, 2) not null default 0,
  prev_cash numeric(14, 2) not null default 0,
  source_closing_id uuid references public.closings (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, revision),
  check ((status = 'draft') = (submitted_at is null) or status = 'superseded'),
  check (revision = 1 or (supersedes_id is not null and correction_reason is not null and length(trim(correction_reason)) > 0))
);
-- at most one live (draft or submitted) closing per slot; superseded revisions are kept for audit
create unique index closings_one_live_per_slot on public.closings (slot_id) where status in ('draft', 'submitted');
create index closings_entered_by on public.closings (entered_by);
create index closings_source on public.closings (source_closing_id);
create trigger closings_updated_at before update on public.closings for each row execute function public.set_updated_at();

-- ── child tables (struck-through rows keep deleted_at and are excluded from every total, C6) ─────
create table public.closing_hs_rows (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.closings (id) on delete cascade,
  label text not null default '' check (length(label) <= 120),
  amount numeric(14, 2) not null default 0,
  sort int not null default 0,
  deleted_at timestamptz
);
create table public.closing_strip_lines (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.closings (id) on delete cascade,
  strip_id uuid, -- configured strip (closing_strips.id) or null for an ad-hoc line
  label text not null default '' check (length(label) <= 120),
  price numeric(14, 2) not null default 0,
  qty numeric not null default 0,
  sort int not null default 0,
  deleted_at timestamptz
);
create table public.closing_cash_counts (
  closing_id uuid not null references public.closings (id) on delete cascade,
  area text not null check (area in ('till', 'vault')),
  denomination int not null check (denomination in (5000, 1000, 500, 100, 50, 20, 10, 1)), -- 1 = coins / loose
  qty numeric not null default 0 check (qty >= 0),
  primary key (closing_id, area, denomination)
);
create table public.closing_credit_lines (
  id uuid primary key default gen_random_uuid(),
  -- line_id is stable across revisions of the same closing (Manager stores it, MODULES.md 8.2)
  line_id uuid not null default gen_random_uuid(),
  closing_id uuid not null references public.closings (id) on delete cascade,
  kind text not null check (kind in ('named', 'tier', 'free')),
  account_id uuid, -- closing_credit_accounts.id for named lines
  tier_slot smallint check (tier_slot between 1 and 3),
  label text not null default '' check (length(label) <= 120),
  amount numeric(14, 2) not null default 0, -- THIS shift's new credit, never a carried balance (CLS-4)
  sort int not null default 0,
  deleted_at timestamptz,
  unique (closing_id, line_id),
  check ((kind = 'tier') = (tier_slot is not null))
);
create table public.closing_deposits (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.closings (id) on delete cascade,
  label text not null default '' check (length(label) <= 120),
  amount numeric(14, 2) not null default 0,
  sort int not null default 0,
  deleted_at timestamptz
);
create table public.closing_mediq_orders (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.closings (id) on delete cascade,
  bill_no text not null default '' check (length(bill_no) <= 60),
  collected numeric(14, 2) not null default 0, -- cash collected from the customer
  pharmacy_bill numeric(14, 2) not null default 0, -- the matching pharmacy bill; extra = collected - pharmacy_bill
  sort int not null default 0,
  deleted_at timestamptz
);
create table public.closing_misc_rows (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references public.closings (id) on delete cascade,
  charge_id uuid not null default gen_random_uuid(), -- stable across slots, so aging does not depend on label text (C8)
  label text not null default '' check (length(label) <= 120),
  amount numeric(14, 2) not null default 0,
  sort int not null default 0,
  deleted_at timestamptz
);
create table public.closing_inventory_audit (
  closing_id uuid primary key references public.closings (id) on delete cascade,
  verified_at timestamptz not null,
  verified_by uuid references public.staff (id),
  data_as_of timestamptz,
  codes_checked int not null default 0,
  not_found text[] not null default '{}'
);
create table public.closing_inventory_audit_items (
  closing_id uuid not null references public.closings (id) on delete cascade,
  item_code text not null,
  item_name text not null default '',
  qty numeric not null,
  primary key (closing_id, item_code)
);
create index closing_hs_rows_closing on public.closing_hs_rows (closing_id);
create index closing_strip_lines_closing on public.closing_strip_lines (closing_id);
create index closing_credit_lines_closing on public.closing_credit_lines (closing_id);
create index closing_credit_lines_line on public.closing_credit_lines (line_id);
create index closing_deposits_closing on public.closing_deposits (closing_id);
create index closing_mediq_orders_closing on public.closing_mediq_orders (closing_id);
create index closing_misc_rows_closing on public.closing_misc_rows (closing_id);
create index closing_misc_rows_charge on public.closing_misc_rows (charge_id);

-- ── saved result: written once, at submit (never updated) ────────────────────────────────────────
create table public.closing_results (
  closing_id uuid primary key references public.closings (id),
  till_float numeric(14, 2) not null, -- the settings used, kept so a later settings change never rewrites history
  per_customer_charge numeric(14, 2) not null,
  customers_charge numeric(14, 2) not null,
  hs_total numeric(14, 2) not null,
  strips_a numeric(14, 2) not null,
  total_returns numeric(14, 2) not null,
  mediq_extra numeric(14, 2) not null,
  shift_sale numeric(14, 2) not null,
  customers integer not null,
  net_sale numeric(14, 2) not null,
  cc_curr numeric(14, 2) not null,
  cc_total numeric(14, 2) not null,
  till_c numeric(14, 2) not null,
  vault_d numeric(14, 2) not null,
  debt_e numeric(14, 2) not null,
  deposits_f numeric(14, 2) not null,
  misc_g numeric(14, 2) not null,
  grand numeric(14, 2) not null,
  liquid numeric(14, 2) not null,
  prev_cash numeric(14, 2) not null,
  net_cash numeric(14, 2) not null,
  shift_variance numeric(14, 2) not null, -- this shift's OWN variance, net_cash - net_sale (C7)
  final_net_sale numeric(14, 2) not null,
  final_net_cash numeric(14, 2) not null,
  final_variance numeric(14, 2), -- only in Final mode
  computed_at timestamptz not null default now()
);

-- ── configuration (changed through RPC in slice C8) ──────────────────────────────────────────────
create table public.closing_strips (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 80),
  group_name text not null default '' check (length(group_name) <= 60),
  price numeric(14, 2) not null check (price >= 0),
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.closing_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('named', 'tier_name')),
  tier_no smallint check (tier_no between 1 and 3),
  label text not null check (length(trim(label)) between 1 and 80),
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'tier_name') = (tier_no is not null))
);
create table public.closing_audit_items (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{1,30}$'),
  name text not null default '',
  sort int not null default 100,
  active boolean not null default true
);

alter table public.closing_slots enable row level security;
alter table public.closings enable row level security;
alter table public.closing_hs_rows enable row level security;
alter table public.closing_strip_lines enable row level security;
alter table public.closing_cash_counts enable row level security;
alter table public.closing_credit_lines enable row level security;
alter table public.closing_deposits enable row level security;
alter table public.closing_mediq_orders enable row level security;
alter table public.closing_misc_rows enable row level security;
alter table public.closing_inventory_audit enable row level security;
alter table public.closing_inventory_audit_items enable row level security;
alter table public.closing_results enable row level security;
alter table public.closing_strips enable row level security;
alter table public.closing_credit_accounts enable row level security;
alter table public.closing_audit_items enable row level security;

-- ── who may read (C10): staff see only their own closings; view_all / review / correct see everyone's ──
create policy closing_slots_read on public.closing_slots for select to authenticated
  using (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct'));
create policy closings_read on public.closings for select to authenticated
  using (
    public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
    or (public.has_perm('closing.enter_own') and entered_by = auth.uid())
  );
-- child rows are visible exactly when their closing is (the subquery is itself filtered by closings_read)
create policy closing_hs_rows_read on public.closing_hs_rows for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_strip_lines_read on public.closing_strip_lines for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_cash_counts_read on public.closing_cash_counts for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_credit_lines_read on public.closing_credit_lines for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_deposits_read on public.closing_deposits for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_mediq_orders_read on public.closing_mediq_orders for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_misc_rows_read on public.closing_misc_rows for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_inventory_audit_read on public.closing_inventory_audit for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_inventory_audit_items_read on public.closing_inventory_audit_items for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
create policy closing_results_read on public.closing_results for select to authenticated using (exists (select 1 from public.closings c where c.id = closing_id));
-- configuration lists are needed to fill in a closing
create policy closing_strips_read on public.closing_strips for select to authenticated
  using (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.settings'));
create policy closing_credit_accounts_read on public.closing_credit_accounts for select to authenticated
  using (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.settings'));
create policy closing_audit_items_read on public.closing_audit_items for select to authenticated
  using (public.has_perm('closing.enter_own') or public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.settings'));

-- no insert / update / delete policy and no such grant: writes are possible only through the RPCs
grant select on public.closing_slots, public.closings, public.closing_hs_rows, public.closing_strip_lines,
  public.closing_cash_counts, public.closing_credit_lines, public.closing_deposits, public.closing_mediq_orders,
  public.closing_misc_rows, public.closing_inventory_audit, public.closing_inventory_audit_items,
  public.closing_results, public.closing_strips, public.closing_credit_accounts, public.closing_audit_items
  to authenticated;

-- ── immutability (D-12): defence in depth under the RLS above ───────────────────────────────────
create function public.closing_lock_closing() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'closing is locked' using errcode = '55000'; end if;
    return old;
  end if;
  if old.status = 'draft' then
    if new.status = 'superseded' then raise exception 'a draft cannot be superseded' using errcode = '55000'; end if;
    return new;
  end if;
  -- a submitted closing may only change to superseded (by closing_correct), and nothing else may change
  if old.status = 'submitted' and new.status = 'superseded'
     and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at') then
    return new;
  end if;
  raise exception 'closing is locked' using errcode = '55000';
end $$;
create trigger closings_lock before update or delete on public.closings for each row execute function public.closing_lock_closing();

create function public.closing_lock_children() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  if tg_op = 'DELETE' then v_id := old.closing_id; else v_id := new.closing_id; end if;
  if tg_op = 'UPDATE' and new.closing_id <> old.closing_id then
    raise exception 'a row cannot move to another closing' using errcode = '55000';
  end if;
  select status into v_status from public.closings where id = v_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'closing is locked' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger closing_hs_rows_lock before insert or update or delete on public.closing_hs_rows for each row execute function public.closing_lock_children();
create trigger closing_strip_lines_lock before insert or update or delete on public.closing_strip_lines for each row execute function public.closing_lock_children();
create trigger closing_cash_counts_lock before insert or update or delete on public.closing_cash_counts for each row execute function public.closing_lock_children();
create trigger closing_credit_lines_lock before insert or update or delete on public.closing_credit_lines for each row execute function public.closing_lock_children();
create trigger closing_deposits_lock before insert or update or delete on public.closing_deposits for each row execute function public.closing_lock_children();
create trigger closing_mediq_orders_lock before insert or update or delete on public.closing_mediq_orders for each row execute function public.closing_lock_children();
create trigger closing_misc_rows_lock before insert or update or delete on public.closing_misc_rows for each row execute function public.closing_lock_children();
create trigger closing_inventory_audit_lock before insert or update or delete on public.closing_inventory_audit for each row execute function public.closing_lock_children();
create trigger closing_inventory_audit_items_lock before insert or update or delete on public.closing_inventory_audit_items for each row execute function public.closing_lock_children();

create function public.closing_results_append_only() returns trigger language plpgsql as $$
begin raise exception 'closing results are append-only' using errcode = '55000'; end $$;
create trigger closing_results_frozen before update or delete on public.closing_results for each row execute function public.closing_results_append_only();

-- ── the calculation (mirror of js/modules/closing/domain/compute.js; tests/fixtures/closing-cases.json) ──
create function public.closing_n(v jsonb) returns numeric language sql immutable set search_path = public as $$
  select case
    when v is null or jsonb_typeof(v) = 'null' then 0
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v #>> '{}')::numeric
    else 0 end
$$;

-- sum of one key over the rows that are not struck through
create function public.closing_rows_sum(rows jsonb, k text) returns numeric language sql immutable set search_path = public as $$
  select coalesce(sum(public.closing_n(e -> k)), 0)
  from jsonb_array_elements(case when jsonb_typeof(rows) = 'array' then rows else '[]'::jsonb end) e
  where coalesce((e ->> 'deleted')::boolean, false) = false
$$;

create function public.closing_list_sum(items jsonb) returns numeric language sql immutable set search_path = public as $$
  select coalesce(sum(public.closing_n(e)), 0)
  from jsonb_array_elements(case when jsonb_typeof(items) = 'array' then items else '[]'::jsonb end) e
$$;

-- counts[i] of denomination i, in the order 5000, 1000, 500, 100, 50, 20, 10, 1
create function public.closing_cash_sum(counts jsonb) returns numeric language sql immutable set search_path = public as $$
  select coalesce(sum(public.closing_n(counts -> (d.ord - 1)::int) * d.val), 0)
  from unnest(array[5000, 1000, 500, 100, 50, 20, 10, 1]) with ordinality as d(val, ord)
$$;

-- an override applies only when present and not null; a typed 0 is a real override
create function public.closing_ov(p jsonb, k text, computed numeric) returns numeric language sql immutable set search_path = public as $$
  select case when p -> 'overrides' -> k is null or jsonb_typeof(p -> 'overrides' -> k) = 'null' or (p -> 'overrides' ->> k) = ''
              then computed else public.closing_n(p -> 'overrides' -> k) end
$$;

create function public.closing_calc(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_final boolean := coalesce(p ->> 'mode', 'shift') = 'final';
  v_float numeric; v_charge numeric;
  v_hs numeric; v_strips numeric; v_ret numeric; v_man numeric; v_sysret numeric; v_mediq numeric;
  v_sys numeric; v_prev_exists boolean; v_sale numeric; v_ship numeric; v_bills numeric; v_cust numeric; v_book numeric;
  v_net_sale numeric; v_cc_curr numeric; v_cc_total numeric; v_till numeric; v_vault numeric;
  v_debt numeric; v_dep numeric; v_misc numeric; v_grand numeric; v_liquid numeric;
  v_prev_cash numeric; v_extra numeric; v_net_cash numeric;
  v_same_cust numeric; v_pre_cust numeric; v_fns numeric; v_pre_total numeric; v_fnc numeric;
  a jsonb := case when v_final then '{}'::jsonb else coalesce(p -> 'agg', '{}'::jsonb) end;
begin
  if p -> 'settings' -> 'till_float' is null or p -> 'settings' -> 'per_customer_charge' is null then
    raise exception 'closing settings (till_float, per_customer_charge) are required';
  end if;
  v_float := public.closing_n(p -> 'settings' -> 'till_float');
  v_charge := public.closing_n(p -> 'settings' -> 'per_customer_charge');

  v_hs := public.closing_rows_sum(p -> 'hs', 'v');
  select coalesce(sum(public.closing_n(e -> 'price') * public.closing_n(e -> 'qty')), 0) into v_strips
    from jsonb_array_elements(case when jsonb_typeof(p -> 'strips') = 'array' then p -> 'strips' else '[]'::jsonb end) e
    where coalesce((e ->> 'deleted')::boolean, false) = false;
  v_man := public.closing_list_sum(p -> 'returns' -> 'manual');
  v_sysret := public.closing_n(p -> 'returns' -> 'system');
  v_ret := v_man + v_sysret;
  select public.closing_n(p -> 'prev_mediq') + coalesce(sum(public.closing_n(e -> 'collected') - public.closing_n(e -> 'bill')), 0) into v_mediq
    from jsonb_array_elements(case when jsonb_typeof(p -> 'mediq') = 'array' then p -> 'mediq' else '[]'::jsonb end) e
    where coalesce((e ->> 'deleted')::boolean, false) = false;

  v_sys := public.closing_n(p -> 'pos' -> 'sys_cash');
  v_prev_exists := coalesce((p -> 'prev' ->> 'exists')::boolean, false);
  v_sale := case when v_final or coalesce((p -> 'prev' ->> 'day_changed')::boolean, false) or not v_prev_exists
                 then v_sys else v_sys - public.closing_n(p -> 'prev' -> 'sys_cash') end;
  v_ship := public.closing_ov(p, 'shift_sale', v_sale);
  v_bills := case when v_prev_exists
                  then greatest(0, trunc(public.closing_n(p -> 'pos' -> 'last_bill_no')) - trunc(public.closing_n(p -> 'prev' -> 'last_bill_no')))
                  else 0 end;
  v_cust := trunc(public.closing_ov(p, 'customers', v_bills));
  v_book := public.closing_n(p -> 'book' -> 0) + public.closing_n(p -> 'book' -> 1);

  v_net_sale := v_ship + v_book + v_cust * v_charge - v_ret + v_mediq;

  v_cc_curr := public.closing_ov(p, 'curr_cc',
    public.closing_n(p -> 'pos' -> 'alfalah') + public.closing_n(p -> 'pos' -> 'keenu') - public.closing_n(p -> 'pos' -> 'comp_sale'));
  v_cc_total := public.closing_n(p -> 'carried' -> 'cc') + v_cc_curr;

  v_till := public.closing_cash_sum(p -> 'till');
  v_vault := public.closing_cash_sum(p -> 'vault');
  v_debt := public.closing_n(p -> 'carried' -> 'credit') + public.closing_rows_sum(p -> 'credit' -> 'named', 'v')
          + public.closing_list_sum(p -> 'credit' -> 'tier') + public.closing_rows_sum(p -> 'credit' -> 'free', 'v')
          + public.closing_n(p -> 'credit_adj');
  v_dep := public.closing_n(p -> 'carried' -> 'deposits') + public.closing_rows_sum(p -> 'deposits', 'v');
  v_misc := public.closing_rows_sum(p -> 'misc', 'v');

  v_grand := v_hs + v_strips + v_misc + v_cc_total + v_till + v_vault + v_debt + v_dep;
  v_liquid := v_grand - v_float;
  v_prev_cash := public.closing_ov(p, 'prev_cash', public.closing_n(p -> 'carried' -> 'cash'));
  v_extra := public.closing_n(p -> 'extra_cash');
  v_net_cash := v_liquid - v_prev_cash - v_extra;

  -- period roll-up since the last Final (a Final uses only its own values; `a` is empty then)
  v_same_cust := trunc(public.closing_n(a -> 'same_date_customers')) + trunc(public.closing_n(a -> 'lf_same_date_cust')) + v_cust;
  v_pre_cust := trunc(public.closing_n(a -> 'pre_date_customers')) + trunc(public.closing_n(a -> 'lf_pre_date_cust'));
  v_fns := public.closing_n(a -> 'same_date_shift_sale') + public.closing_n(a -> 'lf_same_date_sale') + v_ship
         + (public.closing_n(a -> 'total_book_bills') + v_book)
         + v_same_cust * v_charge
         + (public.closing_n(a -> 'total_mediq_extra') + v_mediq)
         - (public.closing_n(a -> 'total_manual_returns') + v_man)
         - (public.closing_n(a -> 'same_date_sys_returns') + public.closing_n(a -> 'lf_same_date_sys_ret') + v_sysret)
         - public.closing_n(p -> 'final_sys_returns');
  v_pre_total := public.closing_n(a -> 'pre_date_shift_sale') + public.closing_n(a -> 'lf_pre_date_sale') + v_pre_cust * v_charge
               - (public.closing_n(a -> 'pre_date_sys_returns') + public.closing_n(a -> 'lf_pre_date_sys_ret'));
  v_fnc := v_liquid - v_pre_total - (public.closing_n(a -> 'total_extra_cash') + v_extra) - v_fns;

  return jsonb_build_object(
    'customers_charge', v_cust * v_charge, 'hs_total', v_hs, 'strips_a', v_strips, 'total_returns', v_ret,
    'mediq_extra', v_mediq, 'shift_sale', v_ship, 'customers', v_cust, 'net_sale', v_net_sale,
    'cc_curr', v_cc_curr, 'cc_total', v_cc_total, 'till_c', v_till, 'vault_d', v_vault, 'debt_e', v_debt,
    'deposits_f', v_dep, 'misc_g', v_misc, 'grand', v_grand, 'liquid', v_liquid, 'prev_cash', v_prev_cash,
    'net_cash', v_net_cash, 'shift_variance', v_net_cash - v_net_sale,
    'final_net_sale', v_fns, 'final_net_cash', v_fnc,
    'final_variance', case when v_final then to_jsonb(v_fnc) else 'null'::jsonb end
  );
end $$;

-- pure functions with no data access: callable by signed-in users (the browser preview uses the JS copy)
revoke all on function public.closing_n(jsonb), public.closing_rows_sum(jsonb, text), public.closing_list_sum(jsonb),
  public.closing_cash_sum(jsonb), public.closing_ov(jsonb, text, numeric), public.closing_calc(jsonb) from public, anon, authenticated;
grant execute on function public.closing_n(jsonb), public.closing_rows_sum(jsonb, text), public.closing_list_sum(jsonb),
  public.closing_cash_sum(jsonb), public.closing_ov(jsonb, text, numeric), public.closing_calc(jsonb) to authenticated;

-- ── closing_compute: build the calculation input from the saved rows and run closing_calc ────────
-- Read-only preview of a closing's figures. TODO (slice C4): the period roll-up `agg` for Shift closings (informational
-- final_net_* figures) is filled here once carry-forward exists; until then it is empty, which is exact for a Final closing.
-- internal: no permission check (the callers do it). Not granted to anyone.
create function public.closing_build_input(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings; src public.closings; src_date date; this_date date; v_in jsonb;
begin
  select * into c from public.closings where id = p_closing;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  select business_date into this_date from public.closing_slots where id = c.slot_id;
  if c.source_closing_id is not null then
    select * into src from public.closings where id = c.source_closing_id;
    select business_date into src_date from public.closing_slots where id = src.slot_id;
  end if;

  v_in := jsonb_build_object(
    'mode', c.mode,
    'settings', jsonb_build_object(
      'till_float', (select value from public.settings where key = 'till_float'),
      'per_customer_charge', (select value from public.settings where key = 'per_customer_charge')),
    'pos', jsonb_build_object('sys_cash', c.sys_cash, 'last_bill_no', c.last_bill_no, 'comp_sale', c.comp_sale, 'alfalah', c.alfalah, 'keenu', c.keenu),
    'returns', jsonb_build_object('manual', jsonb_build_array(c.ret_manual_1, c.ret_manual_2, c.ret_manual_3), 'system', c.ret_system),
    'book', jsonb_build_array(c.book_bill_1, c.book_bill_2),
    'extra_cash', c.extra_cash, 'credit_adj', c.credit_adj, 'prev_mediq', c.prev_mediq, 'final_sys_returns', c.final_sys_returns,
    'prev', jsonb_build_object(
      'exists', c.source_closing_id is not null,
      'day_changed', c.source_closing_id is not null and src_date <> this_date,
      'sys_cash', coalesce(src.sys_cash, 0), 'last_bill_no', coalesce(src.last_bill_no, 0)),
    'carried', jsonb_build_object('cc', c.prev_cc, 'credit', c.prev_credit, 'deposits', c.prev_deposits, 'cash', c.prev_cash),
    'overrides', jsonb_build_object('shift_sale', c.ov_shift_sale, 'customers', c.ov_customers, 'curr_cc', c.ov_curr_cc, 'prev_cash', c.ov_prev_cash),
    'hs', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_hs_rows where closing_id = c.id), '[]'),
    'strips', coalesce((select jsonb_agg(jsonb_build_object('price', price, 'qty', qty, 'deleted', deleted_at is not null) order by sort, id) from public.closing_strip_lines where closing_id = c.id), '[]'),
    'mediq', coalesce((select jsonb_agg(jsonb_build_object('collected', collected, 'bill', pharmacy_bill, 'deleted', deleted_at is not null) order by sort, id) from public.closing_mediq_orders where closing_id = c.id), '[]'),
    'deposits', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_deposits where closing_id = c.id), '[]'),
    'misc', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_misc_rows where closing_id = c.id), '[]'),
    'till', (select jsonb_agg(coalesce(k.qty, 0) order by d.ord)
             from unnest(array[5000, 1000, 500, 100, 50, 20, 10, 1]) with ordinality d(val, ord)
             left join public.closing_cash_counts k on k.closing_id = c.id and k.area = 'till' and k.denomination = d.val),
    'vault', (select jsonb_agg(coalesce(k.qty, 0) order by d.ord)
              from unnest(array[5000, 1000, 500, 100, 50, 20, 10, 1]) with ordinality d(val, ord)
              left join public.closing_cash_counts k on k.closing_id = c.id and k.area = 'vault' and k.denomination = d.val),
    'credit', jsonb_build_object(
      'named', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_credit_lines where closing_id = c.id and kind = 'named'), '[]'),
      'tier', coalesce((select jsonb_agg(case when deleted_at is null then amount else 0 end order by tier_slot) from public.closing_credit_lines where closing_id = c.id and kind = 'tier'), '[]'),
      'free', coalesce((select jsonb_agg(jsonb_build_object('v', amount, 'deleted', deleted_at is not null) order by sort, id) from public.closing_credit_lines where closing_id = c.id and kind = 'free'), '[]'))
  );
  return v_in;
end $$;
revoke all on function public.closing_build_input(uuid) from public, anon, authenticated;

create function public.closing_compute(p_closing uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.closings;
begin
  select * into c from public.closings where id = p_closing;
  if not found or not (public.has_perm('closing.view_all') or public.has_perm('closing.review') or public.has_perm('closing.correct')
          or (public.has_perm('closing.enter_own') and c.entered_by = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.closing_calc(public.closing_build_input(p_closing));
end $$;
revoke all on function public.closing_compute(uuid) from public, anon, authenticated;
grant execute on function public.closing_compute(uuid) to authenticated;

-- internal: store the result of a closing that is being submitted. Not callable from the browser.
create function public.closing_write_result(p_closing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_float numeric; v_charge numeric;
begin
  -- called only from closing_submit / closing_correct, which have already checked the permission
  r := public.closing_calc(public.closing_build_input(p_closing));
  v_float := (select (value #>> '{}')::numeric from public.settings where key = 'till_float');
  v_charge := (select (value #>> '{}')::numeric from public.settings where key = 'per_customer_charge');
  insert into public.closing_results (closing_id, till_float, per_customer_charge, customers_charge, hs_total, strips_a, total_returns,
    mediq_extra, shift_sale, customers, net_sale, cc_curr, cc_total, till_c, vault_d, debt_e, deposits_f, misc_g, grand, liquid,
    prev_cash, net_cash, shift_variance, final_net_sale, final_net_cash, final_variance)
  values (p_closing, v_float, v_charge, (r ->> 'customers_charge')::numeric, (r ->> 'hs_total')::numeric, (r ->> 'strips_a')::numeric,
    (r ->> 'total_returns')::numeric, (r ->> 'mediq_extra')::numeric, (r ->> 'shift_sale')::numeric, (r ->> 'customers')::int,
    (r ->> 'net_sale')::numeric, (r ->> 'cc_curr')::numeric, (r ->> 'cc_total')::numeric, (r ->> 'till_c')::numeric,
    (r ->> 'vault_d')::numeric, (r ->> 'debt_e')::numeric, (r ->> 'deposits_f')::numeric, (r ->> 'misc_g')::numeric,
    (r ->> 'grand')::numeric, (r ->> 'liquid')::numeric, (r ->> 'prev_cash')::numeric, (r ->> 'net_cash')::numeric,
    (r ->> 'shift_variance')::numeric, (r ->> 'final_net_sale')::numeric, (r ->> 'final_net_cash')::numeric,
    nullif(r ->> 'final_variance', '')::numeric);
end $$;
revoke all on function public.closing_write_result(uuid) from public, anon, authenticated;
