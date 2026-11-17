// Misc Sections: ledgers of the owner's own, each with the owner's own categories ("adds" or "reduces"). Same engine as Expenses
// and Jazz Cash.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { balanceMessage } from '../domain/ledger.js';
import { mountLedgerPanel } from './ledgerPanel.js';
import { errorCard, loadingCard, newKey, openDialog, toast } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });

export async function mount(el) {
  const state = { sections: null, openId: null, error: false };

  async function load() {
    try {
      state.sections = (await api.ledgersList()).filter((l) => l.kind === 'misc');
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  async function paint() {
    if (state.error) return render(el, errorCard('the sections'));
    if (!state.sections) return render(el, loadingCard());
    if (state.openId) {
      const s = state.sections.find((x) => x.ledger_id === state.openId);
      render(
        el,
        html`${hero({ label: 'Manager', title: s?.name ?? 'Section', actions: html`<button type="button" class="btn btn-ghost btn-sm" data-act="back">‹ All sections</button>` })}
          <div id="panel"></div>`,
      );
      return mountLedgerPanel(el.querySelector('#panel'), { id: state.openId });
    }
    render(
      el,
      html`${hero({ label: 'Manager', title: 'Misc Sections', sub: `${state.sections.length} section${state.sections.length === 1 ? '' : 's'}`, actions: html`<button type="button" class="btn btn-primary" data-act="new">+ New section</button>` })}
      ${
        state.sections.length
          ? state.sections.map((s) => {
              const bm = balanceMessage(s, s.balance);
              return html`<button type="button" class="card mg-person" data-act="open" data-id="${s.ledger_id}">
                <span class="mg-name"
                  ><strong>${s.name}</strong><small class="muted">${s.categories.map((c) => c.name).join(', ')}</small></span
                >
                <span class="mg-net"><strong>${bm.amount ? m(bm.amount) : 'Settled'}</strong></span>
              </button>`;
            })
          : html`<div class="card"><p class="muted">No sections yet. A section is a ledger of your own, with your own categories.</p></div>`
      }`,
    );
  }

  function newSection() {
    const rows = [
      { name: '', direction: '1' },
      { name: '', direction: '-1' },
    ];
    let key = null;
    const dlg = openDialog(html`<div id="sec"></div>`, { label: 'New section' });
    const host = dlg.querySelector('#sec');
    const view = () =>
      html`<h2>New section</h2>
        <p class="muted small">Each category either adds to the balance or reduces it. That can never be changed later.</p>
        <label class="field"><span>Section name</span><input id="sec-name" maxlength="40" /></label>
        ${rows.map(
          (r, i) =>
            html`<div class="mg-line">
              <input data-n="${i}" value="${r.name}" maxlength="40" placeholder="Category name" />
              <select data-d="${i}">
                <option value="1" ${r.direction === '1' ? 'selected' : ''}>Adds</option>
                <option value="-1" ${r.direction === '-1' ? 'selected' : ''}>Reduces</option>
              </select>
              <button type="button" class="btn btn-ghost btn-sm" data-act="delrow" data-i="${i}" aria-label="Remove category">×</button>
            </div>`,
        )}
        <p class="small"><button type="button" class="link" data-act="addrow">+ Add category</button></p>
        <small class="err" id="sec-err" hidden></small>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button
          ><button type="button" class="btn btn-primary" data-ok>Create section</button>
        </div>`;
    const paintDlg = () => render(host, view());
    paintDlg();
    dlg.addEventListener('input', (e) => {
      key = null;
      if (e.target.dataset.n !== undefined) rows[Number(e.target.dataset.n)].name = e.target.value;
      if (e.target.dataset.d !== undefined) rows[Number(e.target.dataset.d)].direction = e.target.value;
    });
    dlg.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-act], [data-ok]');
      if (!t) return;
      if (t.dataset.act === 'addrow') {
        const name = host.querySelector('#sec-name').value;
        rows.push({ name: '', direction: '1' });
        paintDlg();
        host.querySelector('#sec-name').value = name;
        return;
      }
      if (t.dataset.act === 'delrow') {
        const name = host.querySelector('#sec-name').value;
        rows.splice(Number(t.dataset.i), 1);
        paintDlg();
        host.querySelector('#sec-name').value = name;
        return;
      }
      if (t.dataset.ok === undefined) return;
      const name = host.querySelector('#sec-name').value.trim();
      const cats = rows.filter((r) => r.name.trim() !== '').map((r) => ({ name: r.name.trim(), direction: Number(r.direction) }));
      const err = (text) => {
        const box = host.querySelector('#sec-err');
        box.textContent = text;
        box.hidden = false;
      };
      if (!name) return err('Give the section a name.');
      if (cats.length === 0) return err('Add at least one category.');
      key ??= newKey();
      const { data, error } = await api.sectionCreate(name, cats, key);
      if (error) return err(error.message || 'Could not create the section.');
      dlg.close();
      toast('Section created');
      state.openId = data.id;
      await load();
    });
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'new') return newSection();
    if (t.dataset.act === 'open') {
      state.openId = t.dataset.id;
      return paint();
    }
    if (t.dataset.act === 'back') {
      state.openId = null;
      await load();
    }
  });

  render(el, loadingCard());
  await load();
}
