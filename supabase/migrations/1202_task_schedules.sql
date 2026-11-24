-- 1202_task_schedules: recurring tasks. The Owner enters a schedule and creating it approves it (D-56); each cycle then
-- creates its task automatically. One cycle can only ever create one task: the key (schedule, cycle) is unique, so a retry,
-- a double run or "Generate now" cannot produce a duplicate. The daily job and the manual button run the same function.

-- Pure rule: is p_date a generation date for this rule, and if so what is the cycle, its first day and its deadline?
--   daily      every day                            cycle = the date
--   weekly     the chosen ISO weekdays (1 = Mon)    cycle = the date
--   monthly    the chosen day, clamped to month end cycle = 'YYYY-MM'
--   nth_week   the Nth block of seven days of the month (week 3 = days 15-21, week 5 = day 29 to month end), one task for the
--              whole block, created on any day inside it if not yet made, due on its last day      cycle = 'YYYY-MM-W<n>'
-- A fifth week does not exist in a month shorter than 29 days: no task that month.
create function public.task_cycle(p_kind text, p_weekdays integer[], p_month_day integer, p_week integer, p_date date)
returns table (cycle_key text, start_on date, due_on date)
language plpgsql immutable set search_path = public as $$
declare mstart date := date_trunc('month', p_date)::date; mend date := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
        wstart date; wend date; day_ int;
begin
  if p_kind = 'daily' then
    return query select p_date::text, p_date, p_date;
  elsif p_kind = 'weekly' then
    if extract(isodow from p_date)::int = any (coalesce(p_weekdays, array[]::int[])) then return query select p_date::text, p_date, p_date; end if;
  elsif p_kind = 'monthly' then
    day_ := least(p_month_day, extract(day from mend)::int);
    if extract(day from p_date)::int = day_ then return query select to_char(p_date, 'YYYY-MM'), p_date, p_date; end if;
  elsif p_kind = 'nth_week' then
    wstart := mstart + (p_week - 1) * 7;
    if wstart > mend then return; end if;
    wend := least(mstart + p_week * 7 - 1, mend);
    if p_week = 5 then wend := mend; end if;
    if p_date between wstart and wend then return query select to_char(p_date, 'YYYY-MM') || '-W' || p_week, wstart, wend; end if;
  end if;
end $$;

-- Creates the tasks due on p_date. Internal: the daily job (pg_cron, 00:05 Pakistan time) and task_generate_now() call it.
create function public.task_generate_due(p_date date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, public.task_today()); s record; c record; made integer := 0; tid uuid; assignee uuid;
begin
  for s in select sc.id as sid, sc.kind, sc.weekdays, sc.month_day, sc.week_of_month, sc.approved_by, df.id as did, df.title, df.instructions,
                  df.evidence_rule, df.priority, df.default_assignee_staff_id
             from public.task_schedules sc join public.task_defs df on df.id = sc.def_id
            where sc.active and df.active loop
    for c in select * from public.task_cycle(s.kind, s.weekdays, s.month_day, s.week_of_month, d) loop
      assignee := case when s.default_assignee_staff_id is not null and public.task_staff_has_login(s.default_assignee_staff_id) then s.default_assignee_staff_id end;
      insert into public.task_items (title, instructions, evidence_rule, priority, status, source, def_id, schedule_id, cycle_key, created_by, assignee_staff_id, start_on, due_on)
      values (s.title, s.instructions, s.evidence_rule, s.priority, case when assignee is null then 'created' else 'assigned' end, 'schedule', s.did, s.sid, c.cycle_key, s.approved_by, assignee, c.start_on, c.due_on)
      on conflict (schedule_id, cycle_key) do nothing
      returning id into tid;
      if tid is not null then
        made := made + 1;
        insert into public.task_events (task_id, actor_user, kind, from_status, to_status, detail)
        values (tid, null, 'created', null, 'created', jsonb_build_object('source', 'schedule', 'cycle', c.cycle_key, 'due_on', c.due_on));
        if assignee is not null then
          insert into public.task_events (task_id, actor_user, kind, from_status, to_status, detail)
          values (tid, null, 'assigned', 'created', 'assigned', jsonb_build_object('assignee', assignee, 'source', 'schedule'));
        end if;
        tid := null;
      end if;
    end loop;
  end loop;
  return made;
end $$;

-- The Owner's "Generate now" button.
create function public.task_generate_now() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  n := public.task_generate_due(null);
  perform public.log_activity('task.generated', 'task_schedules', null, null, jsonb_build_object('tasks_made', n), null);
  return n;
end $$;

-- The Owner creates a schedule (and approves it by doing so).
create function public.task_schedule_create(p_title text, p_instructions text, p_evidence text, p_priority text, p_assignee uuid,
                                            p_kind text, p_weekdays integer[], p_month_day integer, p_week integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare did uuid; sid uuid;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_title is null or length(trim(p_title)) not between 3 and 120 then raise exception 'the title must be 3 to 120 characters' using errcode = '22023'; end if;
  if coalesce(p_evidence, 'none') not in ('none', 'note', 'tick') then raise exception 'evidence must be none, note or tick' using errcode = '22023'; end if;
  if coalesce(p_priority, 'normal') not in ('normal', 'urgent') then raise exception 'priority must be normal or urgent' using errcode = '22023'; end if;
  if p_kind not in ('daily', 'weekly', 'monthly', 'nth_week') then raise exception 'choose daily, weekly, monthly or a week of the month' using errcode = '22023'; end if;
  if p_kind = 'weekly' and (p_weekdays is null or cardinality(p_weekdays) not between 1 and 7 or not p_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]) then raise exception 'choose the weekdays' using errcode = '22023'; end if;
  if p_kind = 'monthly' and (p_month_day is null or p_month_day not between 1 and 31) then raise exception 'choose a day of the month (1 to 31)' using errcode = '22023'; end if;
  if p_kind = 'nth_week' and (p_week is null or p_week not between 1 and 5) then raise exception 'choose a week of the month (1 to 5)' using errcode = '22023'; end if;
  if p_assignee is not null and not public.task_staff_has_login(p_assignee) then raise exception 'that person cannot be given tasks (no working login)' using errcode = '22023'; end if;
  insert into public.task_defs (title, instructions, evidence_rule, priority, default_assignee_staff_id, created_by)
  values (trim(p_title), coalesce(p_instructions, ''), coalesce(p_evidence, 'none'), coalesce(p_priority, 'normal'), p_assignee, auth.uid()) returning task_defs.id into did;
  insert into public.task_schedules (def_id, kind, weekdays, month_day, week_of_month, approved_by)
  values (did, p_kind, case when p_kind = 'weekly' then p_weekdays end, case when p_kind = 'monthly' then p_month_day end, case when p_kind = 'nth_week' then p_week end, auth.uid())
  returning task_schedules.id into sid;
  perform public.log_activity('task.schedule_created', 'task_schedules', sid::text, null, jsonb_build_object('title', trim(p_title), 'kind', p_kind, 'weekdays', p_weekdays, 'month_day', p_month_day, 'week', p_week), null);
  return sid;
end $$;

create function public.task_schedule_set_active(p_schedule uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare was boolean;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_active is null then raise exception 'active must be true or false' using errcode = '22023'; end if;
  select active into was from public.task_schedules where id = p_schedule for update;
  if not found then raise exception 'unknown schedule' using errcode = '22023'; end if;
  if was = p_active then return; end if;
  update public.task_schedules set active = p_active, updated_at = now() where id = p_schedule;
  perform public.log_activity('task.schedule_changed', 'task_schedules', p_schedule::text, jsonb_build_object('active', was), jsonb_build_object('active', p_active), null);
end $$;

create function public.task_schedule_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('tasks.manage') then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', d.title, 'instructions', d.instructions, 'evidence_rule', d.evidence_rule, 'priority', d.priority,
      'assignee', d.default_assignee_staff_id, 'assignee_name', st.full_name, 'kind', s.kind, 'weekdays', s.weekdays, 'month_day', s.month_day,
      'week_of_month', s.week_of_month, 'active', s.active, 'approved_at', s.approved_at) order by s.active desc, d.title)
    from public.task_schedules s join public.task_defs d on d.id = s.def_id left join public.staff st on st.id = d.default_assignee_staff_id), '[]'::jsonb);
end $$;

-- The daily job, only where pg_cron exists (same guarded pattern as 0011). 00:05 Pakistan time = 19:05 UTC.
do $cron$
begin
  if to_regclass('cron.job') is null then raise notice 'pg_cron not available: task schedule job skipped'; return; end if;
  if not exists (select 1 from cron.job where jobname = 'task-generate-daily') then
    perform cron.schedule('task-generate-daily', '5 19 * * *', 'select public.task_generate_due()');
  end if;
end $cron$;

revoke all on function public.task_cycle(text, integer[], integer, integer, date), public.task_generate_due(date), public.task_generate_now(),
  public.task_schedule_create(text, text, text, text, uuid, text, integer[], integer, integer), public.task_schedule_set_active(uuid, boolean),
  public.task_schedule_list() from public, anon, authenticated;
grant execute on function public.task_generate_now(), public.task_schedule_create(text, text, text, text, uuid, text, integer[], integer, integer),
  public.task_schedule_set_active(uuid, boolean), public.task_schedule_list() to authenticated;
