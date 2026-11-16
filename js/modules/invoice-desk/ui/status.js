// Read-only registration placeholder. Replace only after a separately approved implementation slice.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';

export async function mount(el) {
  render(
    el,
    html`${hero({
      label: 'Module status',
      title: 'Invoice Desk',
      sub: 'In progress · Phase 0 registration and specification',
    })}
    <section class="panel">
      <h2>Implementation has not started</h2>
      <p>This module is registered so other development sessions can see its ownership and current status.</p>
      <p>The approved brief and handoff are in <code>docs/modules/invoice-desk.md</code> and <code>docs/modules/invoice-desk.progress.md</code>.</p>
      <p>No invoice data, database tables, permissions, or invoice workflows have been created.</p>
    </section>`,
  );
}
