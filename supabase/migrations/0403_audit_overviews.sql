-- 0403_audit_overviews — Audit slice A4: read functions that give the screens names and counts in one call.
-- The browser cannot read other people's names from `profiles` (row-level security), and counting items per assignment
-- from thousands of rows in the browser would be slow. Each function checks who is asking and returns only ids, names
-- and counts. Nothing here writes.

-- People the owner may pick as counters: active accounts, with whether they currently hold the counting permission.
create function public.audit_people()
returns table (user_id uuid, full_name text, username text, role_template text, can_count boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('audit.manage') or public.has_perm('audit.assign')) then
    raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed';
  end if;
  return query
    select pr.user_id, coalesce(s.full_name, pr.username), pr.username, pr.role_template,
      (pr.role_template = 'admin'
       or ((exists (select 1 from public.role_permissions rp where rp.role = pr.role_template and rp.perm_key = 'audit.count')
            or exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = 'audit.count' and up.effect = 'grant'))
           and not exists (select 1 from public.user_permissions up where up.user_id = pr.user_id and up.perm_key = 'audit.count' and up.effect = 'deny')))
    from public.profiles pr
    left join public.staff s on s.id = pr.staff_id
    where pr.disabled_at is null and (pr.expires_at is null or pr.expires_at > now())
    order by 2, 3;
end $$;

-- One audit: its facts, its members with names, and its rounds with item and assignment counts.
create function public.audit_engagement_overview(p_engagement uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e public.audit_engagements;
begin
  select * into e from public.audit_engagements where id = p_engagement;
  if not found then raise exception 'audit not found' using errcode = '22023', hint = 'engagement_not_found'; end if;
  if not public.audit_can_view(p_engagement) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  return jsonb_build_object(
    'engagement', jsonb_build_object('id', e.id, 'name', e.name, 'scope_type', e.scope_type, 'scope_companies', to_jsonb(e.scope_companies),
      'scope_month', e.scope_month, 'counting_method', e.counting_method, 'status', e.status),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(s.full_name, pr.username), 'role', m.role)
                  order by coalesce(s.full_name, pr.username)), '[]'::jsonb)
                from public.audit_members m
                join public.profiles pr on pr.user_id = m.user_id
                left join public.staff s on s.id = pr.staff_id
                where m.engagement_id = p_engagement),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'round_number', r.round_number, 'round_suffix', r.round_suffix,
                  'unit', r.unit, 'state', r.state, 'version', r.version,
                  'items', (select count(*) from public.audit_round_items i where i.round_id = r.id),
                  'assignments', (select count(*) from public.audit_assignments a where a.round_id = r.id and a.status <> 'revoked'))
                  order by r.round_number, coalesce(r.round_suffix, '')), '[]'::jsonb)
               from public.audit_rounds r where r.engagement_id = p_engagement));
end $$;

-- One round: its state and version, who has which part, and how much of each company is still unassigned.
create function public.audit_round_overview(p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.audit_rounds;
begin
  select * into r from public.audit_rounds where id = p_round;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  if not public.audit_can_view(r.engagement_id) then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  return jsonb_build_object(
    'round', jsonb_build_object('id', r.id, 'engagement_id', r.engagement_id, 'round_number', r.round_number,
      'round_suffix', r.round_suffix, 'unit', r.unit, 'state', r.state, 'version', r.version,
      'items', (select count(*) from public.audit_round_items i where i.round_id = r.id)),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'auditor_id', a.auditor_id,
                      'name', coalesce(s.full_name, pr.username), 'status', a.status,
                      'items', (select count(*) from public.audit_assignment_items ai where ai.assignment_id = a.id),
                      'companies', (select count(distinct ri.company) from public.audit_assignment_items ai
                                    join public.audit_round_items ri on ri.id = ai.round_item_id where ai.assignment_id = a.id))
                      order by coalesce(s.full_name, pr.username), a.id), '[]'::jsonb)
                    from public.audit_assignments a
                    join public.profiles pr on pr.user_id = a.auditor_id
                    left join public.staff s on s.id = pr.staff_id
                    where a.round_id = p_round and a.status <> 'revoked'),
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('company', c.company, 'items', c.items, 'unassigned', c.unassigned)
                    order by c.company), '[]'::jsonb)
                  from (select ri.company, count(*) as items,
                               count(*) filter (where not exists (select 1 from public.audit_assignment_items ai where ai.round_item_id = ri.id)) as unassigned
                        from public.audit_round_items ri where ri.round_id = p_round group by ri.company) c));
end $$;

revoke all on function public.audit_people(), public.audit_engagement_overview(uuid), public.audit_round_overview(uuid)
  from public, anon, authenticated;
grant execute on function public.audit_people(), public.audit_engagement_overview(uuid), public.audit_round_overview(uuid) to authenticated;
