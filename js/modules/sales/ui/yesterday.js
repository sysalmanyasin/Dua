// Last Day: what staff may see. Only the most recent closed day's total, nothing else.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { errorCard, loadingCard } from './parts.js';

export async function mount(el) {
  render(el, loadingCard());
  let r;
  try {
    r = await api.lastClosedDay();
  } catch {
    return render(el, errorCard('the last day'));
  }
  render(
    el,
    r
      ? html`${hero({ label: 'Sales', title: 'Last day', sub: longDate(r.business_date) })}
          <section class="card">
            <div class="total-card">
              <div><span class="label">TOTAL SALE</span><strong>${money(r.total)}</strong></div>
            </div>
          </section>`
      : html`${hero({ label: 'Sales', title: 'Last day', sub: 'No closed day yet.' })}`,
  );
}
