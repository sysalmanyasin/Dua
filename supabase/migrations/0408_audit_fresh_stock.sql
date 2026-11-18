-- 0408_audit_fresh_stock — every new round starts from today's stock (the old app's "fresh cutoff"), and Individual Audit can start
-- from whole companies as well as from codes or a template.
--
-- Follow-up rounds (1A, 1B, ...) used to carry the earlier round's quantities and prices. They now read current stock from Inventory's
-- published interface, the same call a first round uses, and freeze it for that round's life:
--   * every item carried over takes the current system quantity, price and name, matched by company and code;
--     an item whose code no longer exists in Inventory keeps its earlier figures (a discontinued product is still worth confirming gone)
--   * 'company' mode also adds products that now exist in those companies but were not in the earlier round (marked is_new)
--   * 'spot' draws its sample from the earlier round, then takes current figures; it adds nothing new
--   * what the counter saw last time is kept as history: prev_variance and prev_counted, only for items that were really counted
-- Like creating a first round, this refuses with inventory_interface_missing until Inventory publishes the interface.

alter table public.audit_round_items
  add column is_new boolean not null default false,
  add column prev_counted numeric(12, 3);

-- ───────── follow-up rounds on fresh stock ─────────
create or replace function public.audit_round_next(p_key uuid, p_base_round uuid, p_mode text, p_sample int default null, p_seed text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.audit_rounds; v_id uuid; v_owner uuid; v_comp uuid; v_max text; v_suffix text; v_seed text; v_n int; v_status text;
        v_scope jsonb; v_codes text[]; v_companies text[];
begin
  perform public.audit_require('audit.compile');
  if p_key is null then raise exception 'a key is required' using errcode = '22023', hint = 'key_required'; end if;
  select id, created_by into v_id, v_owner from public.audit_rounds where idempotency_key = p_key;
  if found then
    if v_owner = auth.uid() then
      return jsonb_build_object('round_id', v_id, 'replay', true);
    end if;
    raise exception 'this key belongs to someone else' using errcode = '42501', hint = 'key_in_use';
  end if;
  if p_mode is null or p_mode not in ('differences', 'company', 'spot') then raise exception 'invalid mode' using errcode = '22023', hint = 'invalid_mode'; end if;
  if p_mode = 'spot' and (p_sample is null or p_sample < 1 or p_sample > 1000) then
    raise exception 'the sample size must be 1 to 1000' using errcode = '22023', hint = 'invalid_sample';
  end if;
  select * into b from public.audit_rounds where id = p_base_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if b.state <> 'compiled' then raise exception 'the round is not compiled' using errcode = '55000', hint = 'round_not_compiled'; end if;
  select status into v_status from public.audit_engagements where id = b.engagement_id;
  if v_status <> 'open' then raise exception 'the engagement is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;
  select id into v_comp from public.audit_compilations where round_id = p_base_round order by revision desc limit 1;

  select coalesce(max(round_suffix), '') into v_max from public.audit_rounds
    where engagement_id = b.engagement_id and round_number = b.round_number and round_suffix is not null;
  if v_max = 'Z' then raise exception 'no more lettered rounds' using errcode = '55000', hint = 'suffix_exhausted'; end if;
  v_suffix := case when v_max = '' then 'A' else chr(ascii(v_max) + 1) end;
  v_seed := case when p_mode = 'spot' then coalesce(nullif(btrim(p_seed), ''), md5(random()::text || clock_timestamp()::text)) end;

  -- which earlier rows are carried, and what to ask Inventory for
  drop table if exists pg_temp.audit_next_carry, pg_temp.audit_next_live; -- a second call in one transaction starts clean
  create temporary table audit_next_carry (round_item_id uuid primary key, position int, company text, code text, name text,
    system_qty numeric, retail_price numeric, counted_qty numeric, variance numeric, missing boolean);
  insert into audit_next_carry
    select cr.round_item_id, cr.position, cr.company, cr.code, cr.name, cr.system_qty, cr.retail_price, cr.counted_qty, cr.variance, cr.missing
    from public.audit_compiled_rows cr
    where cr.compilation_id = v_comp
      and case p_mode
            when 'differences' then cr.variance <> 0
            when 'company' then cr.company in (select x.company from public.audit_compiled_rows x where x.compilation_id = v_comp and x.variance <> 0)
            else cr.round_item_id in (select y.round_item_id from public.audit_compiled_rows y where y.compilation_id = v_comp
                                      order by md5(v_seed || y.round_item_id::text) limit p_sample)
          end;
  if not exists (select 1 from audit_next_carry) then raise exception 'there is nothing to count again' using errcode = '22023', hint = 'no_items'; end if;

  if p_mode = 'company' then
    select array_agg(distinct company) into v_companies from audit_next_carry;
    v_scope := jsonb_build_object('type', 'selected', 'companies', to_jsonb(v_companies), 'codes', '[]'::jsonb);
  else
    select coalesce(array_agg(distinct code), '{}') into v_codes from audit_next_carry where code <> '';
    v_scope := jsonb_build_object('type', 'template', 'companies', '[]'::jsonb, 'codes', to_jsonb(v_codes));
  end if;

  -- today's stock, once, through the same door a first round uses (raises inventory_interface_missing if it is not there)
  create temporary table audit_next_live (company text, code text, name text, qty numeric, price numeric);
  insert into audit_next_live
    select coalesce(nullif(btrim(p.company), ''), 'Unassigned Manufacturer'), coalesce(btrim(p.code), ''), coalesce(p.name, ''),
           coalesce(p.qty, 0), greatest(round(coalesce(p.price, 0), 2), 0)
    from public.audit_scope_products(v_scope) p;

  insert into public.audit_rounds (engagement_id, round_number, round_suffix, unit, base_round_id, created_by, idempotency_key, next_mode, spot_seed, spot_size)
    values (b.engagement_id, b.round_number, v_suffix, b.unit, p_base_round, auth.uid(), p_key, p_mode, v_seed, case when p_mode = 'spot' then p_sample end)
    returning id into v_id;

  insert into public.audit_round_items (round_id, engagement_id, position, code, company, name, system_qty, retail_price,
      prev_variance, prev_counted, source_item_id, is_new)
    select v_id, b.engagement_id, row_number() over (order by s.company, s.code, s.name, s.position), s.code, s.company, s.name,
           s.system_qty, s.retail_price, s.prev_variance, s.prev_counted, s.source_item_id, s.is_new
    from (
      select c.company, c.code, coalesce(nullif(l.name, ''), c.name) as name, c.position,
             coalesce(l.qty, c.system_qty) as system_qty, coalesce(l.price, c.retail_price) as retail_price,
             case when not c.missing then c.variance end as prev_variance,
             case when not c.missing then c.counted_qty end as prev_counted,
             c.round_item_id as source_item_id, false as is_new
      from audit_next_carry c
      left join lateral (select x.name, x.qty, x.price from audit_next_live x where x.company = c.company and x.code = c.code and c.code <> ''
                         order by x.qty desc limit 1) l on true
      union all
      select x.company, x.code, x.name, 2147483647, x.qty, x.price, null, null, null, true
      from audit_next_live x
      where p_mode = 'company' and x.code <> ''
        and not exists (select 1 from public.audit_compiled_rows k where k.compilation_id = v_comp and k.company = x.company and k.code = x.code)
    ) s;
  get diagnostics v_n = row_count;
  if v_n > 20000 then raise exception 'too many items' using errcode = '22023', hint = 'too_many_items'; end if;

  drop table pg_temp.audit_next_carry, pg_temp.audit_next_live;
  perform public.log_activity('audit.round_next', 'audit_rounds', v_id::text, null,
    jsonb_build_object('base', p_base_round, 'mode', p_mode, 'suffix', v_suffix, 'items', v_n, 'seed', v_seed,
      'new_items', (select count(*) from public.audit_round_items where round_id = v_id and is_new)), null);
  return jsonb_build_object('round_id', v_id, 'round_number', b.round_number, 'round_suffix', v_suffix, 'items', v_n,
    'new_items', (select count(*) from public.audit_round_items where round_id = v_id and is_new), 'seed', v_seed, 'replay', false);
end $$;

-- ───────── Individual Audit: companies as well as codes or a template ─────────
-- Choose one: a template, typed codes, or whole companies (every product they have today), as in the old app.
-- If more than one is given the order of preference is template, codes, companies.
drop function public.audit_individual_start(uuid, text[], uuid);
create function public.audit_individual_start(p_key uuid, p_codes text[] default '{}', p_template uuid default null, p_companies text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month text; v_eng public.audit_engagements; v_codes text[]; v_comps text[]; v_tname text; v_round uuid; v_owner uuid; v_asg uuid; v_num int; v_n int;
        v_scope jsonb; v_requested int;
begin
  perform public.audit_require('audit.individual');
  perform public.audit_require('audit.count');
  if p_key is null then raise exception 'a key is required' using errcode = '22023', hint = 'key_required'; end if;

  select r.id, r.created_by into v_round, v_owner from public.audit_rounds r where r.idempotency_key = p_key;
  if found then
    if v_owner <> auth.uid() then raise exception 'this key belongs to someone else' using errcode = '42501', hint = 'key_in_use'; end if;
    select a.id into v_asg from public.audit_assignments a where a.round_id = v_round and a.auditor_id = auth.uid() and a.status <> 'revoked';
    return jsonb_build_object('round_id', v_round, 'assignment_id', v_asg, 'replay', true);
  end if;

  if exists (select 1 from public.audit_assignments a where a.auditor_id = auth.uid() and a.method = 'individual-self-pick'
             and a.status in ('assigned', 'counting')) then
    raise exception 'you already have an Individual Audit open' using errcode = '55000', hint = 'self_pick_open';
  end if;

  v_comps := coalesce((select array_agg(c order by c) from (select distinct btrim(x) c from unnest(coalesce(p_companies, '{}')) x where btrim(x) <> '') s), '{}');
  if p_template is not null then
    select t.codes, t.name into v_codes, v_tname from public.audit_templates t where t.id = p_template;
    if not found then raise exception 'template not found' using errcode = '22023', hint = 'template_not_found'; end if;
  else
    v_codes := coalesce((select array_agg(c order by c) from (select distinct btrim(x) c from unnest(coalesce(p_codes, '{}')) x where btrim(x) <> '') s), '{}');
  end if;

  if cardinality(v_codes) > 0 then
    if cardinality(v_codes) > 500 then raise exception 'too many products for one Individual Audit' using errcode = '22023', hint = 'too_many_codes'; end if;
    v_requested := cardinality(v_codes);
  elsif cardinality(v_comps) > 0 then
    if cardinality(v_comps) > 20 then raise exception 'too many companies for one Individual Audit' using errcode = '22023', hint = 'too_many_companies'; end if;
    v_requested := null;
  else
    raise exception 'choose at least one product' using errcode = '22023', hint = 'invalid_codes';
  end if;
  v_tname := case when p_template is not null then v_tname end;

  v_month := to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM');
  select * into v_eng from public.audit_engagements where scope_type = 'individual' and scope_month = v_month for update;
  if not found then
    begin
      insert into public.audit_engagements (name, scope_type, scope_month, counting_method, created_by, idempotency_key)
      values ('Individual audits ' || v_month, 'individual', v_month, 'manual', auth.uid(), gen_random_uuid());
    exception when unique_violation then null;
    end;
    select * into v_eng from public.audit_engagements where scope_type = 'individual' and scope_month = v_month for update;
  end if;
  if v_eng.status <> 'open' then raise exception 'the engagement is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;

  insert into public.audit_members (engagement_id, user_id, role, added_by) values (v_eng.id, auth.uid(), 'counter', auth.uid())
  on conflict (engagement_id, user_id) do nothing;

  select coalesce(max(round_number), 0) + 1 into v_num from public.audit_rounds where engagement_id = v_eng.id and round_suffix is null;
  insert into public.audit_rounds (engagement_id, round_number, unit, created_by, idempotency_key)
  values (v_eng.id, v_num, 'item', auth.uid(), p_key) returning id into v_round;

  v_scope := case when cardinality(v_codes) > 0
    then jsonb_build_object('type', 'template', 'companies', '[]'::jsonb, 'codes', to_jsonb(v_codes), 'month', v_month)
    else jsonb_build_object('type', 'selected', 'companies', to_jsonb(v_comps), 'codes', '[]'::jsonb, 'month', v_month) end;
  insert into public.audit_round_items (round_id, engagement_id, position, code, company, name, system_qty, retail_price)
  select v_round, v_eng.id, row_number() over (order by s.company, s.code, s.name), s.code, s.company, s.name, s.qty, s.price
  from (
    select coalesce(btrim(p.code), '') as code, coalesce(nullif(btrim(p.company), ''), 'Unassigned Manufacturer') as company,
           coalesce(p.name, '') as name, coalesce(p.qty, 0) as qty, greatest(round(coalesce(p.price, 0), 2), 0) as price
    from public.audit_scope_products(v_scope) p
  ) s;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'none of those products were found' using errcode = '22023', hint = 'no_items'; end if;
  if v_n > 5000 then raise exception 'too many items' using errcode = '22023', hint = 'too_many_items'; end if;

  begin
    insert into public.audit_assignments (round_id, engagement_id, auditor_id, method, template_name, created_by)
    values (v_round, v_eng.id, auth.uid(), 'individual-self-pick', v_tname, auth.uid()) returning id into v_asg;
  exception when unique_violation then
    raise exception 'you already have an Individual Audit open' using errcode = '55000', hint = 'self_pick_open';
  end;
  insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
  select v_asg, v_round, v_eng.id, i.id from public.audit_round_items i where i.round_id = v_round;

  update public.audit_rounds set state = 'locked', locked_at = now(), version = version + 1 where id = v_round;
  update public.audit_rounds set state = 'counting', version = version + 1 where id = v_round;

  perform public.log_activity('audit.individual_started', 'audit_rounds', v_round::text, null,
    jsonb_build_object('engagement', v_eng.id, 'items', v_n, 'requested', v_requested, 'template', v_tname,
      'companies', case when cardinality(v_codes) = 0 then to_jsonb(v_comps) end), null);
  return jsonb_build_object('round_id', v_round, 'assignment_id', v_asg, 'engagement_id', v_eng.id, 'items', v_n,
    'requested', v_requested, 'replay', false);
end $$;

-- ───────── what a counter sees: last round's result and new products ─────────
drop function public.audit_my_items(uuid, int, int);
create function public.audit_my_items(p_assignment uuid, p_after int default 0, p_limit int default 500)
returns table (round_item_id uuid, item_position int, code text, company text, name text, system_qty numeric, retail_price numeric,
               counted_qty numeric, auto_matched boolean, note text, confirmed_same boolean,
               prev_variance numeric, prev_counted numeric, is_new boolean)
language plpgsql stable security definer set search_path = public as $$
declare a public.audit_assignments;
begin
  perform public.audit_require('audit.count');
  select * into a from public.audit_assignments x where x.id = p_assignment;
  if not found or a.auditor_id <> auth.uid() or a.status = 'revoked' then
    raise exception 'assignment not found' using errcode = '42501', hint = 'not_allowed';
  end if;
  return query
    select ri.id, ri.position, ri.code, ri.company, ri.name, ri.system_qty, ri.retail_price,
           l.qty, coalesce(l.auto_matched, false), coalesce(l.note, ''), coalesce(l.confirmed_same, false),
           ri.prev_variance, ri.prev_counted, ri.is_new
    from public.audit_assignment_items ai
    join public.audit_round_items ri on ri.id = ai.round_item_id
    left join lateral (select e.qty, e.auto_matched, e.note, e.confirmed_same from public.audit_count_events e
                       where e.assignment_id = p_assignment and e.round_item_id = ri.id order by e.seq desc limit 1) l on true
    where ai.assignment_id = p_assignment and ri.position > greatest(coalesce(p_after, 0), 0)
    order by ri.position
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;

revoke all on function public.audit_round_next(uuid, uuid, text, int, text), public.audit_individual_start(uuid, text[], uuid, text[]),
  public.audit_my_items(uuid, int, int) from public, anon, authenticated;
grant execute on function public.audit_round_next(uuid, uuid, text, int, text), public.audit_individual_start(uuid, text[], uuid, text[]),
  public.audit_my_items(uuid, int, int) to authenticated;
