// Expenses: the credit Head Office owes the branch. Every expense adds to it; cash received from Head Office reduces it.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { mountLedgerPanel } from './ledgerPanel.js';

export async function mount(el) {
  render(
    el,
    html`${hero({ label: 'Manager', title: 'Expenses', sub: 'What Head Office owes you' })}
      <div id="panel"></div>`,
  );
  await mountLedgerPanel(el.querySelector('#panel'), { code: 'expense' });
}
