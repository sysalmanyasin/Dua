-- 0502 (STR): what the screens read.
--  - str_v_headers / str_v_lines: the live feed rows, plus archived STRs that are no longer in the feed. Views run with the
--    caller's rights (security_invoker), so they need `str.view`. Cost price is not in them.
--  - str_search_headers(): server-side search and paging, so an older STR is fetched only when asked for (STR-3, STR-8).
--    Every word typed must be found in the STR number, master id, ref no, comments, people, branches, OR in the code or name
--    of one of its products. `%` and `_` are plain text. At most 6 words, 50 rows per call.
--  - str_line_costs(): cost prices, only for people who hold both `str.view` and `inventory.view_cost` (STR-7).
create view public.str_v_headers with (security_invoker = true) as
select h.str_id, h.str_number, h.master_str_id, h.ref_no, h.media, h.str_status, h.str_date, h.issued_by,
  h.dispatched_date, h.dispatch_status, h.dispatched_by, h.receive_date, h.receive_status, h.received_by, h.comments,
  h.dispatch_branch, h.receive_branch, h.direction, h.no_of_boxes,
  public.str_stage(h.dispatch_status, h.receive_status) as stage,
  (select count(*) from public.str_line_items l where l.str_id = h.str_id)::int as line_count,
  true as in_feed
from public.str_headers h
union all
select a.str_id, a.str_number, a.master_str_id, a.ref_no, a.media, a.str_status, a.str_date, a.issued_by,
  a.dispatched_date, a.dispatch_status, a.dispatched_by, a.receive_date, a.receive_status, a.received_by, a.comments,
  a.dispatch_branch, a.receive_branch, a.direction, a.no_of_boxes,
  public.str_stage(a.dispatch_status, a.receive_status),
  (select count(*) from public.str_archive_lines l where l.str_id = a.str_id)::int,
  false
from public.str_archive_headers a
where not exists (select 1 from public.str_headers h where h.str_id = a.str_id);

create view public.str_v_lines with (security_invoker = true) as
select l.str_id, l.str_item_id, l.product_code, l.product_name, l.str_qty, l.dispatch_qty, l.receive_qty, l.product_price
from public.str_line_items l
union all
select a.str_id, a.str_item_id, a.product_code, a.product_name, a.str_qty, a.dispatch_qty, a.receive_qty, a.product_price
from public.str_archive_lines a
where not exists (select 1 from public.str_headers h where h.str_id = a.str_id);

revoke all on public.str_v_headers, public.str_v_lines from public, anon, authenticated;
grant select on public.str_v_headers, public.str_v_lines to authenticated, service_role;

create or replace function public.str_search_headers(
  p_text text default null, p_from date default null, p_to date default null,
  p_stage text default null, p_direction text default null,
  p_limit integer default 50, p_offset integer default 0)
returns setof public.str_v_headers
language plpgsql stable set search_path = public as $$
declare v_words text[]; v_limit int; v_offset int;
begin
  if not public.has_perm('str.view') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_stage is not null and p_stage not in ('awaited', 'dispatched', 'received') then
    raise exception 'unknown stage' using errcode = '22023';
  end if;
  if p_direction is not null and p_direction not in ('in', 'out') then
    raise exception 'unknown direction' using errcode = '22023';
  end if;
  v_words := (select coalesce(array_agg(w), array[]::text[]) from (
    select w from unnest(regexp_split_to_array(lower(btrim(left(coalesce(p_text, ''), 100))), '\s+')) w where w <> '' limit 6) s);
  v_limit := greatest(1, least(coalesce(p_limit, 50), 50));
  v_offset := greatest(0, least(coalesce(p_offset, 0), 10000));
  return query
    select v.* from public.str_v_headers v
    where (p_from is null or v.str_date >= p_from)
      and (p_to is null or v.str_date <= p_to)
      and (p_stage is null or v.stage = p_stage)
      and (p_direction is null or v.direction = p_direction)
      and not exists (
        select 1 from unnest(v_words) w
        where position(w in lower(concat_ws(E'\n', v.str_number, v.master_str_id, v.ref_no, v.comments, v.issued_by,
                v.dispatched_by, v.received_by, v.dispatch_branch, v.receive_branch))) = 0
          and not exists (select 1 from public.str_v_lines l
                where l.str_id = v.str_id and position(w in lower(l.product_code || ' ' || l.product_name)) > 0))
    order by v.str_date desc nulls last, v.str_id desc
    limit v_limit offset v_offset;
end $$;

create or replace function public.str_line_costs(p_str_ids bigint[])
returns table (str_id bigint, str_item_id integer, cost_price numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('str.view') and public.has_perm('inventory.view_cost')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_str_ids, 1), 0) > 100 then
    raise exception 'at most 100 STRs per call' using errcode = '22023';
  end if;
  return query
    select l.str_id, l.str_item_id, l.cost_price from public.str_line_items l where l.str_id = any (p_str_ids)
    union all
    select a.str_id, a.str_item_id, a.cost_price from public.str_archive_lines a
    where a.str_id = any (p_str_ids) and not exists (select 1 from public.str_headers h where h.str_id = a.str_id);
end $$;

revoke all on function public.str_search_headers(text, date, date, text, text, integer, integer),
  public.str_line_costs(bigint[]) from public, anon, authenticated;
grant execute on function public.str_search_headers(text, date, date, text, text, integer, integer),
  public.str_line_costs(bigint[]) to authenticated;
