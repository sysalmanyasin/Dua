-- 0414_audit_product_history — one product across audit rounds (F6 / P4).
--  * audit_product_history(p_query, p_limit): every compiled or final round that holds a product whose code starts with, or whose
--    name contains, the search text. One row per round and line, newest first. Read only.
--  * Who may call it: audit.view, audit.review or audit.report. Rows come only from engagements whose results the caller may see
--    (audit_can_see_results: administrators see all, others only engagements they are a member of).
--  * A final round answers from its frozen final lines (final quantity); a compiled round from its latest compilation.
--  * Empty search text returns nothing. The limit is kept between 1 and 200.

create function public.audit_product_history(p_query text, p_limit int default 50)
returns table (engagement_id uuid, engagement_name text, round_id uuid, round_label text, state text, at timestamptz,
               code text, name text, company text, system_qty numeric, counted_qty numeric, variance numeric,
               variance_value numeric, not_counted boolean, assumed_to_match boolean, corrected boolean, total bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_term text := btrim(coalesce(p_query, '')); v_esc text;
begin
  if not (public.has_perm('audit.view') or public.has_perm('audit.review') or public.has_perm('audit.report')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_term = '' then return; end if;
  v_esc := replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  with seen as (
    select r.id as rid, r.engagement_id as eid, e.name as ename, r.round_number, r.round_suffix, r.state as rstate,
           case when r.state = 'final' then coalesce(r.finalized_at, r.compiled_at) else r.compiled_at end as rat
    from public.audit_rounds r
    join public.audit_engagements e on e.id = r.engagement_id
    where r.state in ('compiled', 'final') and public.audit_can_see_results(r.engagement_id)
  ), hits as (
    select s.*, l.code as l_code, l.name as l_name, l.company as l_company, l.system_qty as l_sys, l.counted_qty as l_cnt,
           l.variance as l_var, l.variance_value as l_val, l.missing as l_missing, l.auto_matched as l_auto, false as l_corr, l.position as pos
    from seen s
    join public.audit_finals f on f.round_id = s.rid
    join public.audit_final_lines l on l.final_id = f.id
    where s.rstate = 'final'
      and (lower(l.code) like lower(v_esc) || '%' escape '\' or lower(l.name) like '%' || lower(v_esc) || '%' escape '\')
    union all
    select s.*, c.code, c.name, c.company, c.system_qty, c.counted_qty, c.variance, c.variance_value, c.missing, c.auto_matched,
           c.corrected_by is not null, c.position
    from seen s
    join lateral (select k.id from public.audit_compilations k where k.round_id = s.rid order by k.revision desc limit 1) lc on true
    join public.audit_compiled_rows c on c.compilation_id = lc.id
    where s.rstate = 'compiled'
      and (lower(c.code) like lower(v_esc) || '%' escape '\' or lower(c.name) like '%' || lower(v_esc) || '%' escape '\')
  )
  select h.eid, h.ename, h.rid, public.audit_round_label(h.round_number, h.round_suffix), h.rstate, h.rat,
         h.l_code, h.l_name, h.l_company, h.l_sys, h.l_cnt, h.l_var, h.l_val, h.l_missing, h.l_auto, h.l_corr, count(*) over ()
  from hits h
  order by h.rat desc nulls last, h.rid, h.pos
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

revoke all on function public.audit_product_history(text, int) from public, anon, authenticated;
grant execute on function public.audit_product_history(text, int) to authenticated;
