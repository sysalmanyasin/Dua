-- 0419_audit_live_balances — the live system quantity, read only, for the correction form and the correction list.
--  * audit_live_balances(p_round, p_codes) returns today's quantity from Inventory for products that are in that round.
--    It is for people who can suggest or review a correction. It cannot be used to look up products outside the round.
--  * The round keeps its own frozen quantity (what the counters were shown); this is only a view of the stock right now,
--    so a reviewer can see whether stock has moved since the count. Nothing is written, no table or policy is touched.
--  * `active` is false for a product the Inventory feed no longer lists; its quantity is then the last one seen, not a live one.
create function public.audit_live_balances(p_round uuid, p_codes text[])
returns table (code text, qty numeric, active boolean, found boolean)
language plpgsql stable security definer set search_path = public as $$
declare r public.audit_rounds;
begin
  if not (public.has_perm('audit.suggest') or public.has_perm('audit.review') or public.has_perm('audit.manage')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_view(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if coalesce(cardinality(p_codes), 0) > 200 then
    raise exception 'too many codes' using errcode = '22023', hint = 'too_many_codes';
  end if;
  return query
    select c.code, p.qty, coalesce(p.active, false), (p.id is not null)
    from (select distinct btrim(x) as code from unnest(coalesce(p_codes, '{}')) x where btrim(x) <> '') c
    left join lateral (select ip.id, ip.qty, ip.active from public.inventory_products ip
                       where ip.code = c.code order by ip.active desc, ip.id limit 1) p on true
    where exists (select 1 from public.audit_round_items ri where ri.round_id = p_round and ri.code = c.code)
    order by c.code;
end $$;

revoke all on function public.audit_live_balances(uuid, text[]) from public, anon, authenticated;
grant execute on function public.audit_live_balances(uuid, text[]) to authenticated;
