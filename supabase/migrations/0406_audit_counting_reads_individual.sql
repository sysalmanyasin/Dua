-- 0406_audit_counting_reads_individual — Audit slice A5: what a counter reads, templates, and the Individual Audit.
-- Counters never read the item tables directly (row-level security hides them). Two read functions give a counter exactly their own
-- assignments and their own items, with the latest count on each (AUD-4: no blind counting; AUD-5: they see system qty and retail price).
-- Individual Audit: one rolling engagement per month (R8); every self-pick is a round of its own, locked and started in one step,
-- and one person can have only one open self-pick at a time.

-- ───────── 1. templates (codes only; resolved against current stock when loaded, R12) ─────────
create table public.audit_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  codes text[] not null check (cardinality(codes) between 1 and 5000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.audit_templates enable row level security;
create unique index audit_templates_name on public.audit_templates (lower(btrim(name)));
create trigger audit_templates_updated before update on public.audit_templates
  for each row execute function public.set_updated_at();

create policy audit_templates_read on public.audit_templates for select to authenticated
  using ((select public.has_perm('audit.templates')) or (select public.has_perm('audit.individual')));
grant select on public.audit_templates to authenticated;

-- p_id null makes a new template; otherwise it replaces name and codes of that template.
create function public.audit_template_save(p_id uuid, p_name text, p_codes text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_codes text[]; v_id uuid;
begin
  perform public.audit_require('audit.templates');
  v_codes := coalesce((select array_agg(c order by c) from (select distinct btrim(x) c from unnest(coalesce(p_codes, '{}')) x where btrim(x) <> '') s), '{}');
  if cardinality(v_codes) < 1 or cardinality(v_codes) > 5000 then
    raise exception 'a template needs between 1 and 5000 codes' using errcode = '22023', hint = 'invalid_template';
  end if;
  if p_name is null or length(btrim(p_name)) < 2 or length(btrim(p_name)) > 80 then
    raise exception 'a template needs a name of 2 to 80 letters' using errcode = '22023', hint = 'invalid_template';
  end if;
  begin
    if p_id is null then
      insert into public.audit_templates (name, codes, created_by) values (btrim(p_name), v_codes, auth.uid()) returning id into v_id;
    else
      update public.audit_templates set name = btrim(p_name), codes = v_codes where id = p_id returning id into v_id;
      if v_id is null then raise exception 'template not found' using errcode = '22023', hint = 'template_not_found'; end if;
    end if;
  exception when unique_violation then
    raise exception 'a template with that name exists' using errcode = '23505', hint = 'template_name_taken';
  end;
  perform public.log_activity(case when p_id is null then 'audit.template_created' else 'audit.template_changed' end,
    'audit_templates', v_id::text, null, jsonb_build_object('codes', cardinality(v_codes)), null);
  return v_id;
end $$;

create function public.audit_template_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  perform public.audit_require('audit.templates');
  delete from public.audit_templates where id = p_id returning name into v_name;
  if v_name is null then raise exception 'template not found' using errcode = '22023', hint = 'template_not_found'; end if;
  perform public.log_activity('audit.template_deleted', 'audit_templates', p_id::text, jsonb_build_object('name', v_name), null, null);
end $$;

-- ───────── 2. what a counter reads ─────────
-- The person's own live assignments, newest first, with how many items they have and how many they have counted so far.
create function public.audit_my_assignments()
returns table (assignment_id uuid, engagement_id uuid, engagement_name text, round_id uuid, round_number int, round_suffix text,
               round_state text, status text, method text, template_name text, items int, counted int, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.audit_require('audit.count');
  return query
    select a.id, a.engagement_id, e.name, a.round_id, r.round_number, r.round_suffix, r.state, a.status, a.method, a.template_name,
           (select count(*)::int from public.audit_assignment_items ai where ai.assignment_id = a.id),
           (select count(distinct ev.round_item_id)::int from public.audit_count_events ev where ev.assignment_id = a.id),
           a.created_at
    from public.audit_assignments a
    join public.audit_rounds r on r.id = a.round_id
    join public.audit_engagements e on e.id = a.engagement_id
    where a.auditor_id = auth.uid() and a.status <> 'revoked'
    order by a.created_at desc, a.id
    limit 200;
end $$;

-- One page of the person's own items, in round order, after position p_after. The latest count rides along.
-- Pages (at most 1000) keep each answer under the API row limit; the screen asks again until a page comes back short.
create function public.audit_my_items(p_assignment uuid, p_after int default 0, p_limit int default 500)
returns table (round_item_id uuid, item_position int, code text, company text, name text, system_qty numeric, retail_price numeric,
               counted_qty numeric, auto_matched boolean, note text, confirmed_same boolean)
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
           l.qty, coalesce(l.auto_matched, false), coalesce(l.note, ''), coalesce(l.confirmed_same, false)
    from public.audit_assignment_items ai
    join public.audit_round_items ri on ri.id = ai.round_item_id
    left join lateral (select e.qty, e.auto_matched, e.note, e.confirmed_same from public.audit_count_events e
                       where e.assignment_id = p_assignment and e.round_item_id = ri.id order by e.seq desc limit 1) l on true
    where ai.assignment_id = p_assignment and ri.position > greatest(coalesce(p_after, 0), 0)
    order by ri.position
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;

-- ───────── 3. Individual Audit ─────────
-- Starts a self-pick: the person's own list of product codes (typed in, or from a template), counted by them alone.
-- Safe to repeat with the same key. Stock comes from Inventory's published interface; until it exists this refuses with
-- inventory_interface_missing, the same as creating a round.
create function public.audit_individual_start(p_key uuid, p_codes text[] default '{}', p_template uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month text; v_eng public.audit_engagements; v_codes text[]; v_tname text; v_round uuid; v_owner uuid; v_asg uuid; v_num int; v_n int;
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

  if p_template is not null then
    select t.codes, t.name into v_codes, v_tname from public.audit_templates t where t.id = p_template;
    if not found then raise exception 'template not found' using errcode = '22023', hint = 'template_not_found'; end if;
  else
    v_codes := coalesce((select array_agg(c order by c) from (select distinct btrim(x) c from unnest(coalesce(p_codes, '{}')) x where btrim(x) <> '') s), '{}');
  end if;
  if cardinality(v_codes) < 1 then raise exception 'choose at least one product' using errcode = '22023', hint = 'invalid_codes'; end if;
  if cardinality(v_codes) > 500 then raise exception 'too many products for one Individual Audit' using errcode = '22023', hint = 'too_many_codes'; end if;

  -- the pharmacy's own calendar month (Asia/Karachi), so a count at 1 a.m. on the 1st belongs to the new month
  v_month := to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM');
  select * into v_eng from public.audit_engagements where scope_type = 'individual' and scope_month = v_month for update;
  if not found then
    begin
      insert into public.audit_engagements (name, scope_type, scope_month, counting_method, created_by, idempotency_key)
      values ('Individual audits ' || v_month, 'individual', v_month, 'manual', auth.uid(), gen_random_uuid());
    exception when unique_violation then null; -- another person created it a moment ago
    end;
    select * into v_eng from public.audit_engagements where scope_type = 'individual' and scope_month = v_month for update;
  end if;
  if v_eng.status <> 'open' then raise exception 'the engagement is not open' using errcode = '55000', hint = 'engagement_not_open'; end if;

  insert into public.audit_members (engagement_id, user_id, role, added_by) values (v_eng.id, auth.uid(), 'counter', auth.uid())
  on conflict (engagement_id, user_id) do nothing;

  select coalesce(max(round_number), 0) + 1 into v_num from public.audit_rounds where engagement_id = v_eng.id and round_suffix is null;
  insert into public.audit_rounds (engagement_id, round_number, unit, created_by, idempotency_key)
  values (v_eng.id, v_num, 'item', auth.uid(), p_key) returning id into v_round;

  insert into public.audit_round_items (round_id, engagement_id, position, code, company, name, system_qty, retail_price)
  select v_round, v_eng.id, row_number() over (order by s.company, s.code, s.name), s.code, s.company, s.name, s.qty, s.price
  from (
    select coalesce(btrim(p.code), '') as code, coalesce(nullif(btrim(p.company), ''), 'Unassigned Manufacturer') as company,
           coalesce(p.name, '') as name, coalesce(p.qty, 0) as qty, greatest(round(coalesce(p.price, 0), 2), 0) as price
    from public.audit_scope_products(jsonb_build_object('type', 'template', 'companies', '[]'::jsonb, 'codes', to_jsonb(v_codes), 'month', v_month)) p
  ) s;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'none of those products were found' using errcode = '22023', hint = 'no_items'; end if;

  begin
    insert into public.audit_assignments (round_id, engagement_id, auditor_id, method, template_name, created_by)
    values (v_round, v_eng.id, auth.uid(), 'individual-self-pick', v_tname, auth.uid()) returning id into v_asg;
  exception when unique_violation then
    raise exception 'you already have an Individual Audit open' using errcode = '55000', hint = 'self_pick_open';
  end;
  insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
  select v_asg, v_round, v_eng.id, i.id from public.audit_round_items i where i.round_id = v_round;

  -- a self-pick has nothing to split or lock by hand: it goes straight to counting
  update public.audit_rounds set state = 'locked', locked_at = now(), version = version + 1 where id = v_round;
  update public.audit_rounds set state = 'counting', version = version + 1 where id = v_round;

  perform public.log_activity('audit.individual_started', 'audit_rounds', v_round::text, null,
    jsonb_build_object('engagement', v_eng.id, 'items', v_n, 'requested', cardinality(v_codes), 'template', v_tname), null);
  return jsonb_build_object('round_id', v_round, 'assignment_id', v_asg, 'engagement_id', v_eng.id, 'items', v_n,
    'requested', cardinality(v_codes), 'replay', false);
end $$;

revoke all on function public.audit_template_save(uuid, text, text[]), public.audit_template_delete(uuid), public.audit_my_assignments(),
  public.audit_my_items(uuid, int, int), public.audit_individual_start(uuid, text[], uuid) from public, anon, authenticated;
grant execute on function public.audit_template_save(uuid, text, text[]), public.audit_template_delete(uuid), public.audit_my_assignments(),
  public.audit_my_items(uuid, int, int), public.audit_individual_start(uuid, text[], uuid) to authenticated;
