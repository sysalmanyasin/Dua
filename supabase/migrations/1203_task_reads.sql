-- 1203_task_reads: what the screens read. Every function checks who is asking and returns only what that person may see
-- (null when not allowed, so a screen can simply hide itself). Counts and dates are worked out here, once, so every screen agrees.
--   overdue = a deadline before today (Pakistan time) on work that has not been handed in (created, assigned, accepted, in progress, returned).
--   Work that is submitted or being verified is waiting for someone else, so it is not overdue.

create function public.task_card(t public.task_items) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'instructions', t.instructions, 'evidence_rule', t.evidence_rule, 'priority', t.priority, 'status', t.status,
    'source', t.source, 'assignee_id', t.assignee_staff_id, 'assignee_name', (select full_name from public.staff where id = t.assignee_staff_id),
    'start_on', t.start_on, 'due_on', t.due_on,
    'overdue', (t.due_on is not null and t.due_on < public.task_today() and t.status in ('created', 'assigned', 'accepted', 'in_progress', 'returned')),
    'accepted_at', t.accepted_at, 'submitted_at', t.submitted_at, 'completed_at', t.completed_at, 'cancelled_reason', t.cancelled_reason,
    'version', t.version, 'created_at', t.created_at,
    'pending_request', (select r.kind from public.task_change_requests r where r.task_id = t.id and r.status = 'pending')) $$;

-- The person's own tasks, in the order the brief asks for: overdue; urgent; deadline within two days; other pending work;
-- returned for correction; then work waiting on someone else's verification. scope 'done' = completed in the last 30 days.
create function public.task_list_mine(p_scope text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.task_my_staff(); today date := public.task_today();
begin
  if not public.has_perm('tasks.view_own') or me is null then return null; end if;
  if p_scope not in ('open', 'done') then raise exception 'scope must be open or done' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(public.task_card(x.t) || jsonb_build_object('rank', x.rank) order by x.rank, (x.t).due_on nulls last, (x.t).created_at)
    from (select t, case
            when t.status = 'completed' then 7
            when t.due_on < today and t.status in ('assigned', 'accepted', 'in_progress', 'returned') then 1
            when t.priority = 'urgent' and t.status in ('assigned', 'accepted', 'in_progress') then 2
            when t.due_on <= today + 2 and t.status in ('assigned', 'accepted', 'in_progress') then 3
            when t.status in ('assigned', 'accepted', 'in_progress') then 4
            when t.status = 'returned' then 5
            else 6 end as rank
            from public.task_items t
           where t.assignee_staff_id = me
             and ((p_scope = 'open' and t.status in ('assigned', 'accepted', 'in_progress', 'returned', 'submitted', 'in_verification'))
               or (p_scope = 'done' and t.status = 'completed' and t.completed_at >= now() - interval '30 days'))
           limit 200) x), '[]'::jsonb);
end $$;

create function public.task_snapshot_mine() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.task_my_staff(); today date := public.task_today();
begin
  if not public.has_perm('tasks.view_own') or me is null then return null; end if;
  return (select jsonb_build_object(
    'assigned', count(*) filter (where status in ('assigned', 'accepted', 'in_progress', 'returned', 'submitted', 'in_verification')),
    'pending', count(*) filter (where status in ('assigned', 'accepted', 'in_progress')),
    'overdue', count(*) filter (where due_on < today and status in ('assigned', 'accepted', 'in_progress', 'returned')),
    'completed', count(*) filter (where status = 'completed' and completed_at >= now() - interval '30 days'),
    'awaiting_verification', count(*) filter (where status in ('submitted', 'in_verification')),
    'returned', count(*) filter (where status = 'returned'),
    'upcoming', count(*) filter (where due_on between today and today + 2 and status in ('assigned', 'accepted', 'in_progress', 'returned')),
    'completed_days', 30)
    from public.task_items where assignee_staff_id = me);
end $$;

-- Owner: every task, optionally narrowed by status or person.
create function public.task_list_all(p_status text default null, p_assignee uuid default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('tasks.manage') then return null; end if;
  if p_status is not null and p_status not in ('created', 'assigned', 'accepted', 'in_progress', 'submitted', 'in_verification', 'completed', 'returned', 'cancelled') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(public.task_card(x) order by (x.due_on < public.task_today() and x.status in ('created', 'assigned', 'accepted', 'in_progress', 'returned')) desc,
                    x.due_on nulls last, x.created_at desc)
    from (select * from public.task_items t where (p_status is null or t.status = p_status) and (p_assignee is null or t.assignee_staff_id = p_assignee)
           order by t.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 500))) x), '[]'::jsonb);
end $$;

-- A named verifier's queue: other people's submissions waiting for a decision (never their own).
create function public.task_verification_queue() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.task_can_verify() then return null; end if;
  return coalesce((select jsonb_agg(public.task_card(t) || jsonb_build_object('submitted_note', s.note, 'submitted_tick', s.tick, 'submission', s.n, 'verifier_is_me', t.verifier_user = auth.uid())
                    order by t.submitted_at)
    from public.task_items t
    join lateral (select * from public.task_submissions x where x.task_id = t.id order by x.n desc limit 1) s on true
   where t.status in ('submitted', 'in_verification') and t.submitted_by is distinct from auth.uid()), '[]'::jsonb);
end $$;

-- One task with its full history. null when the caller may not open it (the same answer as "no such task").
create function public.task_get(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.task_can_see(p_task) then return null; end if;
  select * into t from public.task_items where id = p_task;
  return jsonb_build_object(
    'task', public.task_card(t),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'from', e.from_status, 'to', e.to_status, 'by', coalesce(sf.full_name, 'System'), 'detail', e.detail) order by e.id)
        from public.task_events e left join public.profiles pr on pr.user_id = e.actor_user left join public.staff sf on sf.id = pr.staff_id where e.task_id = p_task), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('at', c.created_at, 'by', coalesce(sf.full_name, 'Unknown'), 'mine', c.author_user = auth.uid(), 'body', c.body) order by c.id)
        from public.task_comments c left join public.profiles pr on pr.user_id = c.author_user left join public.staff sf on sf.id = pr.staff_id where c.task_id = p_task), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('n', s.n, 'at', s.submitted_at, 'note', s.note, 'tick', s.tick, 'decision', s.decision, 'decided_at', s.decided_at,
        'decision_comment', s.decision_comment, 'decided_by', (select sf.full_name from public.profiles pr join public.staff sf on sf.id = pr.staff_id where pr.user_id = s.decided_by)) order by s.n)
        from public.task_submissions s where s.task_id = p_task), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'reason', r.reason, 'proposed_due_on', r.proposed_due_on, 'status', r.status,
        'requested_at', r.requested_at, 'decision_note', r.decision_note) order by r.requested_at) from public.task_change_requests r where r.task_id = p_task), '[]'::jsonb),
    'can', jsonb_build_object(
      'manage', public.has_perm('tasks.manage'),
      'is_assignee', t.assignee_staff_id is not null and t.assignee_staff_id = public.task_my_staff(),
      'verify', public.task_can_verify() and t.submitted_by is distinct from auth.uid() and t.status in ('submitted', 'in_verification')));
end $$;

create function public.task_change_requests_pending() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('tasks.manage') then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'task_id', t.id, 'task_title', t.title, 'kind', r.kind, 'reason', r.reason, 'proposed_due_on', r.proposed_due_on,
      'current_due_on', t.due_on, 'requested_at', r.requested_at, 'requested_by_name', (select sf.full_name from public.profiles pr join public.staff sf on sf.id = pr.staff_id where pr.user_id = r.requested_by))
      order by r.requested_at)
    from public.task_change_requests r join public.task_items t on t.id = r.task_id where r.status = 'pending'), '[]'::jsonb);
end $$;

-- Owner: each person's workload and a fair completion rate for 7, 30 or 90 complete days ending yesterday.
--   Rate = tasks completed and verified on or before their deadline / tasks that were due in the period for that person.
--   Left out: cancelled tasks, tasks with no one assigned, and tasks created after their own deadline.
--   Attendance is not part of this yet (it waits for the Android app).
create function public.task_team_overview(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := public.task_today(); f date; t date;
begin
  if not public.has_perm('tasks.manage') then return null; end if;
  if p_days is null or p_days not in (7, 30, 90) then raise exception 'period must be 7, 30 or 90 days' using errcode = '22023'; end if;
  f := today - p_days; t := today - 1;
  return jsonb_build_object('days', p_days, 'from', f, 'to', t, 'staff', coalesce((
    select jsonb_agg(row order by row ->> 'name') from (
      select jsonb_build_object('staff_id', s.id, 'name', s.full_name,
        'assigned_open', count(i.*) filter (where i.status in ('assigned', 'accepted', 'in_progress', 'returned', 'submitted', 'in_verification')),
        'overdue', count(i.*) filter (where i.due_on < today and i.status in ('assigned', 'accepted', 'in_progress', 'returned')),
        'verification_pending', count(i.*) filter (where i.status in ('submitted', 'in_verification')),
        'returned', count(i.*) filter (where i.status = 'returned'),
        'completed', count(i.*) filter (where i.status = 'completed' and (i.completed_at at time zone 'Asia/Karachi')::date between f and t),
        'rate_due', count(i.*) filter (where i.status <> 'cancelled' and i.due_on between f and t and (i.created_at at time zone 'Asia/Karachi')::date <= i.due_on),
        'rate_on_time', count(i.*) filter (where i.status = 'completed' and i.due_on between f and t and (i.created_at at time zone 'Asia/Karachi')::date <= i.due_on
                                             and (i.completed_at at time zone 'Asia/Karachi')::date <= i.due_on)) as row
        from public.staff s left join public.task_items i on i.assignee_staff_id = s.id
       where public.task_staff_has_login(s.id) or exists (select 1 from public.task_items x where x.assignee_staff_id = s.id)
       group by s.id, s.full_name) q), '[]'::jsonb));
end $$;

revoke all on function public.task_card(public.task_items), public.task_list_mine(text), public.task_snapshot_mine(), public.task_list_all(text, uuid, integer),
  public.task_verification_queue(), public.task_get(uuid), public.task_change_requests_pending(), public.task_team_overview(integer) from public, anon, authenticated;
grant execute on function public.task_list_mine(text), public.task_snapshot_mine(), public.task_list_all(text, uuid, integer), public.task_verification_queue(),
  public.task_get(uuid), public.task_change_requests_pending(), public.task_team_overview(integer) to authenticated;
