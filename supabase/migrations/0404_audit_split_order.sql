-- 0404_audit_split_order — makes the auto-split order independent of the database's language setting.
-- Companies with the same number of items are taken in plain character order (collate "C"), so the preview the browser
-- shows (domain/split.js) and the split the database makes can never disagree. Same function as 0401 otherwise.
create or replace function public.audit_assign_auto(p_round uuid, p_auditors uuid[], p_split text default 'company', p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.audit_rounds; v_aud uuid[]; v_asg uuid[]; v_loads numeric[]; v_n int; j int; best int; g record; v_item uuid; v_new uuid; v_ver int; v_summary jsonb;
begin
  perform public.audit_require('audit.assign');
  select * into r from public.audit_rounds where id = p_round for update;
  if not found then raise exception 'round not found' using errcode = '22023', hint = 'round_not_found'; end if;
  perform public.audit_check_version(r.version, p_expected_version);
  if r.state <> 'draft' then raise exception 'the round is locked' using errcode = '55000', hint = 'round_not_draft'; end if;
  if p_split not in ('company', 'volume') then raise exception 'invalid split' using errcode = '22023', hint = 'invalid_split'; end if;

  select coalesce(array_agg(u order by o), '{}') into v_aud
  from (select u, min(o) o from unnest(coalesce(p_auditors, '{}')) with ordinality t(u, o) where u is not null group by u) s;
  v_n := cardinality(v_aud);
  if v_n < 1 or v_n > 50 then raise exception 'choose between 1 and 50 auditors' using errcode = '22023', hint = 'invalid_auditors'; end if;
  for j in 1 .. v_n loop
    if not public.audit_active_user(v_aud[j]) then
      raise exception 'an auditor is not active' using errcode = '22023', hint = 'auditor_unavailable';
    end if;
  end loop;

  delete from public.audit_assignment_items where round_id = p_round;
  delete from public.audit_assignments where round_id = p_round;
  v_asg := '{}';
  v_loads := array_fill(0::numeric, array[v_n]);
  for j in 1 .. v_n loop
    insert into public.audit_assignments (round_id, engagement_id, auditor_id, method, created_by)
    values (p_round, r.engagement_id, v_aud[j], 'auto-' || p_split, auth.uid()) returning id into v_new;
    v_asg := v_asg || v_new;
  end loop;

  for g in
    select company, array_agg(id order by position) as ids, count(*) as n_items
    from public.audit_round_items where round_id = p_round group by company order by count(*) desc, company collate "C"
  loop
    if r.unit = 'item' then
      foreach v_item in array g.ids loop
        best := 1;
        for j in 2 .. v_n loop if v_loads[j] < v_loads[best] then best := j; end if; end loop;
        insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
        values (v_asg[best], p_round, r.engagement_id, v_item);
        v_loads[best] := v_loads[best] + 1;
      end loop;
    else
      best := 1;
      for j in 2 .. v_n loop if v_loads[j] < v_loads[best] then best := j; end if; end loop;
      insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
      select v_asg[best], p_round, r.engagement_id, x from unnest(g.ids) x;
      v_loads[best] := v_loads[best] + case when p_split = 'company' then 1 else g.n_items end;
    end if;
  end loop;

  delete from public.audit_assignments a where a.round_id = p_round
    and not exists (select 1 from public.audit_assignment_items i where i.assignment_id = a.id);
  update public.audit_rounds set version = version + 1 where id = p_round returning version into v_ver;

  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', a.id, 'auditor_id', a.auditor_id,
           'items', (select count(*) from public.audit_assignment_items i where i.assignment_id = a.id),
           'companies', (select count(distinct ri.company) from public.audit_assignment_items i
                         join public.audit_round_items ri on ri.id = i.round_item_id where i.assignment_id = a.id))
         order by a.created_at, a.id), '[]') into v_summary
  from public.audit_assignments a where a.round_id = p_round;
  perform public.log_activity('audit.assigned_auto', 'audit_rounds', p_round::text, null,
    jsonb_build_object('split', p_split, 'auditors', v_n), null);
  return jsonb_build_object('version', v_ver, 'assignments', v_summary);
end $$;

revoke all on function public.audit_assign_auto(uuid, uuid[], text, int) from public, anon, authenticated;
grant execute on function public.audit_assign_auto(uuid, uuid[], text, int) to authenticated;
