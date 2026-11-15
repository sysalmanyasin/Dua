-- 0306_inventory_reports.sql — Inventory module, slice I-C/I-D.
-- 1. inventory_in_transit(): units already on their way to this branch, for the Reorder Report (approved by the owner,
--    13 Nov 2026). Returns codes and whole packs only, for people who hold inventory.view but not the STR permission.
-- 2. The Excess Working's shared state: the "retain" list of product names and the misc / head-office amounts. In the old
--    app these were synced between devices; they are business facts, not a person's setting, so they live here, not in
--    a person's preferences. Readable and changeable only with inventory.view.
-- 3. inventory_cover_summary(): the four Home numbers computed inside the database (no product data sent to the phone).
--    Definitions are in js/modules/inventory/domain/cover.js and the tests prove the two agree with the old app.
-- Nothing here is applied to the live project until the owner has said so.

-- ───────── 1. units in transit ─────────
-- Lines of transfers that come INTO this branch, are dispatched and not yet received. Whole packs per line, using the
-- product's pack size (1 when the product is unknown). Packs only, so a line of loose units adds nothing.
create or replace function public.inventory_in_transit(p_limit integer default 2000)
returns table (code text, packs integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('inventory.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select l.product_code,
           sum(floor(coalesce(l.dispatch_qty, 0) / (case when p.conversion_factor > 0 then p.conversion_factor else 1 end)))::integer
    from public.str_line_items l
    join public.str_headers h on h.str_id = l.str_id
    left join public.inventory_products p on p.code = l.product_code and p.active
    where h.direction = 'in' and h.dispatch_status = 'Dispatched' and coalesce(h.receive_status, '') <> 'Received'
    group by l.product_code
    having sum(floor(coalesce(l.dispatch_qty, 0) / (case when p.conversion_factor > 0 then p.conversion_factor else 1 end))) > 0
    order by l.product_code
    limit greatest(1, least(coalesce(p_limit, 2000), 5000));
end $$;

-- ───────── 2. shared Excess Working state ─────────
create table public.inventory_excess_retained (
  name_key text primary key check (name_key = lower(btrim(name_key)) and length(name_key) between 1 and 200),
  name     text not null check (length(name) between 1 and 200),
  added_by uuid,
  added_at timestamptz not null default now()
);
alter table public.inventory_excess_retained enable row level security;
create policy inv_excess_retained_read on public.inventory_excess_retained for select to authenticated
  using ((select public.has_perm('inventory.view')));
revoke all on public.inventory_excess_retained from public, anon, authenticated;
grant select on public.inventory_excess_retained to authenticated;
grant all on public.inventory_excess_retained to service_role;

create table public.inventory_excess_settings (
  id         integer primary key default 1 check (id = 1),
  misc       numeric not null default 0 check (misc >= 0),
  ho_value   numeric check (ho_value is null or ho_value >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.inventory_excess_settings enable row level security;
create policy inv_excess_settings_read on public.inventory_excess_settings for select to authenticated
  using ((select public.has_perm('inventory.view')));
revoke all on public.inventory_excess_settings from public, anon, authenticated;
grant select on public.inventory_excess_settings to authenticated;
grant all on public.inventory_excess_settings to service_role;
insert into public.inventory_excess_settings (id) values (1) on conflict (id) do nothing;

-- Add or remove one retained name. The key is the lower-case trimmed name (so "Panadol" and " panadol " are one name).
create or replace function public.inventory_excess_retain_set(p_name text, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_key text := lower(btrim(coalesce(p_name, '')));
begin
  if not public.has_perm('inventory.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if length(v_name) < 1 or length(v_name) > 200 then raise exception 'a name is 1 to 200 characters' using errcode = '22023'; end if;
  if coalesce(p_on, true) then
    if (select count(*) from public.inventory_excess_retained) >= 2000 and not exists (select 1 from public.inventory_excess_retained where name_key = v_key) then
      raise exception 'at most 2000 retained names' using errcode = '22023';
    end if;
    insert into public.inventory_excess_retained (name_key, name, added_by) values (v_key, v_name, auth.uid()) on conflict (name_key) do nothing;
  else
    delete from public.inventory_excess_retained where name_key = v_key;
  end if;
end $$;

-- The two amounts that adjust the Excess total: misc (subtracted) and the head-office stock value (for the variance line).
create or replace function public.inventory_excess_settings_set(p_misc numeric, p_ho_value numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('inventory.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_misc, 0) < 0 or coalesce(p_misc, 0) > 1e12 then raise exception 'misc must be between 0 and 1,000,000,000,000' using errcode = '22023'; end if;
  if p_ho_value is not null and (p_ho_value < 0 or p_ho_value > 1e13) then raise exception 'head-office value is out of range' using errcode = '22023'; end if;
  update public.inventory_excess_settings set misc = coalesce(p_misc, 0), ho_value = p_ho_value, updated_by = auth.uid(), updated_at = now() where id = 1;
end $$;

-- ───────── 3. the four Home numbers ─────────
-- Same rules as js/modules/inventory/domain/cover.js (and, through it, the old app). Computed in double precision in the
-- same order of operations as the JavaScript so the two agree to the last digit; money is rounded to 2 decimals at the end.
--   stockValue  qty x price where qty > 0
--   reorder     sold in the last 60 days (today excluded) and under 30 days of cover; value = whole units to reach 30 days x price
--   notSold     whole packs only, 60 days: Never Sold (no sale date, received over 60 days ago) + Dead Stock (last sale and last
--               receipt both over 60 days ago); a product whose pack size the feed marks unusable is excluded
--   excess      sold in 90 days, over 100 days of that rate, at least 4 units, then at least 90 days old (or no creation date)
--               and at least 200 days of cover; value = units above the 100-day target x price
create or replace function public.inventory_cover_summary(p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.has_perm('inventory.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  select jsonb_build_object(
    'asOf', p_now,
    'window', jsonb_build_object('reorderDays', 60, 'coverDays', 30, 'notSoldDays', 60),
    'stockValue', round(coalesce(sum(case when q.qty > 0 then q.qty * q.price end), 0)::numeric, 2),
    'reorder', jsonb_build_object('count', count(*) filter (where q.is_reorder),
                                  'value', round(coalesce(sum(q.reorder_units * q.price) filter (where q.is_reorder), 0)::numeric, 2)),
    'notSold', jsonb_build_object('count', count(*) filter (where q.never or q.dead),
                                  'value', round(coalesce(sum(q.whole_qty * q.price) filter (where q.never or q.dead), 0)::numeric, 2)),
    'excess', jsonb_build_object('count', count(*) filter (where q.is_excess),
                                 'value', round(coalesce(sum(q.excess_qty * q.price) filter (where q.is_excess), 0)::numeric, 2))
  ) into v
  from (
    select s.qty, s.price, s.whole_qty, s.excess_qty,
      (s.n60 > 0 and s.qty / (s.n60 / 60) < 30) as is_reorder,
      case when s.n60 > 0 then greatest(0, ceil((s.n60 / 60) * 30 - s.qty)) else 0 end as reorder_units,
      (s.pack is not null and s.whole_qty > 0 and s.sold is null and s.rec_days is not null and s.rec_days > 60) as never,
      (s.pack is not null and s.whole_qty > 0 and s.sold is not null and s.sale_days > 60 and s.rec_days is not null and s.rec_days > 60) as dead,
      (s.n90 > 0 and s.excess_qty > 0 and s.qty >= 4 and (s.age_days is null or s.age_days >= 90) and s.qty / (s.n90 / 90) >= 200) as is_excess
    from (
      select p.qty::float8 as qty, p.price::float8 as price, p.net_qty_60_days::float8 as n60, p.net_qty_90_days::float8 as n90, p.last_sale_date as sold,
        case when p.pack_valid and p.conversion_factor > 0 then p.conversion_factor::float8 end as pack,
        case when p.pack_valid and p.conversion_factor > 0 then floor(p.qty::float8 / p.conversion_factor::float8) * p.conversion_factor::float8 else 0 end as whole_qty,
        p.qty::float8 - ((p.net_qty_90_days::float8 / 90) * 100) as excess_qty,
        floor(extract(epoch from (p_now - (p.last_receive_date::timestamp at time zone 'UTC'))) / 86400) as rec_days,
        floor(extract(epoch from (p_now - (p.last_sale_date::timestamp at time zone 'UTC'))) / 86400) as sale_days,
        floor(extract(epoch from (p_now - (p.creation_date::timestamp at time zone 'UTC'))) / 86400) as age_days
      from public.inventory_products p
      where p.active
    ) s
  ) q;
  return v;
end $$;

revoke all on function public.inventory_in_transit(integer), public.inventory_excess_retain_set(text, boolean),
  public.inventory_excess_settings_set(numeric, numeric), public.inventory_cover_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.inventory_in_transit(integer), public.inventory_excess_retain_set(text, boolean),
  public.inventory_excess_settings_set(numeric, numeric), public.inventory_cover_summary(timestamptz) to authenticated;
