// Sync (owner): bring the stock data up to date now, and see what the last runs did. The hourly job does this on its own;
// this screen is for "I just received goods" and for confirming a large removal the system refused.
import { hero } from '../../../shared/ui.js';
import { html, render } from '../../../shared/html.js';
import { latestSync, syncHistory, syncNow } from '../data/feed.js';
import { dayTime, qty } from './fmt.js';
import { errorCard, loadingCard } from './parts.js';

const LABEL = { changed: 'Updated', unchanged: 'No change', failed: 'Failed', refused: 'Refused' };

export async function mount(el) {
  let busy = false;
  let result = null; // what the last "Sync now" answered
  let history = [];
  let latest = null;
  let loadError = false;

  render(el, loadingCard('Opening Sync…'));

  async function load() {
    try {
      [latest, history] = await Promise.all([latestSync(), syncHistory()]);
      loadError = false;
    } catch {
      loadError = true;
    }
  }

  function resultCard() {
    if (!result) return html``;
    if (result.ok) {
      return html`<p class="note note-info" role="status">
        ${
          result.skipped
            ? 'The stock file has not changed since the last sync, so there was nothing to download.'
            : `Done. ${qty(result.added ?? 0)} added, ${qty(result.changed ?? 0)} changed, ${qty(result.removed ?? 0)} removed, ${qty(result.unchanged ?? 0)} unchanged.`
        }
      </p>`;
    }
    if (result.refused) {
      return html`<section class="card">
        <p class="note note-error" role="status">
          The stock file would remove ${qty(result.wouldRemove)} of ${qty(result.active)} products (more than 20%). Nothing was changed.
          This usually means the file from the stock system is wrong or incomplete.
        </p>
        <button type="button" class="btn btn-sm" data-act="force">I checked the file: sync anyway</button>
      </section>`;
    }
    if (result.status === 409)
      return html`<p class="note note-info" role="status">A sync is already running. Wait a minute and look at the history below.</p>`;
    return html`<p class="note note-error" role="status">
      ${result.error || 'The sync did not complete.'} The previous data is still in place.
    </p>`;
  }

  function draw() {
    if (loadError) return render(el, errorCard('the sync history'));
    render(
      el,
      html`${hero({ label: 'Inventory', title: 'Sync', sub: 'Update the stock data now' })}
        <section class="card">
          <p>
            <strong>${latest?.synced_at ? `Last checked ${dayTime(latest.synced_at)}` : 'Never synced'}</strong>
            ${latest ? html`<span class="muted"> · ${qty(latest.active_count ?? 0)} products</span>` : ''}
          </p>
          <p class="muted">The system also syncs by itself every hour.</p>
          <button type="button" class="btn" data-act="sync" ${busy ? 'disabled' : ''}>${busy ? 'Syncing…' : 'Sync now'}</button>
          <button type="button" class="btn btn-sm" data-act="recheck" ${busy ? 'disabled' : ''}>Re-read the whole file</button>
        </section>
        ${resultCard()}
        <section class="card">
          <h3>Recent runs</h3>
          ${
            history.length
              ? html`<ul class="inv-list">
                  ${history.map(
                    (h) =>
                      html`<li class="inv-row">
                        <div class="inv-main">
                          <strong>${LABEL[h.result] ?? h.result}</strong>
                          <span class="muted">${dayTime(h.synced_at)} · ${h.source}</span>
                          ${h.status === 'ok' ? html`<span class="muted">${qty(h.item_count)} products · ${qty(h.added_count)} added · ${qty(h.changed_count)} changed · ${qty(h.removed_count)} removed</span>` : ''}
                          ${h.error ? html`<span class="muted">${String(h.error).slice(0, 160)}</span>` : ''}
                        </div>
                      </li>`,
                  )}
                </ul>`
              : html`<p class="muted">No runs yet.</p>`
          }
        </section>`,
    );
  }

  async function run(body) {
    if (busy) return;
    busy = true;
    result = null;
    draw();
    try {
      result = await syncNow(body);
    } catch {
      result = { ok: false, error: 'Could not reach the server.' };
    }
    busy = false;
    await load();
    draw();
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'sync') run({});
    if (act === 'recheck') run({ recheck: true });
    if (act === 'force') run({ recheck: true, confirmRemoval: true });
  });

  await load();
  draw();
}
