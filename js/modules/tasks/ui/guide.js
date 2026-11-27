// Owner guide: how Task Master works and how to run it, in plain words. Static text, no data is read.
// The route needs tasks.manage (the Owner), so staff never see this page. Keep it in step with docs/modules/tasks.owner-manual.md.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';

const section = (title, open, body) =>
  html`<details class="tk-more" ${open ? 'open' : ''}>
    <summary>${title}</summary>
    <div class="tk-form">${body}</div>
  </details>`;

export async function mount(el) {
  render(
    el,
    html`${hero({ label: 'Tasks', title: 'Owner guide', sub: 'How to run Task Master. Only you can see this page.' })}
      <div class="tk-page">
        ${section(
          '1. Who can do what',
          true,
          html`<ul class="tk-list">
              <li>
                <strong>Owner</strong>: sees every page and every task. Creates, gives out, re-dates and cancels tasks, decides change
                requests, sets schedules, checks work.
              </li>
              <li>
                <strong>Senior and Junior staff</strong>: see only their own tasks. They accept, start, hand in, comment and ask for a
                change.
              </li>
              <li>
                <strong>A Senior you name as a verifier</strong> (the <em>verify</em> permission): can also check other people's handed-in
                work, never their own.
              </li>
            </ul>
            <p>
              <strong>Owner controls</strong> (All Tasks, Requests, Schedules, Team) belong to the Owner only. If a staff member ever sees
              "Owner controls", they were given the <em>manage</em> permission by mistake: remove it in Access. The system now refuses to
              give owner-only permissions to staff.
            </p>`,
        )}
        ${section(
          '2. The life of a task',
          false,
          html`<ol class="tk-list">
            <li><strong>Not assigned</strong>: created, nobody holds it yet.</li>
            <li><strong>To accept</strong>: given to someone, who must accept it.</li>
            <li><strong>Accepted</strong>, then <strong>In progress</strong> when they press Start work.</li>
            <li><strong>Handed in</strong>: they submit it, with a note or a tick if you asked for one.</li>
            <li><strong>Being checked</strong>: a verifier has opened it.</li>
            <li><strong>Done</strong> when approved, or <strong>Needs correction</strong> when sent back with a reason.</li>
            <li><strong>Cancelled</strong>: you stopped it (a reason is needed). A finished task cannot be cancelled.</li>
          </ol>`,
        )}
        ${section(
          '3. Creating and changing tasks (All Tasks)',
          false,
          html`<ul class="tk-list">
            <li>
              Create a task: title (3 to 120 characters), instructions, what the person hands in (nothing, a note, or a tick), priority, who
              gets it, deadline (today or later).
            </li>
            <li>Only people with a working login appear in "Give to".</li>
            <li>
              Open a task, then <strong>Owner controls</strong>: give it to someone else, change the deadline, or cancel it. The person is
              told.
            </li>
          </ul>`,
        )}
        ${section(
          '4. Checking work (To Verify)',
          false,
          html`<ul class="tk-list">
            <li>Press <strong>Start checking</strong> so nobody else checks it at the same time.</li>
            <li><strong>Approve</strong> completes the task. <strong>Send back</strong> needs a comment saying what to correct.</li>
            <li>Nobody can check their own work.</li>
          </ul>`,
        )}
        ${section(
          '5. Change requests',
          false,
          html`<p>
            Staff can ask to give a task to someone else or to change its deadline, with a reason. Open <strong>Requests</strong> to decide.
            Approving a reassignment asks you to choose the new person. Refusing needs a reason. Staff are told your answer.
          </p>`,
        )}
        ${section(
          '6. Schedules (tasks that repeat)',
          false,
          html`<ul class="tk-list">
            <li>
              Types: daily, weekly (choose weekdays), monthly (day 31 means the month's last day), or a week of the month (week 3 is days 15
              to 21; week 5 only exists in months of 29 days or more).
            </li>
            <li>Tasks are made automatically at 00:05 Pakistan time. "Generate now" does the same and can never make a duplicate.</li>
            <li>Switch a schedule off to stop it.</li>
          </ul>`,
        )}
        ${section(
          '7. Team page and overdue',
          false,
          html`<p>
              Team shows each person's open, overdue, to-verify and returned tasks, and a completion rate for 7, 30 or 90 days: tasks
              approved on or before their deadline, out of tasks that were due. Cancelled and unassigned tasks are left out.
            </p>
            <p>
              A task is <strong>overdue</strong> when its deadline is before today (Pakistan time) and it has not been handed in. Work that
              is handed in or being checked is not overdue.
            </p>`,
        )}
        ${section(
          '8. Who gets which message',
          false,
          html`<div class="tk-table-wrap">
            <table class="tk-table">
              <thead>
                <tr>
                  <th scope="col">What happens</th>
                  <th scope="col">Who is told</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>A task is given to someone</td>
                  <td>That person</td>
                </tr>
                <tr>
                  <td>Sent back, deadline changed, or cancelled</td>
                  <td>The person holding it</td>
                </tr>
                <tr>
                  <td>Work handed in</td>
                  <td>The Owner only</td>
                </tr>
                <tr>
                  <td>A change request is made</td>
                  <td>The Owner</td>
                </tr>
                <tr>
                  <td>A change request is decided</td>
                  <td>The person who asked</td>
                </tr>
                <tr>
                  <td>Overdue reminder (08:00, each morning)</td>
                  <td>Only the person holding the task</td>
                </tr>
              </tbody>
            </table>
          </div>`,
        )}
        ${section(
          '9. If something looks wrong',
          false,
          html`<ul class="tk-list">
            <li><strong>A staff member sees "Owner controls"</strong>: they hold the manage permission. Remove it in Access.</li>
            <li>
              <strong>"You cannot do that."</strong>: the database refused it (wrong person or wrong state). Refresh and look at the status.
            </li>
            <li><strong>Someone is missing from "Give to"</strong>: they have no working login.</li>
            <li><strong>"Someone else is already checking this task"</strong>: another verifier pressed Start checking.</li>
            <li>
              <strong>No phone alert</strong>: the person needs the Dua Android app with notifications allowed. Inbox messages work without
              it.
            </li>
            <li><strong>A list looks old</strong>: pages refresh every 60 seconds. Press Refresh.</li>
          </ul>`,
        )}
      </div>`,
  );
}
