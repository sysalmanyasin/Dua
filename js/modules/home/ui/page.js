import { html, render } from '../../../shared/html.js';

export function mount(el, { ctx }) {
  const first = ctx.full_name.split(' ')[0];
  render(
    el,
    html`<section class="card">
      <h2>Welcome, ${first}</h2>
      <p class="muted">The foundation is running. More sections appear here as each phase is accepted.</p>
      <p class="small muted">
        Signed in as <strong>${ctx.username}</strong>. You have ${ctx.permissions.length}
        permission${ctx.permissions.length === 1 ? '' : 's'}.
      </p>
    </section>`,
  );
}
