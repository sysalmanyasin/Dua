// Closing settings: strips, credit accounts and tier names, audit codes, the till float, the per-customer charge and the inventory-audit
// requirement. Every change goes through a logged database function. Strips and accounts are switched off, never deleted, and a
// closing keeps its own copy of the label and price, so a change here never alters a closing that is already submitted.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { errorCard, loadingCard, openDialog, toast } from './parts.js';

const M = (v) => money(v, { decimals: true });
const off = (r) => (r.active ? '' : html` <span class="cls-meta">(off)</span>`);

export async function mount(el) {
  let S = { strips: [], accounts: [], items: [], numbers: null, audit: null };

  async function load() {
    render(el, loadingCard());
    try {
      const [strips, accounts, items, numbers, audit] = await Promise.all([
        api.listStripsAll(),
        api.listAccountsAll(),
        api.listAuditItemsAll(),
        api.readClosingSettings(),
        api.readAuditRequired(),
      ]);
      S = { strips, accounts, items, numbers, audit };
    } catch (e) {
      return render(el, errorCard('the settings', friendlyError(e).message));
    }
    draw();
  }

  /** Opens a small form; `fields` are { id, label, type, value, options? }; `onSave(values)` must throw to keep the form open. */
  function form(title, fields, onSave) {
    const dlg = openDialog(
      html`<h2>${title}</h2>
        ${fields.map((f) =>
          f.type === 'checkbox'
            ? html`<div class="field">
                <label><input type="checkbox" id="f-${f.id}" ${f.value ? 'checked' : ''} /> ${f.label}</label>
              </div>`
            : f.type === 'select'
              ? html`<div class="field">
                  <label for="f-${f.id}">${f.label}</label
                  ><select id="f-${f.id}">
                    ${f.options.map((o) => html`<option value="${o.v}" ${String(o.v) === String(f.value) ? 'selected' : ''}>${o.t}</option>`)}
                  </select>
                </div>`
              : html`<div class="field">
                  <label for="f-${f.id}">${f.label}</label
                  ><input id="f-${f.id}" type="${f.type ?? 'text'}" value="${f.value ?? ''}" ${f.readonly ? 'readonly' : ''} />
                </div>`,
        )}
        <div class="actions">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="f-save">Save</button>
        </div>`,
      { label: title },
    );
    dlg.querySelector('#f-save').addEventListener('click', async () => {
      const v = {};
      for (const f of fields) {
        const n = dlg.querySelector(`#f-${f.id}`);
        v[f.id] = f.type === 'checkbox' ? n.checked : n.value;
      }
      try {
        await onSave(v);
      } catch (e) {
        return toast(friendlyError(e).message, 'error');
      }
      dlg.close();
      toast('Saved.');
      load();
    });
  }

  const editStrip = (r) =>
    form(
      r ? 'Edit strip' : 'Add strip',
      [
        { id: 'label', label: 'Name', value: r?.label },
        { id: 'group', label: 'Group', value: r?.group_name ?? '' },
        { id: 'price', label: 'Price', type: 'number', value: r?.price ?? '' },
        { id: 'sort', label: 'Order', type: 'number', value: r?.sort ?? 0 },
        { id: 'active', label: 'In use', type: 'checkbox', value: r ? r.active : true },
      ],
      (v) =>
        api.saveStrip({
          id: r?.id,
          label: v.label,
          group_name: v.group,
          price: Number(v.price),
          sort: Number(v.sort) || 0,
          active: v.active,
        }),
    );

  const editAccount = (r) =>
    form(
      r ? 'Edit credit account' : 'Add credit account',
      [
        {
          id: 'kind',
          label: 'Type',
          type: 'select',
          value: r?.kind ?? 'named',
          options: [
            { v: 'named', t: 'Named account' },
            { v: 'tier_name', t: 'Staff tier name' },
          ],
        },
        {
          id: 'tier',
          label: 'Tier (staff tier names only)',
          type: 'select',
          value: r?.tier_no ?? '',
          options: [
            { v: '', t: 'Not a tier' },
            { v: 1, t: 'Tier 1' },
            { v: 2, t: 'Tier 2' },
            { v: 3, t: 'Tier 3' },
          ],
        },
        { id: 'label', label: 'Name', value: r?.label },
        { id: 'sort', label: 'Order', type: 'number', value: r?.sort ?? 0 },
        { id: 'active', label: 'In use', type: 'checkbox', value: r ? r.active : true },
      ],
      (v) =>
        api.saveAccount({
          id: r?.id,
          kind: v.kind,
          tier_no: v.tier === '' ? null : Number(v.tier),
          label: v.label,
          sort: Number(v.sort) || 0,
          active: v.active,
        }),
    );

  const editItem = (r) =>
    form(
      r ? 'Edit audit code' : 'Add audit code',
      [
        { id: 'code', label: 'Code', value: r?.code, readonly: !!r },
        { id: 'name', label: 'Name', value: r?.name },
        { id: 'sort', label: 'Order', type: 'number', value: r?.sort ?? 0 },
        { id: 'active', label: 'In use', type: 'checkbox', value: r ? r.active : true },
      ],
      (v) => api.saveAuditItem({ code: v.code.trim(), name: v.name, sort: Number(v.sort) || 0, active: v.active }),
    );

  const editNumber = (key, label) =>
    form(
      `Change ${label}`,
      [
        { id: 'value', label, type: 'number', value: S.numbers?.[key] ?? '' },
        { id: 'reason', label: 'Reason for the change' },
      ],
      (v) => {
        if (v.value === '') throw Object.assign(new Error('bad'), { hint: 'bad_value' });
        return api.setClosingSetting(key, Number(v.value), v.reason);
      },
    );

  const toggleAudit = () =>
    form(S.audit ? 'Switch the inventory audit off' : 'Switch the inventory audit on', [{ id: 'reason', label: 'Reason' }], (v) => {
      if (v.reason.trim().length < 3) throw Object.assign(new Error('r'), { hint: 'reason_required' });
      return api.setAuditRequired(!S.audit, v.reason.trim());
    });

  function draw() {
    const named = S.accounts.filter((a) => a.kind === 'named');
    const tiers = S.accounts.filter((a) => a.kind === 'tier_name');
    render(
      el,
      html`<div class="cls">
        ${hero({ label: 'Closing', title: 'Closing settings', sub: 'Changes are logged. Submitted closings are never altered.' })}
        <div class="cls-grid">
          <section class="card" id="set-numbers">
            <h2>Numbers</h2>
            <ul class="cls-list">
              <li>
                <span>Till float<br /><span class="cls-meta">${S.numbers ? M(S.numbers.till_float) : 'Not visible to you'}</span></span
                ><button type="button" class="btn btn-sm" data-num="till_float" data-label="till float">Change</button>
              </li>
              <li>
                <span
                  >Charge per customer<br /><span class="cls-meta"
                    >${S.numbers ? M(S.numbers.per_customer_charge) : 'Not visible to you'}</span
                  ></span
                ><button type="button" class="btn btn-sm" data-num="per_customer_charge" data-label="charge per customer">Change</button>
              </li>
              <li>
                <span
                  >Inventory audit required to submit<br /><span class="cls-meta"
                    >${S.audit === null ? 'Not visible to you' : S.audit ? 'Yes' : 'No'}</span
                  ></span
                ><button type="button" class="btn btn-sm" id="set-audit">Change</button>
              </li>
            </ul>
          </section>
          <section class="card" id="set-strips">
            <h2>Strips</h2>
            <ul class="cls-list">
              ${S.strips.map(
                (r) =>
                  html`<li>
                    <span>${r.label}${off(r)}<br /><span class="cls-meta">${r.group_name || 'No group'} · ${M(r.price)}</span></span
                    ><button type="button" class="btn btn-sm" data-strip="${r.id}">Edit</button>
                  </li>`,
              )}
            </ul>
            ${S.strips.length ? '' : html`<p class="muted">No strips yet.</p>`}
            <div class="actions"><button type="button" class="btn btn-sm" id="add-strip">Add strip</button></div>
          </section>
          <section class="card" id="set-accounts">
            <h2>Credit accounts</h2>
            <ul class="cls-list">
              ${named.map((r) => html`<li><span>${r.label}${off(r)}</span><button type="button" class="btn btn-sm" data-acct="${r.id}">Edit</button></li>`)}
            </ul>
            <h3 class="sec-label">Staff tier names</h3>
            <ul class="cls-list">
              ${tiers.map((r) => html`<li><span>Tier ${r.tier_no}: ${r.label}${off(r)}</span><button type="button" class="btn btn-sm" data-acct="${r.id}">Edit</button></li>`)}
            </ul>
            <div class="actions"><button type="button" class="btn btn-sm" id="add-acct">Add account or tier</button></div>
          </section>
          <section class="card" id="set-items">
            <h2>Audit codes</h2>
            <ul class="cls-list">
              ${S.items.map(
                (r) =>
                  html`<li>
                    <span>${r.code}${off(r)}<br /><span class="cls-meta">${r.name}</span></span
                    ><button type="button" class="btn btn-sm" data-item="${r.code}">Edit</button>
                  </li>`,
              )}
            </ul>
            ${S.items.length ? '' : html`<p class="muted">No audit codes yet.</p>`}
            <div class="actions"><button type="button" class="btn btn-sm" id="add-item">Add audit code</button></div>
          </section>
          <section class="card">
            <p class="cls-meta"><a href="#/closing">Back to Closing</a></p>
          </section>
        </div>
      </div>`,
    );
    const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => fn(b)));
    on('[data-num]', (b) => editNumber(b.dataset.num, b.dataset.label));
    on('#set-audit', toggleAudit);
    on('[data-strip]', (b) => editStrip(S.strips.find((r) => r.id === b.dataset.strip)));
    on('#add-strip', () => editStrip(null));
    on('[data-acct]', (b) => editAccount(S.accounts.find((r) => r.id === b.dataset.acct)));
    on('#add-acct', () => editAccount(null));
    on('[data-item]', (b) => editItem(S.items.find((r) => r.code === b.dataset.item)));
    on('#add-item', () => editItem(null));
  }
  await load();
}
