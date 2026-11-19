-- 0410_audit_expiry: Audit module, slice C1 (Expiry Tracking). Brief: docs/modules/audit.md (R10, section 4, 5, 6).
-- A shared near-expiry register. Racks are a small list kept by the owner; each month the owner says who checks which rack;
-- people with audit.expiry_log log entries, which are locked on save. Only the owner (audit.expiry_manage) can reopen, edit
-- or delete an entry. Everyone who may use Expiry can search every entry. Nothing is written except through the functions.

-- ───────── 1. tables ─────────
create table public.audit_racks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create unique index audit_racks_name_unique on public.audit_racks (lower(btrim(name)));
alter table public.audit_racks enable row level security;

create table public.audit_rack_assignments (
  id uuid primary key default gen_random_uuid(),
  rack_id uuid not null references public.audit_racks (id),
  rack_name text not null,              -- copied, so a later rename does not rewrite past months
  user_id uuid not null references auth.users (id),
  staff_name text not null,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  assigned_by uuid references auth.users (id),
  assigned_at timestamptz not null default now(),
  unique (rack_id, month)
);
alter table public.audit_rack_assignments enable row level security;
create index audit_rack_assignments_month on public.audit_rack_assignments (month);

create table public.audit_expiry_entries (
  id uuid primary key default gen_random_uuid(),
  client_key uuid not null unique,      -- a resend of the same save returns the same entry
  user_id uuid not null references auth.users (id),
  staff_name text not null,
  product_code text not null default '',
  product_name text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  expiry_month text not null check (expiry_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  rack_location text not null check (length(btrim(rack_location)) between 1 and 60),
  status text not null default 'Near Expiry' check (status in ('Near Expiry', 'Sold', 'Returned to Warehouse', 'Discarded')),
  locked boolean not null default true,
  logged_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reopened_by uuid references auth.users (id),
  reopened_at timestamptz
);
alter table public.audit_expiry_entries enable row level security;
create index audit_expiry_entries_month on public.audit_expiry_entries (expiry_month);
create index audit_expiry_entries_status on public.audit_expiry_entries (status);
create index audit_expiry_entries_user on public.audit_expiry_entries (user_id);

-- Who may use Expiry at all: the logging key, the manage key, or the audit owner key.
create function public.audit_expiry_can_read() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_perm('audit.expiry_log') or public.has_perm('audit.expiry_manage') or public.has_perm('audit.manage')
$$;
create policy audit_racks_read on public.audit_racks for select to authenticated using (public.audit_expiry_can_read());
create policy audit_rack_assignments_read on public.audit_rack_assignments for select to authenticated using (public.audit_expiry_can_read());
create policy audit_expiry_entries_read on public.audit_expiry_entries for select to authenticated using (public.audit_expiry_can_read());
grant select on public.audit_racks, public.audit_rack_assignments, public.audit_expiry_entries to authenticated;
grant execute on function public.audit_expiry_can_read() to authenticated;
revoke all on function public.audit_expiry_can_read() from public, anon;

-- ───────── 2. helpers ─────────
create function public.audit_expiry_require_read() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.audit_expiry_can_read() then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
end $$;

-- The pharmacy's own calendar month, moved by n months: 'YYYY-MM'.
create function public.audit_expiry_month(p_shift int default 0) returns text language sql stable set search_path = public as $$
  select to_char((now() at time zone 'Asia/Karachi')::date + make_interval(months => p_shift), 'YYYY-MM')
$$;

-- ───────── 3. racks and monthly assignment (owner) ─────────
create function public.audit_rack_save(p_id uuid, p_name text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.audit_require('audit.expiry_manage');
  if length(v_name) < 1 or length(v_name) > 60 then raise exception 'a rack needs a name of 1 to 60 characters' using errcode = '22023', hint = 'rack_name_invalid'; end if;
  if exists (select 1 from public.audit_racks where lower(btrim(name)) = lower(v_name) and id is distinct from p_id) then
    raise exception 'that rack already exists' using errcode = '23505', hint = 'rack_exists';
  end if;
  if p_id is null then
    insert into public.audit_racks (name, active, created_by) values (v_name, coalesce(p_active, true), auth.uid()) returning id into v_id;
    perform public.log_activity('audit.rack_saved', 'audit_racks', v_id::text, null, jsonb_build_object('name', v_name, 'created', true), null);
  else
    update public.audit_racks set name = v_name, active = coalesce(p_active, active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'rack not found' using errcode = '22023', hint = 'rack_not_found'; end if;
    perform public.log_activity('audit.rack_saved', 'audit_racks', v_id::text, null, jsonb_build_object('name', v_name, 'active', p_active), null);
  end if;
  return v_id;
end $$;

-- People the owner may give a rack to: active accounts, with whether they hold the logging key.
create function public.audit_expiry_people()
returns table (user_id uuid, full_name text, username text, can_log boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.audit_require('audit.expiry_manage');
  return query
    select pr.user_id, coalesce(s.full_name, pr.username), pr.username,
      (pr.role_template = 'admin'
       or ((exists (select 1 from public.role_permissions rp where rp.role = pr.role_template and rp.perm_key = 'audit.expiry_log')
            or exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = 'audit.expiry_log' and up.effect = 'grant'))
           and not exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = 'audit.expiry_log' and up.effect = 'deny')))
    from public.profiles pr left join public.staff s on s.id = pr.staff_id
    where pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now())
    order by 2, 3;
end $$;

-- Giving the same rack again in the same month replaces who has it. The person must be an active account.
create function public.audit_rack_assign(p_rack uuid, p_user uuid, p_month text)
returns uuid language plpgsql security definer set search_path = public as $$
declare k public.audit_racks; v_id uuid; v_name text;
begin
  perform public.audit_require('audit.expiry_manage');
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'choose a month' using errcode = '22023', hint = 'month_invalid'; end if;
  select * into k from public.audit_racks where id = p_rack;
  if not found then raise exception 'rack not found' using errcode = '22023', hint = 'rack_not_found'; end if;
  if not k.active then raise exception 'that rack is switched off' using errcode = '55000', hint = 'rack_inactive'; end if;
  if not public.audit_active_user(p_user) then raise exception 'that person cannot be given a rack' using errcode = '22023', hint = 'person_invalid'; end if;
  v_name := public.audit_person_name(p_user);
  insert into public.audit_rack_assignments (rack_id, rack_name, user_id, staff_name, month, assigned_by)
    values (p_rack, k.name, p_user, v_name, p_month, auth.uid())
    on conflict (rack_id, month) do update set user_id = excluded.user_id, staff_name = excluded.staff_name, rack_name = excluded.rack_name,
      assigned_by = excluded.assigned_by, assigned_at = now()
    returning id into v_id;
  perform public.log_activity('audit.rack_assigned', 'audit_rack_assignments', v_id::text, null,
    jsonb_build_object('rack', k.name, 'month', p_month, 'person', v_name), null);
  return v_id;
end $$;

create function public.audit_rack_unassign(p_assignment uuid) returns void language plpgsql security definer set search_path = public as $$
declare a public.audit_rack_assignments;
begin
  perform public.audit_require('audit.expiry_manage');
  delete from public.audit_rack_assignments where id = p_assignment returning * into a;
  if a.id is null then raise exception 'assignment not found' using errcode = '22023', hint = 'assignment_not_found'; end if;
  perform public.log_activity('audit.rack_unassigned', 'audit_rack_assignments', a.id::text, null,
    jsonb_build_object('rack', a.rack_name, 'month', a.month, 'person', a.staff_name), null);
end $$;

-- Racks, the assignments of one month, and the racks the caller may use this month: their own when they have any,
-- otherwise every active rack (the owner always sees every active rack).
create function public.audit_expiry_overview(p_month text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_month text := coalesce(p_month, public.audit_expiry_month(0)); v_mine text[];
begin
  perform public.audit_expiry_require_read();
  if v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'choose a month' using errcode = '22023', hint = 'month_invalid'; end if;
  select coalesce(array_agg(rack_name order by rack_name), '{}') into v_mine
    from public.audit_rack_assignments where month = v_month and user_id = auth.uid();
  return jsonb_build_object(
    'month', v_month,
    'racks', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'active', k.active) order by lower(k.name)), '[]'::jsonb) from public.audit_racks k),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'rack_id', a.rack_id, 'rack_name', a.rack_name, 'user_id', a.user_id,
        'staff_name', a.staff_name) order by lower(a.rack_name)), '[]'::jsonb) from public.audit_rack_assignments a where a.month = v_month),
    'my_racks', case when public.has_perm('audit.expiry_manage') or cardinality(v_mine) = 0
                     then (select coalesce(jsonb_agg(k.name order by lower(k.name)), '[]'::jsonb) from public.audit_racks k where k.active)
                     else to_jsonb(v_mine) end,
    'current_month', public.audit_expiry_month(0));
end $$;

-- ───────── 4. entries ─────────
-- Product search for the logging form. Narrow on purpose: people who only hold audit.expiry_log have no Inventory key.
create function public.audit_expiry_products(p_query text, p_limit int default 20)
returns table (id uuid, code text, name text, company text)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if not (public.has_perm('audit.expiry_log') or public.has_perm('audit.expiry_manage')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if length(v_q) < 2 then return; end if;
  v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.code, p.name, p.company from public.inventory_products p
    where p.name ilike v_q or p.code ilike v_q or p.generic ilike v_q
    order by p.name, p.code limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

create function public.audit_expiry_log(p_key uuid, p_product uuid, p_qty numeric, p_month text, p_rack text, p_status text default 'Near Expiry')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; pr public.inventory_products; v_rack text := btrim(coalesce(p_rack, '')); k public.audit_racks; v_mine text[];
begin
  if not (public.has_perm('audit.expiry_log') or public.has_perm('audit.expiry_manage')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_key is null then raise exception 'a key is required' using errcode = '22023', hint = 'key_required'; end if;
  select id into v_id from public.audit_expiry_entries where client_key = p_key and user_id = auth.uid();
  if v_id is not null then return v_id; end if;                                  -- a resend: same entry, nothing doubled
  if exists (select 1 from public.audit_expiry_entries where client_key = p_key) then
    raise exception 'that key belongs to someone else' using errcode = '23505', hint = 'key_taken';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then raise exception 'enter a quantity above zero' using errcode = '22023', hint = 'quantity_invalid'; end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_month < public.audit_expiry_month(-3) or p_month > public.audit_expiry_month(36) then
    raise exception 'choose an expiry month from 3 months ago to 3 years ahead' using errcode = '22023', hint = 'month_invalid';
  end if;
  if p_status is null or p_status not in ('Near Expiry', 'Sold', 'Returned to Warehouse', 'Discarded') then
    raise exception 'unknown status' using errcode = '22023', hint = 'status_invalid';
  end if;
  select * into pr from public.inventory_products where id = p_product;
  if not found then raise exception 'product not found' using errcode = '22023', hint = 'product_not_found'; end if;
  select * into k from public.audit_racks where lower(btrim(name)) = lower(v_rack) and active;
  if not found then raise exception 'choose one of the racks on the list' using errcode = '22023', hint = 'rack_invalid'; end if;
  if not public.has_perm('audit.expiry_manage') then
    select coalesce(array_agg(lower(rack_name)), '{}') into v_mine from public.audit_rack_assignments
      where month = public.audit_expiry_month(0) and user_id = auth.uid();
    if cardinality(v_mine) > 0 and not (lower(k.name) = any (v_mine)) then
      raise exception 'that rack is not yours this month' using errcode = '42501', hint = 'rack_not_yours';
    end if;
  end if;
  insert into public.audit_expiry_entries (client_key, user_id, staff_name, product_code, product_name, quantity, expiry_month, rack_location, status)
    values (p_key, auth.uid(), public.audit_person_name(auth.uid()), pr.code, pr.name, p_qty, p_month, k.name, p_status) returning id into v_id;
  perform public.log_activity('audit.expiry_logged', 'audit_expiry_entries', v_id::text, null,
    jsonb_build_object('product', pr.name, 'code', pr.code, 'qty', p_qty, 'month', p_month, 'rack', k.name, 'status', p_status), null);
  return v_id;
end $$;

create function public.audit_expiry_search(p_query text default null, p_month text default null, p_status text default null,
                                           p_limit int default 50, p_offset int default 0)
returns table (total bigint, id uuid, product_code text, product_name text, quantity numeric, expiry_month text, rack_location text, status text,
  locked boolean, staff_name text, logged_at timestamptz, reopened_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  perform public.audit_expiry_require_read();
  if v_q <> '' then v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;
  return query
    select count(*) over (), e.id, e.product_code, e.product_name, e.quantity, e.expiry_month, e.rack_location, e.status, e.locked, e.staff_name,
           e.logged_at, e.reopened_at
    from public.audit_expiry_entries e
    where (v_q = '' or e.product_name ilike v_q or e.product_code ilike v_q)
      and (nullif(p_month, '') is null or e.expiry_month = p_month)
      and (nullif(p_status, '') is null or e.status = p_status)
    order by e.expiry_month, e.logged_at desc, e.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Owner only: unlock, edit, delete.
create function public.audit_expiry_reopen(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare e public.audit_expiry_entries;
begin
  perform public.audit_require('audit.expiry_manage');
  select * into e from public.audit_expiry_entries where id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = '22023', hint = 'entry_not_found'; end if;
  if not e.locked then return; end if;
  update public.audit_expiry_entries set locked = false, reopened_by = auth.uid(), reopened_at = now() where id = p_id;
  perform public.log_activity('audit.expiry_reopened', 'audit_expiry_entries', p_id::text, null, jsonb_build_object('product', e.product_name), null);
end $$;

create function public.audit_expiry_update(p_id uuid, p_qty numeric, p_month text, p_rack text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.audit_expiry_entries; k public.audit_racks;
begin
  perform public.audit_require('audit.expiry_manage');
  select * into e from public.audit_expiry_entries where id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = '22023', hint = 'entry_not_found'; end if;
  if e.locked then raise exception 'reopen the entry first' using errcode = '55000', hint = 'entry_locked'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then raise exception 'enter a quantity above zero' using errcode = '22023', hint = 'quantity_invalid'; end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'choose a month' using errcode = '22023', hint = 'month_invalid'; end if;
  if p_status is null or p_status not in ('Near Expiry', 'Sold', 'Returned to Warehouse', 'Discarded') then
    raise exception 'unknown status' using errcode = '22023', hint = 'status_invalid';
  end if;
  select * into k from public.audit_racks where lower(btrim(name)) = lower(btrim(coalesce(p_rack, ''))) and (active or name = e.rack_location);
  if not found then raise exception 'choose one of the racks on the list' using errcode = '22023', hint = 'rack_invalid'; end if;
  update public.audit_expiry_entries set quantity = p_qty, expiry_month = p_month, rack_location = k.name, status = p_status,
    locked = true, updated_at = now() where id = p_id;
  perform public.log_activity('audit.expiry_edited', 'audit_expiry_entries', p_id::text,
    jsonb_build_object('qty', e.quantity, 'month', e.expiry_month, 'rack', e.rack_location, 'status', e.status),
    jsonb_build_object('qty', p_qty, 'month', p_month, 'rack', k.name, 'status', p_status), null);
end $$;

create function public.audit_expiry_delete(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare e public.audit_expiry_entries;
begin
  perform public.audit_require('audit.expiry_manage');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023', hint = 'reason_required'; end if;
  delete from public.audit_expiry_entries where id = p_id returning * into e;
  if e.id is null then raise exception 'entry not found' using errcode = '22023', hint = 'entry_not_found'; end if;
  perform public.log_activity('audit.expiry_deleted', 'audit_expiry_entries', p_id::text,
    jsonb_build_object('product', e.product_name, 'qty', e.quantity, 'month', e.expiry_month, 'rack', e.rack_location, 'status', e.status),
    null, left(btrim(p_reason), 500));
end $$;

-- ───────── 5. grants ─────────
revoke all on function public.audit_expiry_require_read(), public.audit_expiry_month(int) from public, anon, authenticated;
revoke all on function public.audit_rack_save(uuid, text, boolean), public.audit_expiry_people(), public.audit_rack_assign(uuid, uuid, text),
  public.audit_rack_unassign(uuid), public.audit_expiry_overview(text), public.audit_expiry_products(text, int),
  public.audit_expiry_log(uuid, uuid, numeric, text, text, text), public.audit_expiry_search(text, text, text, int, int),
  public.audit_expiry_reopen(uuid), public.audit_expiry_update(uuid, numeric, text, text, text), public.audit_expiry_delete(uuid, text)
  from public, anon, authenticated;
grant execute on function public.audit_rack_save(uuid, text, boolean), public.audit_expiry_people(), public.audit_rack_assign(uuid, uuid, text),
  public.audit_rack_unassign(uuid), public.audit_expiry_overview(text), public.audit_expiry_products(text, int),
  public.audit_expiry_log(uuid, uuid, numeric, text, text, text), public.audit_expiry_search(text, text, text, int, int),
  public.audit_expiry_reopen(uuid), public.audit_expiry_update(uuid, numeric, text, text, text), public.audit_expiry_delete(uuid, text)
  to authenticated;
