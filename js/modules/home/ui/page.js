import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';

export function mount(el, { ctx }) {
  const first = ctx.full_name.split(' ')[0];
  render(
    el,
    html`${hero({ label: 'Home', title: `Welcome, ${first}`, sub: 'More sections appear here as each phase is accepted.' })}
      <section class="card">
        <h2>Your access</h2>
        <p class="small muted">
          Signed in as <strong>${ctx.username}</strong>. You have ${ctx.permissions.length}
          permission${ctx.permissions.length === 1 ? '' : 's'}.
        </p>
      </section>`,
  );
}
