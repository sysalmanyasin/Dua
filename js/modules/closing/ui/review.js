// Review: the submitted closings with their stored headline figures, and "Reopen to correct" (CLS-7). Reopening makes a new draft
// revision of the same slot; the original stays as submitted until the corrected one is submitted, and the reason is kept.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { pageTitle, variance } from '../domain/book.js';
import { groupByDate } from '../domain/ledgers.js';
import { newKey, setOpen } from '../domain/store.js';
import { errorCard, loadingCard, openDialog, toast } from './parts.js';

const M = (v) => money(v, { decimals: true });

export async function mount(el, { ctx } = {}) {
  const canCorrect = (ctx?.permissions ?? []).includes('closing.correct');
  let pages = [];

  const reopenDialog = (p) => {
    const dlg = openDialog(
      html`<h2>Reopen ${pageTitle(p)}</h2>
        <p class="muted">A new draft is made for you to correct. The original stays as it is until the corrected closing is submitted.</p>
        <div class="field">
          <label for="ro-reason">Why is it being corrected?</label><textarea id="ro-reason" rows="3" maxlength="300"></textarea>
        </div>
        <div class="actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="ro-go">Reopen</button>
        </div>`,
      { label: 'Reopen closing' },
    );
    dlg.querySelector('#ro-go').addEventListener('click', async () => {
      const reason = dlg.querySelector('#ro-reason').value.trim();
      if (reason.length < 3) return toast('Please write a reason (at least 3 letters).', 'error');
      const key = newKey();
      try {
        await api.reopen({ closingId: p.closing_id, reason, key });
      } catch (e) {
        return toast(friendlyError(e).message, 'error');
      }
      dlg.close();
      setOpen({
        key,
        date: p.business_date,
        kind: p.kind,
        mode: p.mode,
        handoverSeq: p.kind === 'handover' ? p.seq : undefined,
        opening: !!p.is_opening,
      });
      location.hash = '#/closing/ledger';
    });
  };

  const draw = () => {
    const groups = groupByDate(pages);
    render(
      el,
      html`<div class="cls">
        ${hero({ label: 'Closing', title: 'Review', sub: 'Submitted closings and their stored figures.' })}
        <div class="cls-grid">
          <section class="card">
            <p class="cls-meta">
              The 30 most recent. <a href="#/closing/book">Open the Closing Book</a> · <a href="#/closing">Back to Closing</a>
            </p>
          </section>
          ${
            groups.length
              ? groups.map(
                  (g) =>
                    html`<section class="card" data-date="${g.date}">
                      <h2>${shortDate(g.date)}</h2>
                      ${g.items.map(
                        (p) =>
                          html`<article class="cls-snap" data-closing="${p.closing_id}">
                            <header>
                              <strong>${pageTitle(p)}</strong>
                              <span class="cls-meta">${p.staff ?? ''}</span>
                            </header>
                            <dl class="cls-kv">
                              <div>
                                <dt>Net sale</dt>
                                <dd>${M(p.results?.net_sale)}</dd>
                              </div>
                              <div>
                                <dt>Net cash</dt>
                                <dd>${M(p.results?.net_cash)}</dd>
                              </div>
                              <div>
                                <dt>Variance</dt>
                                <dd>${variance(p.results?.shift_variance)}</dd>
                              </div>
                            </dl>
                            ${p.correction_reason ? html`<p class="cls-meta">Corrected because: ${p.correction_reason}</p>` : ''}
                            ${
                              canCorrect
                                ? html`<div class="actions">
                                    <button type="button" class="btn btn-sm" data-act="reopen" data-id="${p.closing_id}">
                                      Reopen to correct
                                    </button>
                                  </div>`
                                : ''
                            }
                          </article>`,
                      )}
                    </section>`,
                )
              : html`<section class="card"><p class="muted">No submitted closings yet.</p></section>`
          }
        </div>
      </div>`,
    );
    el.querySelectorAll('[data-act="reopen"]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = pages.find((x) => x.closing_id === b.dataset.id);
        if (p) reopenDialog(p);
      }),
    );
  };

  render(el, loadingCard());
  try {
    pages = await api.closingBook({ limit: 30 });
  } catch (e) {
    return render(el, errorCard('the review list', friendlyError(e).message));
  }
  draw();
}
