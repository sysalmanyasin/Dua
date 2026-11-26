// Home: Messages. The newest unread messages and a link to the Inbox. Read only here; reading and clearing happen in the Inbox.
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { myInboxList, myInboxUnread } from '../data/api.js';
import { freshness } from '../domain/ops.js';
import { ago, normaliseMessages, unreadOf, unreadText } from '../../inbox/domain/inbox.js';

const REFRESH_MS = 60_000;
const SHOWN = 3;

export function startMessages({ host, perms }) {
  if (!host || !perms.includes('ntf.view_own')) return null;
  let refresher = null;

  async function load() {
    const [list, count] = await Promise.all([myInboxList(10), myInboxUnread()]);
    return { messages: normaliseMessages(list), unread: Number.isInteger(count) ? count : null };
  }

  function draw(state) {
    if (!host.isConnected) return refresher?.stop();
    const d = state.data;
    if (d && d.messages === null) return render(host, html``); // not allowed: show nothing
    const f = freshness(state);
    const fresh = d ? unreadOf(d.messages).slice(0, SHOWN) : [];
    const unread = d ? (d.unread ?? unreadOf(d.messages).length) : 0;
    render(
      host,
      html`<section class="home-section ops-section" aria-label="Messages">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">INBOX</span>
            <h2>Messages</h2>
          </div>
          <a class="home-text-link" href="#/inbox">Open inbox</a>
        </div>
        <div class="ops-status ops-${f.tone}" role="status" aria-live="polite">
          <span>${f.text}</span>
          <button
            class="btn btn-sm"
            type="button"
            data-msg-refresh
            ${state.status === 'loading' || state.status === 'refreshing' ? 'disabled' : ''}
          >
            Refresh
          </button>
        </div>
        ${!d && state.status === 'error' ? html`<p class="note note-error" role="status">Messages could not be loaded.</p>` : ''}
        ${
          d
            ? html`<p class="tk-sub" role="status" aria-live="polite">${unreadText(unread)}</p>
                ${
                  fresh.length
                    ? html`<ul class="tk-cards tk-compact">
                          ${fresh.map(
                            (m) =>
                              html`<li class="tk-card ib-unread">
                                <div class="tk-main">
                                  <strong class="tk-title">${m.title}</strong
                                  >${m.body ? html`<span class="ib-body">${m.body}</span>` : ''}<span class="tk-sub">${ago(m.at)}</span>
                                </div>
                              </li>`,
                          )}
                        </ul>
                        ${unread > fresh.length ? html`<p class="bi-small">${unread - fresh.length} more. <a href="#/inbox">See all</a></p>` : ''}`
                    : html`<p class="home-empty">You are up to date.</p>`
                }`
            : ''
        }
      </section>`,
    );
  }

  refresher = createRefresher({
    load,
    onChange: draw,
    intervalMs: REFRESH_MS,
    staleAfterMs: 2 * REFRESH_MS + 60_000,
    isAlive: () => host.isConnected,
  });
  host.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-msg-refresh]')) refresher.refresh();
  });
  draw(refresher.getState());
  refresher.start();
  return refresher;
}
