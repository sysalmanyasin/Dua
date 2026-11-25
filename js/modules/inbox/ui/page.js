// Inbox: the person's own in-app messages and reminders (Stage 4, in-app only, D-58). Tap a message to read it and go to what it
// is about. Messages are never deleted by the person; the database tidies old ones.
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { ago, normaliseMessages, unreadOf, unreadText } from '../domain/inbox.js';
import { mountScreen } from '../../tasks/ui/kit.js'; // the shared refresh, keep-what-is-typed and message handling

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Inbox', title: 'Messages', sub: 'What needs your attention, and what changed on your tasks.' }),
    async load(ui) {
      ui.filter ??= 'all';
      return { messages: normaliseMessages(await api.listMine(100)) };
    },
    async act(name, p, ui) {
      if (name === 'filter') {
        ui.filter = p.filter === 'unread' ? 'unread' : 'all';
        return null;
      }
      if (name === 'read') {
        await api.markRead([p.id]);
        return null;
      }
      if (name === 'open') {
        await api.markRead([p.id]);
        if (p.href) location.hash = `#${p.href}`;
        return null;
      }
      if (name === 'read-all') {
        const n = await api.markAllRead();
        return n > 0 ? 'All messages marked as read.' : null;
      }
      return null;
    },
    view({ messages }, ui) {
      if (messages === null) return html`<p class="home-empty">An inbox is not set up for your login.</p>`;
      const unread = unreadOf(messages);
      const shown = ui.filter === 'unread' ? unread : messages;
      return html`<div class="tk-row">
          <p class="muted" role="status" aria-live="polite">${unreadText(unread.length)}</p>
          <button class="btn" type="button" data-act="read-all" ${unread.length ? '' : 'disabled'}>Mark all as read</button>
        </div>
        <div class="tk-tabs" role="group" aria-label="Which messages">
          <button
            class="btn ${ui.filter === 'all' ? 'btn-primary' : ''}"
            type="button"
            data-act="filter"
            data-filter="all"
            aria-pressed="${ui.filter === 'all'}"
          >
            All
          </button>
          <button
            class="btn ${ui.filter === 'unread' ? 'btn-primary' : ''}"
            type="button"
            data-act="filter"
            data-filter="unread"
            aria-pressed="${ui.filter === 'unread'}"
          >
            New
          </button>
        </div>
        ${
          shown.length
            ? html`<ul class="tk-cards">
                ${shown.map(
                  (m) =>
                    html`<li class="tk-card ${m.read ? '' : 'ib-unread'}">
                      <div class="tk-row">
                        <div class="tk-main">
                          <strong class="tk-title">${m.read ? '' : html`<span class="ib-new">New</span> `}${m.title}</strong>
                          ${m.body ? html`<span class="ib-body">${m.body}</span>` : ''}
                          <span class="tk-sub">${ago(m.at)}</span>
                        </div>
                      </div>
                      <div class="tk-buttons">
                        ${m.href ? html`<button class="btn btn-primary" type="button" data-act="open" data-id="${m.id}" data-href="${m.href}">Open</button>` : ''}
                        ${m.read ? '' : html`<button class="btn" type="button" data-act="read" data-id="${m.id}">Mark as read</button>`}
                      </div>
                    </li>`,
                )}
              </ul>`
            : html`<p class="home-empty">${ui.filter === 'unread' ? 'Nothing new. You are up to date.' : 'No messages yet.'}</p>`
        }`;
    },
  });
}
