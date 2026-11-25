// What each button or form on a task does. Every action is one Task Master database function; the database checks the caller
// and the task's state again, and repeating an action (double tap, retry) is harmless there. Checks here only save a round trip.
import * as api from '../data/api.js';
import { checkNewTask, checkReject, checkRequest, checkSubmit, normaliseDetail } from '../domain/tasks.js';
import { todayPkt } from '../../../shared/format.js';

const fail = (message, code = '22023') => {
  throw Object.assign(new Error(message), { code });
};
const must = (msg) => msg && fail(msg);

// Loads the open task (null when it is closed or cannot be opened).
export async function loadDetail(ui) {
  if (!ui.open) return null;
  const raw = await api.getTask(ui.open).catch(() => null);
  const d = normaliseDetail(raw);
  if (!d) ui.open = null;
  return d;
}

export async function taskAct(name, p, ui) {
  const today = todayPkt();
  switch (name) {
    case 'toggle':
      ui.open = ui.open === p.id ? null : p.id;
      return null;
    case 'accept':
      await api.accept(p.id);
      return 'Task accepted.';
    case 'start':
      await api.start(p.id);
      return 'Work started.';
    case 'submit': {
      const task = ui.currentTask;
      if (task) must(checkSubmit(task, { note: p.note, tick: p.tick }));
      await api.submit(p.id, p.note, p.tick === true);
      ui.forget = ['note-', 'tick-'];
      return 'Handed in. It now waits to be checked.';
    }
    case 'comment':
      if (!(p.body ?? '').trim()) fail('Write a comment first.');
      await api.addComment(p.id, p.body.trim());
      ui.forget = ['body-'];
      return 'Comment added.';
    case 'request':
      must(checkRequest({ kind: p.kind, reason: p.reason, due: p.due }, today));
      await api.requestChange(p.id, p.kind, p.reason.trim(), p.due);
      ui.forget = ['reason-', 'rdue-', 'kind-'];
      return 'Request sent to the owner.';
    case 'begin':
      await api.beginVerification(p.id);
      return 'You are checking this task.';
    case 'decide': {
      if (p.decision === 'reject') {
        must(checkReject(p.comment));
        await api.verify(p.id, false, p.comment.trim());
        ui.forget = ['comment-v-'];
        return 'Sent back for correction.';
      }
      if (p.decision !== 'approve') fail('Choose Approve or Send back.');
      await api.verify(p.id, true, (p.comment ?? '').trim());
      ui.forget = ['comment-v-'];
      return 'Approved. The task is done.';
    }
    case 'assign':
      if (!p.assignee) fail('Choose a person.');
      await api.assignTask(p.id, p.assignee);
      ui.forget = ['assignee-'];
      return 'Task assigned.';
    case 'deadline':
      if (!p.due || p.due < today) fail('Choose a deadline that is today or later.');
      await api.setDeadline(p.id, p.due, p.reason);
      ui.forget = ['due-', 'dreason-'];
      return 'Deadline changed.';
    case 'cancel':
      if ((p.reason ?? '').trim().length < 3) fail('Give a reason for cancelling.');
      await api.cancelTask(p.id, p.reason.trim());
      ui.open = null;
      ui.forget = ['creason-'];
      return 'Task cancelled.';
    case 'create': {
      const f = {
        title: p.title,
        instructions: p.instructions,
        evidence: p.evidence,
        priority: p.priority,
        assignee: p.assignee,
        due: p.due,
      };
      must(checkNewTask(f, today));
      await api.createTask({ ...f, title: f.title.trim() });
      ui.forget = ['n-'];
      return 'Task created.';
    }
    default:
      return null;
  }
}
