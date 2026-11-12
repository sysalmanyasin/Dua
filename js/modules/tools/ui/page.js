// Owner Tools tab: alerts, backups and feed health in one calm place.
import { html, render } from '../../../shared/html.js';
import { hero, sectionLabel } from '../../../shared/ui.js';
import { alertLabel } from '../../../shared/alerts.js';
import { shortDate } from '../../../shared/format.js';
import { ackNotification, toolsOverview } from '../data/api.js';
import { ageText, backupStatus, canAck, drillStatus, feedStatus, notificationState } from '../domain/tools.js';

const chip = (s) => html`<span class="kchip ${s.tone === 'good' ? 'pos' : s.tone === 'bad' ? 'neg' : ''}">${s.text}</span>`;
const mb = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '');

export async function mount(el) {
  const state = { error: null };

  async function draw() {
    let o = null;
    try {
      o = await toolsOverview();
    } catch {
      state.error = 'Could not load this page. Please try again.';
    }
    const now = new Date();
    const head = hero({ label: 'Owner', title: 'Tools', sub: 'Alerts, backups and feed health.' });
    if (!o) {
      render(
        el,
        html`${head}
          <p class="note ${state.error ? 'note-error' : ''}" role="alert">
            ${state.error ?? 'Owner access with the second factor is needed to see this page.'}
          </p>`,
      );
      return;
    }
    const b = o.backups;
    const n = o.notifications;
    render(
      el,
      html`${head} ${state.error ? html`<p class="note note-error" role="alert">${state.error}</p>` : ''} ${sectionLabel('Backups')}
        <section class="card">
          <div class="row"><div>${chip(backupStatus(b, now))}</div></div>
          <div class="row"><div>${chip(drillStatus(b, now))}</div></div>
          ${
            b.recent.length === 0
              ? html`<p class="muted small">Nothing recorded yet. The first backup runs at 18:00 Pakistan time once it is set up.</p>`
              : b.recent.map(
                  (r) =>
                    html`<div class="row">
                      <div>
                        <strong>${r.kind === 'restore_drill' ? 'Restore test' : 'Daily backup'}</strong> ·
                        ${r.status === 'ok' ? 'OK' : 'Failed'}<br />
                        <span class="muted small"
                          >${r.day ? shortDate(r.day) : ageText(r.created_at, now)} ${mb(r.size_bytes)} ${r.error ?? ''}</span
                        >
                      </div>
                    </div>`,
                )
          }
        </section>
        ${sectionLabel('Inventory feed')}
        <section class="card">
          <div class="row"><div>${chip(feedStatus(o.feed, now))}</div></div>
        </section>
        ${sectionLabel('Alerts')}
        <section class="card">
          <p class="muted small">${n.failed} failed · ${n.unsent} not sent yet</p>
          ${
            n.recent.length === 0
              ? html`<p class="muted">No alerts yet.</p>`
              : n.recent.map(
                  (x) =>
                    html`<div class="row">
                      <div>
                        <strong>${alertLabel(x.kind)}</strong><br />
                        <span class="muted small"
                          >${notificationState(x)} · ${ageText(x.created_at, now)}${x.last_error ? ` · ${x.last_error}` : ''}</span
                        >
                      </div>
                      ${canAck(x) ? html`<div class="actions"><button class="btn" data-act="ack" data-id="${x.id}">Acknowledge</button></div>` : ''}
                    </div>`,
                )
          }
        </section>`,
    );
  }

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-act="ack"]');
    if (!btn) return;
    state.error = null;
    try {
      await ackNotification(btn.dataset.id);
    } catch {
      state.error = 'That did not work. Please try again.';
    }
    await draw();
  };
  await draw();
}
