// Misc / Ongoing Ledger: charges that stay open from one closing to the next, aged from the day they first appeared.
// A charge is followed by its stable id, so renaming it does not restart its age (C8). Age is plain days; no thresholds are invented.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { daysText } from '../domain/ledgers.js';
import { slotLabel } from '../domain/slots.js';
import { errorCard, loadingCard } from './parts.js';

const amt = (v) => money(v, { decimals: true });

export async function mount(el) {
  render(el, loadingCard());
  let data;
  try {
    data = await api.miscLedger();
  } catch (e) {
    return render(el, errorCard('the Misc Ledger', friendlyError(e).message));
  }
  const open = data.open ?? [];
  const closed = data.closed ?? [];
  const asOf = data.as_of ? `${slotLabel(data.as_of.kind, data.as_of.seq)} · ${shortDate(data.as_of.business_date)}` : '';
  render(
    el,
    html`<div class="cls">
      ${hero({ label: 'Closing', title: 'Misc Ledger', sub: 'Charges still open, oldest first.' })}
      <div class="cls-grid">
        <section class="card">
          <p class="cls-meta">
            ${data.as_of ? html`As of the latest submitted closing: ${asOf}.` : html`No closing has been submitted yet.`}
            <a href="#/closing">Back to Closing</a>
          </p>
        </section>
        <section class="card" id="misc-open">
          <h2>Open charges</h2>
          ${
            open.length
              ? html`<ul class="cls-list">
                  ${open.map(
                    (c) =>
                      html`<li data-charge="${c.charge_id}">
                        <span
                          ><strong>${c.label || 'Charge'}</strong><br /><span class="cls-meta"
                            >Since ${shortDate(c.first_date)} · ${daysText(c.age_days)}</span
                          ></span
                        >
                        <strong>${amt(c.amount)}</strong>
                      </li>`,
                  )}
                </ul>`
              : html`<p class="muted">No open charges.</p>`
          }
        </section>
        <section class="card" id="misc-closed">
          <h2>Closed charges</h2>
          ${
            closed.length
              ? html`<ul class="cls-list">
                  ${closed.map(
                    (c) =>
                      html`<li data-charge="${c.charge_id}">
                        <span
                          ><strong>${c.label || 'Charge'}</strong><br /><span class="cls-meta"
                            >${shortDate(c.first_date)} to ${shortDate(c.last_date)} · open ${daysText(c.age_days)}</span
                          ></span
                        >
                        <span>${amt(c.amount)}</span>
                      </li>`,
                  )}
                </ul>`
              : html`<p class="muted">No closed charges yet.</p>`
          }
        </section>
      </div>
    </div>`,
  );
}
