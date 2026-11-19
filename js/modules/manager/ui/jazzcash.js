// Jazz Cash: the daily ledger (money held: Received adds, Transfer reduces) and the Balance Tally.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { mountLedgerPanel } from './ledgerPanel.js';
import { mountTally } from './tally.js';

export async function mount(el) {
  let tab = 'ledger';
  const show = async () => {
    render(
      el,
      html`${hero({ label: 'Manager', title: 'Jazz Cash', sub: tab === 'ledger' ? 'Daily ledger' : 'Balance tally' })}
        <div class="tabs-seg" role="tablist">
          <button type="button" role="tab" class="tab" aria-selected="${tab === 'ledger'}" data-tab="ledger">Daily Ledger</button>
          <button type="button" role="tab" class="tab" aria-selected="${tab === 'tally'}" data-tab="tally">Balance Tally</button>
        </div>
        <div id="panel"></div>`,
    );
    const host = el.querySelector('#panel');
    if (tab === 'ledger') await mountLedgerPanel(host, { code: 'jazzcash' });
    else await mountTally(host);
  };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t || t.dataset.tab === tab) return;
    tab = t.dataset.tab;
    show();
  });
  await show();
}
