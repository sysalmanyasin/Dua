-- 0211_closing_audit: Session E. The Inventory Audit card (brief C3, CLS-8). Nothing here changes how a closing is calculated.
--   * seeds the 31 audit codes of the old app (js/inventory-audit.js) into closing_audit_items, with real names from inventory when it has them
--   * closing_audit_preview(): reads the CURRENT stock of the active audit codes through inventory_balances, returns only the non-zero ones
--     (a negative balance counts), the codes inventory does not know, when the feed last checked ("data as of"), and a digest of what was shown
--   * closing_audit_verify(key, digest): freezes that list inside the DRAFT closing (who, when, data as of, the non-zero items, the codes not found).
--     The server reads the stock again itself and refuses with audit_changed if it no longer matches the digest the person looked at, so what is
--     frozen is always exactly what was confirmed. A verified audit cannot be redone on the same draft; a reopened revision keeps what the
--     original had (0202 / 0203 already copy it). The opening closing has no audit step.
--   The existing submit gate (audit_not_verified) is unchanged: with closing.require_inventory_audit on, submit needs the frozen audit.
insert into public.closing_audit_items (code, name, sort)
select v.code, v.code, v.ord::int from unnest(array['894301', '894302', '894303', '894304', '894305', '894306', '894307', '894308', '894309', '894310', '894311', '894312', '894313', '894314', '894315', '894316', '894317', '894318', '894320', '894321', '894322', '894323', '894324', '894325', '894326', '894328', '894330', '894331', '894332', '894333', '894334']) with ordinality as v(code, ord)
on conflict (code) do nothing;
update public.closing_audit_items a set name = p.name
from (select distinct on (code) code, name from public.inventory_products order by code, id) p
where p.code = a.code and a.name = a.code;

create function public.closing_audit_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_codes text[]; v_items jsonb; v_nf jsonb; v_asof timestamptz;
begin
  if not (public.has_perm('closing.enter_own') or public.has_perm('closing.correct')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if not public.has_perm('inventory.search') then
    raise exception 'inventory not allowed' using errcode = '42501', hint = 'inventory_not_allowed'; end if;
  select array_agg(i.code order by i.sort, i.code) into v_codes from public.closing_audit_items i where i.active;
  if v_codes is null then raise exception 'no audit codes' using errcode = '22023', hint = 'no_audit_codes'; end if;
  with b as (
    select x.code, x.name, x.qty, x.found, o.ord
    from public.inventory_balances(v_codes) x join unnest(v_codes) with ordinality as o(code, ord) on o.code = x.code)
  select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'qty', b.qty) order by b.ord) filter (where b.found and b.qty <> 0), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(b.code) order by b.ord) filter (where not b.found), '[]'::jsonb)
  into v_items, v_nf from b;
  select s.synced_at into v_asof from public.inventory_latest_sync() s;
  return jsonb_build_object('items', v_items, 'not_found', v_nf, 'codes_checked', array_length(v_codes, 1), 'data_as_of', v_asof,
                            'fetched_at', now(), 'digest', md5(v_items::text || '|' || v_nf::text));
end $$;

create function public.closing_audit_verify(p_key uuid, p_digest text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.closings; p jsonb; v_staff uuid;
begin
  select * into c from public.closings where idempotency_key = p_key and status = 'draft';
  if not found or not (public.has_perm('closing.correct') or (c.entered_by = auth.uid() and public.has_perm('closing.enter_own'))) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  if c.is_opening then raise exception 'the opening closing has no audit' using errcode = '22023', hint = 'audit_not_needed'; end if;
  if exists (select 1 from public.closing_inventory_audit a where a.closing_id = c.id) then
    raise exception 'already verified' using errcode = '22023', hint = 'audit_already_verified'; end if;
  p := public.closing_audit_preview();
  if p ->> 'digest' is distinct from p_digest then raise exception 'stock changed' using errcode = '22023', hint = 'audit_changed'; end if;
  select staff_id into v_staff from public.profiles where user_id = auth.uid();
  insert into public.closing_inventory_audit (closing_id, verified_at, verified_by, data_as_of, codes_checked, not_found)
  values (c.id, now(), v_staff, nullif(p ->> 'data_as_of', '')::timestamptz, (p ->> 'codes_checked')::int,
          coalesce(array(select jsonb_array_elements_text(p -> 'not_found')), '{}'::text[]));
  insert into public.closing_inventory_audit_items (closing_id, item_code, item_name, qty)
  select c.id, e ->> 'code', coalesce(e ->> 'name', ''), (e ->> 'qty')::numeric from jsonb_array_elements(p -> 'items') e;
  perform public.log_activity('closing.audit_verified', 'closing', c.id::text, null,
    jsonb_build_object('items', jsonb_array_length(p -> 'items'), 'codes_checked', p -> 'codes_checked'), null);
  return (p - 'digest') || jsonb_build_object('verified_at', now());
end $$;

revoke all on function public.closing_audit_preview(), public.closing_audit_verify(uuid, text) from public, anon, authenticated;
grant execute on function public.closing_audit_preview(), public.closing_audit_verify(uuid, text) to authenticated;
