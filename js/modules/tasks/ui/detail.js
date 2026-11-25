// One task, opened: what it is, what happened, comments, and the actions this person may take (the database decides what is
// allowed and sends `can`; the screen only offers what `can` says, and the database refuses anything else).
import { html } from '../../../shared/html.js';
import { shortDate } from '../../../shared/format.js';
import { EVIDENCE, REQUEST_KINDS, STATUS, canAskChange, dueText, nextAction } from '../domain/tasks.js';

export const chip = (status) => html`<span class="tk-chip tk-${STATUS[status].tone}">${STATUS[status].label}</span>`;
const when = (iso) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

const picker = (name, staff, { blank = '', keep } = {}) =>
  html`<select name="${name}" data-keep="${keep}">
    ${blank ? html`<option value="">${blank}</option>` : ''} ${staff.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
  </select>`;

export function detailView(d, { today, staff = [], taskId }) {
  const t = d.task;
  const k = (n) => `${n}-${taskId}`;
  const live = !['completed', 'cancelled'].includes(t.status);
  const action = d.can.isAssignee ? nextAction(t) : null;
  return html`<div class="tk-detail" role="region" aria-label="Task details">
    ${t.instructions ? html`<p class="tk-instructions">${t.instructions}</p>` : html`<p class="muted">No instructions were written.</p>`}
    <p class="tk-facts">
      <span>Hand in: ${EVIDENCE[t.evidence]}</span>
      <span>${t.assigneeName ? `With ${t.assigneeName}` : 'Not given to anyone'}</span>
      <span>${dueText(t, today)}</span>
      ${t.cancelledReason ? html`<span>Cancelled: ${t.cancelledReason}</span>` : ''}
    </p>

    ${
      d.submissions.length
        ? html`<h4>Handed in</h4>
            <ul class="tk-list">
              ${d.submissions.map(
                (s) =>
                  html`<li>
                    <strong>Attempt ${s.n}</strong> · ${s.at ? when(s.at) : ''} ${s.note ? html`<div>“${s.note}”</div>` : ''}
                    ${s.tick ? html`<div>Ticked as done</div>` : ''}
                    ${s.decision ? html`<div>${s.decision === 'approved' ? 'Approved' : 'Sent back'}${s.decidedBy ? ` by ${s.decidedBy}` : ''}${s.decisionComment ? `: ${s.decisionComment}` : ''}</div>` : html`<div>Waiting to be checked</div>`}
                  </li>`,
              )}
            </ul>`
        : ''
    }
    ${
      d.requests.length
        ? html`<h4>Requests</h4>
            <ul class="tk-list">
              ${d.requests.map(
                (r) =>
                  html`<li>
                    ${REQUEST_KINDS[r.kind]}${r.proposedDue ? ` to ${shortDate(r.proposedDue)}` : ''} ·
                    ${r.status === 'pending' ? 'waiting for the owner' : r.status === 'approved' ? 'approved' : 'refused'}
                    <div>Reason: ${r.reason}</div>
                    ${r.decisionNote ? html`<div>Owner: ${r.decisionNote}</div>` : ''}
                  </li>`,
              )}
            </ul>`
        : ''
    }
    ${
      action?.key === 'submit'
        ? html`<form class="tk-form" data-act="submit" data-id="${t.id}">
            <h4>Hand in your work</h4>
            ${t.evidence === 'note' ? html`<label class="field"><span>What did you do? (needed)</span><textarea name="note" rows="3" maxlength="1000" required data-keep="${k('note')}"></textarea></label>` : ''}
            ${t.evidence === 'tick' ? html`<label class="tk-check"><input type="checkbox" name="tick" required data-keep="${k('tick')}" /> <span>I confirm this work is done</span></label>` : ''}
            ${t.evidence === 'none' ? html`<p class="muted">Nothing else is needed.</p>` : ''}
            <button class="btn btn-primary" type="submit">Hand in</button>
          </form>`
        : ''
    }
    ${action && action.key !== 'submit' ? html`<button class="btn btn-primary" type="button" data-act="${action.key}" data-id="${t.id}">${action.label}</button>` : ''}
    ${
      d.can.isAssignee && canAskChange(t)
        ? html`<details class="tk-more" data-keep="${k('ask')}">
            <summary>Ask for a change</summary>
            <form class="tk-form" data-act="request" data-id="${t.id}">
              <label class="field"
                ><span>What do you need?</span>
                <select name="kind" data-keep="${k('kind')}">
                  ${Object.entries(REQUEST_KINDS).map(([v, l]) => html`<option value="${v}">${l}</option>`)}
                </select></label
              >
              <label class="field"
                ><span>New deadline (only for a deadline change)</span><input type="date" name="due" data-keep="${k('rdue')}"
              /></label>
              <label class="field"
                ><span>Why? (needed)</span><textarea name="reason" rows="2" maxlength="500" required data-keep="${k('reason')}"></textarea>
              </label>
              <button class="btn" type="submit">Send request to the owner</button>
            </form>
          </details>`
        : ''
    }
    ${d.can.isAssignee && t.pendingRequest ? html`<p class="note">You have asked for a change. The owner has not decided yet.</p>` : ''}
    ${
      d.can.verify
        ? html`<div class="tk-form">
            <h4>Check this work</h4>
            ${t.status === 'submitted' ? html`<button class="btn" type="button" data-act="begin" data-id="${t.id}">Start checking</button>` : ''}
            <form data-act="decide" data-id="${t.id}">
              <label class="field"
                ><span>Comment (needed when you send it back)</span
                ><textarea name="comment" rows="2" maxlength="500" data-keep="${k('comment-v')}"></textarea>
              </label>
              <div class="tk-buttons">
                <button class="btn btn-primary" type="submit" data-decision="approve">Approve</button>
                <button class="btn" type="submit" data-decision="reject">Send back</button>
              </div>
            </form>
          </div>`
        : ''
    }
    ${
      d.can.manage && live
        ? html`<details class="tk-more" data-keep="${k('own')}">
            <summary>Owner controls</summary>
            <form class="tk-form" data-act="assign" data-id="${t.id}">
              <label class="field"><span>Give to</span>${picker('assignee', staff, { keep: k('assignee') })}</label>
              <button class="btn" type="submit">${t.assigneeId ? 'Give to someone else' : 'Assign'}</button>
            </form>
            <form class="tk-form" data-act="deadline" data-id="${t.id}">
              <label class="field"><span>New deadline</span><input type="date" name="due" required data-keep="${k('due')}" /></label>
              <label class="field"
                ><span>Reason (optional)</span><input type="text" name="reason" maxlength="500" data-keep="${k('dreason')}"
              /></label>
              <button class="btn" type="submit">Change deadline</button>
            </form>
            ${
              ['created', 'assigned', 'accepted', 'in_progress', 'returned', 'submitted', 'in_verification'].includes(t.status)
                ? html`<form class="tk-form" data-act="cancel" data-id="${t.id}">
                    <label class="field"
                      ><span>Reason for cancelling (needed)</span
                      ><input type="text" name="reason" maxlength="500" required data-keep="${k('creason')}"
                    /></label>
                    <button class="btn btn-danger" type="submit">Cancel this task</button>
                  </form>`
                : ''
            }
          </details>`
        : ''
    }

    <h4>Comments</h4>
    ${
      d.comments.length
        ? html`<ul class="tk-list">
            ${d.comments.map(
              (c) =>
                html`<li>
                  <strong>${c.mine ? 'You' : c.by}</strong> · ${when(c.at)}
                  <div>${c.body}</div>
                </li>`,
            )}
          </ul>`
        : html`<p class="muted">No comments yet.</p>`
    }
    <form class="tk-form" data-act="comment" data-id="${t.id}">
      <label class="field"
        ><span>Add a comment</span><textarea name="body" rows="2" maxlength="1000" required data-keep="${k('body')}"></textarea>
      </label>
      <button class="btn" type="submit">Post comment</button>
    </form>

    <details class="tk-more" data-keep="${k('history')}">
      <summary>History</summary>
      <ol class="tk-list">
        ${d.events.map((e) => html`<li>${when(e.at)} · <strong>${e.label}</strong>${e.by ? ` · ${e.by}` : ''}${e.detail ? html`<div>${e.detail}</div>` : ''}</li>`)}
      </ol>
    </details>
  </div>`;
}

// A task in a list. `open` is true when its detail is shown under it; `quick` offers one-tap accept or start for the assignee.
export function taskCard(t, { today, open, detailHtml = '', quick = false, showPerson = false, extra = '' }) {
  const a = quick ? nextAction(t) : null;
  return html`<li class="tk-card ${t.overdue ? 'tk-overdue' : ''}" data-task="${t.id}">
    <div class="tk-row">
      <div class="tk-main">
        <strong class="tk-title">${t.priority === 'urgent' ? html`<span class="tk-urgent">Urgent</span> ` : ''}${t.title}</strong>
        <span class="tk-sub"
          >${dueText(t, today)}${showPerson ? ` · ${t.assigneeName || 'Not assigned'}` : ''}${t.pendingRequest ? ' · change requested' : ''}</span
        >
      </div>
      ${chip(t.status)}
    </div>
    ${extra}
    <div class="tk-buttons">
      ${a && a.key !== 'submit' ? html`<button class="btn btn-primary" type="button" data-act="${a.key}" data-id="${t.id}">${a.label}</button>` : ''}
      <button
        class="btn ${a?.key === 'submit' ? 'btn-primary' : ''}"
        type="button"
        data-act="toggle"
        data-id="${t.id}"
        aria-expanded="${open}"
      >
        ${open ? 'Close' : a?.key === 'submit' ? 'Hand in / details' : 'Details'}
      </button>
    </div>
    ${open ? detailHtml : ''}
  </li>`;
}
