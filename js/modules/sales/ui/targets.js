// Targets: set the sales target for any month, and see how each month compares.
import { html, render } from '../../../shared/html.js';
import { money, monthLabel, parseAmount, todayPkt } from '../../../shared/format.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { targetProgress } from '../domain/saleReport.js';
import { errorCard, loadingCard, toast } from './parts.js';

const addMonths = (key, n) => {
  const d = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export async function mount(el) {
  render(el, loadingCard());
  let months;
  let targets;
  try {
    const [m, t] = await Promise.all([api.listMonthlyFull(), api.listTargets()]);
    months = new Map(m.map((r) => [String(r.month).slice(0, 7), Number(r.total)]));
    targets = new Map(t.map((r) => [String(r.month).slice(0, 7), Number(r.target)]));
  } catch {
    return render(el, errorCard('the targets'));
  }
  const now = todayPkt().slice(0, 7);
  const keys = Array.from({ length: 27 }, (_, i) => addMonths(now, 3 - i)); // 3 months ahead, then 23 back

  function draw() {
    render(
      el,
      html` ${hero({ label: 'Settings', title: 'Sales Targets', sub: 'Enter a target for each month. The Sale Report card, Index and Dashboard use these.' })}
        <section class="card">
          <table class="table">
            <thead>
              <tr>
                <th>Month</th>
                <th class="num">Sold</th>
                <th>Target (₨)</th>
                <th class="num">Reached</th>
              </tr>
            </thead>
            <tbody>
              ${keys.map((k) => {
                const sold = months.get(k) ?? 0;
                const p = targetProgress(targets.get(k), sold);
                return html`<tr>
                  <td>${monthLabel(`${k}-01`)}</td>
                  <td class="num">${sold ? money(sold) : '–'}</td>
                  <td>
                    <input
                      class="tg-in"
                      inputmode="numeric"
                      data-month="${k}"
                      value="${targets.get(k) ?? ''}"
                      placeholder="not set"
                      aria-label="Target for ${monthLabel(`${k}-01`)}"
                    />
                  </td>
                  <td class="num ${p ? `tg-${p.tone}` : ''}">${p ? `${p.pct}%` : '–'}</td>
                </tr>`;
              })}
            </tbody>
          </table>
          <p class="muted small">Leave a box empty to remove that month's target. Changes save when you leave the box.</p>
        </section>`,
    );
  }

  el.addEventListener('change', async (e) => {
    const i = e.target.closest('input[data-month]');
    if (!i) return;
    const key = i.dataset.month;
    const v = parseAmount(i.value);
    if (Number.isNaN(v) || (v !== null && v <= 0)) {
      i.value = targets.get(key) ?? '';
      return toast('Enter a number above zero, or leave it empty.', 'error');
    }
    const { error } = await api.setTarget(`${key}-01`, v);
    if (error) return toast('Could not save the target.', 'error');
    if (v === null) targets.delete(key);
    else targets.set(key, v);
    toast(v === null ? 'Target removed' : 'Target saved');
    draw();
  });
  draw();
}
