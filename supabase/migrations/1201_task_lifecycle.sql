-- 1201_task_lifecycle: the Task Master workflow, enforced here and not on the screen.
--   created -> assigned -> accepted -> in_progress -> submitted -> in_verification -> completed
--   a rejected submission goes to "returned" for correction and resubmission; the Owner can cancel an unfinished task.
-- Every function checks who the caller is and the task's current state under a row lock. Repeating an action that has already
-- happened (a double tap, a retry after a dropped connection) returns quietly and adds no second history line.
-- Errors: 42501 not allowed, 22023 invalid input, 55000 the task is not in a state where this can be done.

-- ── the Owner creates, assigns, re-dates and cancels (Manager is the Owner, D-52) ──
create function public.task_create(p_title text, p_instructions text, p_evidence text, p_priority text, p_assignee uuid, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; st text;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_title is null or length(trim(p_title)) not between 3 and 120 then raise exception 'the title must be 3 to 120 characters' using errcode = '22023'; end if;
  if coalesce(p_evidence, 'none') not in ('none', 'note', 'tick') then raise exception 'evidence must be none, note or tick' using errcode = '22023'; end if;
  if coalesce(p_priority, 'normal') not in ('normal', 'urgent') then raise exception 'priority must be normal or urgent' using errcode = '22023'; end if;
  if p_due is not null and p_due < public.task_today() then raise exception 'the deadline cannot be in the past' using errcode = '22023'; end if;
  if p_assignee is not null and not public.task_staff_has_login(p_assignee) then raise exception 'that person cannot be given tasks (no working login)' using errcode = '22023'; end if;
  st := case when p_assignee is null then 'created' else 'assigned' end;
  insert into public.task_items (title, instructions, evidence_rule, priority, status, source, created_by, assignee_staff_id, start_on, due_on)
  values (trim(p_title), coalesce(p_instructions, ''), coalesce(p_evidence, 'none'), coalesce(p_priority, 'normal'), st, 'manual', auth.uid(), p_assignee, public.task_today(), p_due)
  returning task_items.id into new_id;
  perform public.task_event(new_id, 'created', null, 'created', jsonb_build_object('evidence_rule', coalesce(p_evidence, 'none'), 'due_on', p_due));
  if p_assignee is not null then perform public.task_event(new_id, 'assigned', 'created', 'assigned', jsonb_build_object('assignee', p_assignee)); end if;
  perform public.log_activity('task.created', 'task_items', new_id::text, null, jsonb_build_object('title', trim(p_title), 'assignee', p_assignee, 'due_on', p_due), null);
  return new_id;
end $$;

create function public.task_assign(p_task uuid, p_assignee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  if t.status not in ('created', 'assigned', 'accepted', 'in_progress', 'returned') then raise exception 'this task can no longer be given to someone else' using errcode = '55000'; end if;
  if not public.task_staff_has_login(p_assignee) then raise exception 'that person cannot be given tasks (no working login)' using errcode = '22023'; end if;
  if t.assignee_staff_id = p_assignee and t.status = 'assigned' then return; end if;
  update public.task_items set assignee_staff_id = p_assignee, status = 'assigned', accepted_at = null, version = version + 1, updated_at = now() where id = p_task;
  perform public.task_event(p_task, 'assigned', t.status, 'assigned', jsonb_build_object('assignee', p_assignee, 'previous_assignee', t.assignee_staff_id));
  perform public.log_activity('task.assigned', 'task_items', p_task::text, jsonb_build_object('assignee', t.assignee_staff_id), jsonb_build_object('assignee', p_assignee), null);
end $$;

create function public.task_set_deadline(p_task uuid, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_due is null or p_due < public.task_today() then raise exception 'choose a deadline that is today or later' using errcode = '22023'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  if t.status in ('completed', 'cancelled') then raise exception 'this task is finished' using errcode = '55000'; end if;
  if t.due_on = p_due then return; end if;
  update public.task_items set due_on = p_due, version = version + 1, updated_at = now() where id = p_task;
  perform public.task_event(p_task, 'deadline_changed', t.status, t.status, jsonb_build_object('from', t.due_on, 'to', p_due, 'reason', nullif(left(trim(coalesce(p_reason, '')), 500), '')));
  perform public.log_activity('task.deadline_changed', 'task_items', p_task::text, jsonb_build_object('due_on', t.due_on), jsonb_build_object('due_on', p_due), nullif(left(trim(coalesce(p_reason, '')), 200), ''));
end $$;

create function public.task_cancel(p_task uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'give a reason for cancelling' using errcode = '22023'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  if t.status = 'cancelled' then return; end if;
  if t.status = 'completed' then raise exception 'a completed task cannot be cancelled' using errcode = '55000'; end if;
  update public.task_items set status = 'cancelled', cancelled_reason = left(trim(p_reason), 500), version = version + 1, updated_at = now() where id = p_task;
  update public.task_change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = 'The task was cancelled.' where task_id = p_task and status = 'pending';
  perform public.task_event(p_task, 'cancelled', t.status, 'cancelled', jsonb_build_object('reason', left(trim(p_reason), 500)));
  perform public.log_activity('task.cancelled', 'task_items', p_task::text, jsonb_build_object('status', t.status), jsonb_build_object('status', 'cancelled'), left(trim(p_reason), 200));
end $$;

-- ── the assignee works the task ────────────────────────────────────────────────
create function public.task_accept(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.has_perm('tasks.view_own') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found or t.assignee_staff_id is distinct from public.task_my_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status in ('accepted', 'in_progress') then return; end if;
  if t.status <> 'assigned' then raise exception 'this task cannot be accepted now' using errcode = '55000'; end if;
  update public.task_items set status = 'accepted', accepted_at = now(), version = version + 1, updated_at = now() where id = p_task;
  perform public.task_event(p_task, 'accepted', 'assigned', 'accepted');
end $$;

create function public.task_start(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.has_perm('tasks.view_own') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found or t.assignee_staff_id is distinct from public.task_my_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status = 'in_progress' then return; end if;
  if t.status = 'assigned' then raise exception 'accept the task first' using errcode = '55000'; end if;
  if t.status not in ('accepted', 'returned') then raise exception 'this task cannot be started now' using errcode = '55000'; end if;
  update public.task_items set status = 'in_progress', version = version + 1, updated_at = now() where id = p_task;
  perform public.task_event(p_task, case when t.status = 'returned' then 'correction_started' else 'started' end, t.status, 'in_progress');
end $$;

-- Evidence follows the creator's rule: none needs nothing, note needs a written note, tick needs the confirmation tick.
create function public.task_submit(p_task uuid, p_note text, p_tick boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items; n integer; note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if not public.has_perm('tasks.view_own') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found or t.assignee_staff_id is distinct from public.task_my_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status in ('submitted', 'in_verification') then return; end if;
  if t.status <> 'in_progress' then raise exception 'start the task before handing it in' using errcode = '55000'; end if;
  if t.evidence_rule = 'note' and note is null then raise exception 'write a short note about the work done' using errcode = '22023'; end if;
  if t.evidence_rule = 'tick' and p_tick is not true then raise exception 'tick the box to confirm the work is done' using errcode = '22023'; end if;
  select coalesce(max(s.n), 0) + 1 into n from public.task_submissions s where s.task_id = p_task;
  insert into public.task_submissions (task_id, n, submitted_by, note, tick) values (p_task, n, auth.uid(), note, coalesce(p_tick, false));
  update public.task_items set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), verifier_user = null, version = version + 1, updated_at = now() where id = p_task;
  perform public.task_event(p_task, 'submitted', 'in_progress', 'submitted', jsonb_build_object('submission', n, 'has_note', note is not null, 'tick', coalesce(p_tick, false)));
end $$;

-- ── verification (D-53) ────────────────────────────────────────────────────────
create function public.task_begin_verification(p_task uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items;
begin
  if not public.task_can_verify() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  if t.submitted_by = auth.uid() then raise exception 'you cannot verify your own submission' using errcode = '42501'; end if;
  if t.status = 'in_verification' and t.verifier_user = auth.uid() then return; end if;
  if t.status = 'in_verification' then raise exception 'someone else is already checking this task' using errcode = '55000'; end if;
  if t.status <> 'submitted' then raise exception 'this task is not waiting for verification' using errcode = '55000'; end if;
  update public.task_items set status = 'in_verification', verifier_user = auth.uid(), version = version + 1, updated_at = now() where id = p_task;
  perform public.task_event(p_task, 'verification_started', 'submitted', 'in_verification');
end $$;

-- Approve completes the task. Reject needs a reason and sends it back to the assignee for correction.
create function public.task_verify(p_task uuid, p_approve boolean, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.task_items; sub public.task_submissions; c text := nullif(left(trim(coalesce(p_comment, '')), 500), '');
begin
  if not public.task_can_verify() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'approve or reject' using errcode = '22023'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found then raise exception 'unknown task' using errcode = '22023'; end if;
  if t.submitted_by = auth.uid() then raise exception 'you cannot verify your own submission' using errcode = '42501'; end if;
  select * into sub from public.task_submissions where task_id = p_task order by n desc limit 1;
  -- a retry of a decision this person already made
  if sub.decision is not null and sub.decided_by = auth.uid() and ((p_approve and t.status = 'completed') or (not p_approve and t.status = 'returned')) then return; end if;
  if t.status not in ('submitted', 'in_verification') then raise exception 'this task is not waiting for verification' using errcode = '55000'; end if;
  if t.status = 'in_verification' and t.verifier_user is distinct from auth.uid()
     and not exists (select 1 from public.profiles where user_id = auth.uid() and role_template = 'admin') then
    raise exception 'someone else is already checking this task' using errcode = '55000';
  end if;
  if not p_approve and c is null then raise exception 'say what needs to be corrected' using errcode = '22023'; end if;
  update public.task_submissions set decision = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_comment = c where id = sub.id;
  if p_approve then
    update public.task_items set status = 'completed', completed_at = now(), verifier_user = auth.uid(), version = version + 1, updated_at = now() where id = p_task;
    perform public.task_event(p_task, 'verified', t.status, 'completed', jsonb_build_object('submission', sub.n, 'comment', c));
    perform public.log_activity('task.verified', 'task_items', p_task::text, null, jsonb_build_object('submission', sub.n), c);
  else
    update public.task_items set status = 'returned', verifier_user = auth.uid(), version = version + 1, updated_at = now() where id = p_task;
    perform public.task_event(p_task, 'returned', t.status, 'returned', jsonb_build_object('submission', sub.n, 'comment', c));
    perform public.log_activity('task.returned', 'task_items', p_task::text, null, jsonb_build_object('submission', sub.n), c);
  end if;
end $$;

-- ── comments: the only staff-to-staff channel (no chat, no direct messages) ───
create function public.task_comment_add(p_task uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_body is null or length(trim(p_body)) not between 1 and 1000 then raise exception 'write 1 to 1000 characters' using errcode = '22023'; end if;
  if not public.task_can_see(p_task) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.task_comments (task_id, author_user, body) values (p_task, auth.uid(), trim(p_body));
end $$;

-- ── staff ask, the Owner decides ───────────────────────────────────────────────
-- Staff cannot change who owns a task or when it is due. They ask, with a reason, and the Owner approves or refuses.
create function public.task_request_change(p_task uuid, p_kind text, p_reason text, p_proposed_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.task_items; rid uuid;
begin
  if not public.has_perm('tasks.view_own') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('reassign', 'deadline') then raise exception 'ask to reassign or to change the deadline' using errcode = '22023'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'give a reason' using errcode = '22023'; end if;
  if p_kind = 'deadline' and (p_proposed_due is null or p_proposed_due < public.task_today()) then raise exception 'choose a new deadline that is today or later' using errcode = '22023'; end if;
  select * into t from public.task_items where id = p_task for update;
  if not found or t.assignee_staff_id is distinct from public.task_my_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if t.status not in ('assigned', 'accepted', 'in_progress', 'returned') then raise exception 'a request cannot be made for this task now' using errcode = '55000'; end if;
  select id into rid from public.task_change_requests where task_id = p_task and status = 'pending';
  if found then return rid; end if;
  insert into public.task_change_requests (task_id, kind, reason, proposed_due_on, requested_by)
  values (p_task, p_kind, left(trim(p_reason), 500), case when p_kind = 'deadline' then p_proposed_due end, auth.uid()) returning id into rid;
  perform public.task_event(p_task, 'change_requested', t.status, t.status, jsonb_build_object('request', rid, 'kind', p_kind, 'reason', left(trim(p_reason), 500), 'proposed_due_on', p_proposed_due));
  return rid;
end $$;

create function public.task_decide_change(p_request uuid, p_approve boolean, p_note text, p_new_assignee uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.task_change_requests; t public.task_items; note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if not public.has_perm('tasks.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'approve or refuse' using errcode = '22023'; end if;
  select * into r from public.task_change_requests where id = p_request for update;
  if not found then raise exception 'unknown request' using errcode = '22023'; end if;
  if r.status <> 'pending' then
    if (r.status = 'approved') = p_approve then return; end if;
    raise exception 'this request has already been decided' using errcode = '55000';
  end if;
  if not p_approve and note is null then raise exception 'say why the request is refused' using errcode = '22023'; end if;
  select * into t from public.task_items where id = r.task_id for update;
  update public.task_change_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = note where id = p_request;
  if p_approve and t.status in ('assigned', 'accepted', 'in_progress', 'returned') then
    if r.kind = 'deadline' then
      update public.task_items set due_on = r.proposed_due_on, version = version + 1, updated_at = now() where id = t.id;
      perform public.task_event(t.id, 'deadline_changed', t.status, t.status, jsonb_build_object('from', t.due_on, 'to', r.proposed_due_on, 'request', r.id));
    else
      if p_new_assignee is not null and not public.task_staff_has_login(p_new_assignee) then raise exception 'that person cannot be given tasks (no working login)' using errcode = '22023'; end if;
      update public.task_items set assignee_staff_id = p_new_assignee, status = case when p_new_assignee is null then 'created' else 'assigned' end, accepted_at = null, version = version + 1, updated_at = now() where id = t.id;
      perform public.task_event(t.id, case when p_new_assignee is null then 'unassigned' else 'assigned' end, t.status, case when p_new_assignee is null then 'created' else 'assigned' end,
        jsonb_build_object('assignee', p_new_assignee, 'previous_assignee', t.assignee_staff_id, 'request', r.id));
    end if;
  end if;
  perform public.task_event(r.task_id, 'change_decided', t.status, t.status, jsonb_build_object('request', r.id, 'kind', r.kind, 'approved', p_approve, 'note', note));
  perform public.log_activity('task.change_decided', 'task_change_requests', p_request::text, null, jsonb_build_object('kind', r.kind, 'approved', p_approve), note);
end $$;

revoke all on function public.task_create(text, text, text, text, uuid, date), public.task_assign(uuid, uuid), public.task_set_deadline(uuid, date, text),
  public.task_cancel(uuid, text), public.task_accept(uuid), public.task_start(uuid), public.task_submit(uuid, text, boolean),
  public.task_begin_verification(uuid), public.task_verify(uuid, boolean, text), public.task_comment_add(uuid, text),
  public.task_request_change(uuid, text, text, date), public.task_decide_change(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.task_create(text, text, text, text, uuid, date), public.task_assign(uuid, uuid), public.task_set_deadline(uuid, date, text),
  public.task_cancel(uuid, text), public.task_accept(uuid), public.task_start(uuid), public.task_submit(uuid, text, boolean),
  public.task_begin_verification(uuid), public.task_verify(uuid, boolean, text), public.task_comment_add(uuid, text),
  public.task_request_change(uuid, text, text, date), public.task_decide_change(uuid, boolean, text, uuid) to authenticated;
