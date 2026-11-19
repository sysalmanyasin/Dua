// Expiry Tracking: log near-expiry stock, and search the shared register. Entries are locked when saved; the owner can reopen,
// edit or delete them. The month window, rack rules and locking are the database's; this screen only asks and shows.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { checkEntry, monthLabel, monthOptions, newKey, STATUSES } from '../domain/expiry.js';
import { errorCard, loadingCard, toast } from './parts.js';

const PAGE = 50;
const SEARCH_DELAY = 250;

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const can = (k) => perms.includes(k) || perms.includes('audit.manage');
  const canLog = perms.includes('audit.expiry_log') || perms.includes('audit.expiry_manage');
  const owner = can('audit.expiry_manage');
  const s = {
    tab: canLog ? 'log' : 'register',
    ov: null,
    // the logging form
    pq: '',
    found: [],
    product: null,
    qty: '',
    month: '',
    rack: '',
    status: 'Near Expiry',
    key: newKey(),
    // the register
    rq: '',
    rmonth: '',
    rstatus: '',
    rows: [],
    total: 0,
    page: 0,
    editing: null,
    deleting: null,
    reason: '',
    busy: false,
    error: null,
  };
  let timer = null;
  const months = () => monthOptions(s.ov.current_month);

  async function loadRegister() {
    const rows = await api.searchExpiry({ query: s.rq, month: s.rmonth, status: s.rstatus, limit: PAGE, offset: s.page * PAGE });
    s.rows = rows;
    s.total = rows.length ? Number(rows[0].total) : 0;
  }

  const statusOptions = (cur) => STATUSES.map((x) => html`<option value="${x}" ${x === cur ? 'selected' : ''}>${x}</option>`);
  const monthSelect = (field, cur, blank) =>
    html`<select data-field="${field}">
      ${blank ? html`<option value="">${blank}</option>` : ''}
      ${months().map((m) => html`<option value="${m.value}" ${m.value === cur ? 'selected' : ''}>${m.label}</option>`)}
    </select>`;
  const rackSelect = (field, cur, racks) =>
    html`<select data-field="${field}">
      <option value="">Choose…</option>
      ${racks.map((r) => html`<option value="${r}" ${r === cur ? 'selected' : ''}>${r}</option>`)}
    </select>`;

  function logTab() {
    const mine = s.ov.my_racks;
    return html`<section class="card aud-card" aria-label="Log near-expiry stock">
      <h2>Log near-expiry stock</h2>
      ${
        s.product
          ? html`<p>
              <strong>${s.product.name}</strong><br /><span class="muted small">${s.product.company} · ${s.product.code || 'no code'}</span>
              <button type="button" class="btn btn-sm btn-ghost" data-act="clear-product">Change</button>
            </p>`
          : html`<label class="field"
                ><span>Product</span
                ><input type="search" data-field="pq" value="${s.pq}" placeholder="Name, code or generic" autocomplete="off"
              /></label>
              ${
                s.found.length
                  ? html`<ul class="aud-list">
                      ${s.found.map(
                        (p) =>
                          html`<li>
                            <button type="button" class="btn btn-ghost btn-sm" data-act="pick" data-id="${p.id}">
                              <strong>${p.name}</strong> <span class="muted small">${p.company} · ${p.code}</span>
                            </button>
                          </li>`,
                      )}
                    </ul>`
                  : s.pq.trim().length >= 2
                    ? html`<p class="muted small">No product found.</p>`
                    : ''
              }`
      }
      <label class="field"><span>Quantity</span><input type="text" inputmode="decimal" data-field="qty" value="${s.qty}" /></label>
      <label class="field"><span>Expires in</span>${monthSelect('month', s.month, 'Choose…')}</label>
      <label class="field"><span>Rack</span>${rackSelect('rack', s.rack, mine)}</label>
      ${mine.length === 0 ? html`<p class="note" role="status">No racks have been set up yet. Ask the owner to add them.</p>` : ''}
      <label class="field"
        ><span>Status</span
        ><select data-field="status">
          ${statusOptions(s.status)}
        </select></label
      >
      <div class="aud-actions">
        <button type="button" class="btn btn-primary" data-act="save" ${s.busy ? 'disabled' : ''}>Save entry</button>
      </div>
      <p class="muted small">Once saved, an entry is locked. Only the owner can change it.</p>
    </section>`;
  }

  function editRow(r) {
    return html`<tr>
      <td colspan="5">
        <strong>${r.product_name}</strong>
        <div class="aud-edit">
          <label class="field"
            ><span>Quantity</span><input type="text" inputmode="decimal" data-edit="qty" value="${s.editing.qty}"
          /></label>
          <label class="field"
            ><span>Expires in</span>${html`<select data-edit="month">
              ${months().map((m) => html`<option value="${m.value}" ${m.value === s.editing.month ? 'selected' : ''}>${m.label}</option>`)}
            </select>`}</label
          >
          <label class="field"
            ><span>Rack</span>${html`<select data-edit="rack">
              ${s.ov.racks.map((k) => html`<option value="${k.name}" ${k.name === s.editing.rack ? 'selected' : ''}>${k.name}${k.active ? '' : ' (off)'}</option>`)}
            </select>`}</label
          >
          <label class="field"
            ><span>Status</span
            ><select data-edit="status">
              ${statusOptions(s.editing.status)}
            </select></label
          >
          <div class="aud-actions">
            <button type="button" class="btn btn-sm btn-primary" data-act="save-edit" ${s.busy ? 'disabled' : ''}>Save and lock</button>
            <button type="button" class="btn btn-sm btn-ghost" data-act="cancel-edit">Cancel</button>
          </div>
        </div>
      </td>
    </tr>`;
  }

  function rowView(r) {
    if (s.editing?.id === r.id) return editRow(r);
    const del = s.deleting === r.id;
    return html`<tr>
      <td>
        <strong>${r.product_name}</strong><br /><span class="muted small"
          >${r.product_code || 'no code'} · ${r.staff_name}${r.locked ? '' : ' · open for editing'}</span
        >
      </td>
      <td class="num">${Number(r.quantity)}</td>
      <td>${monthLabel(r.expiry_month)}</td>
      <td>${r.rack_location}</td>
      <td>
        ${r.status}${
          owner
            ? html`<div class="aud-actions no-print">
                  ${
                    r.locked
                      ? html`<button type="button" class="btn btn-sm btn-ghost" data-act="reopen" data-id="${r.id}">Reopen</button>`
                      : html`<button type="button" class="btn btn-sm btn-ghost" data-act="edit" data-id="${r.id}">Edit</button>`
                  }
                  <button type="button" class="btn btn-sm btn-ghost" data-act="delete" data-id="${r.id}">Delete</button>
                </div>
                ${
                  del
                    ? html`<label class="field"
                          ><span>Reason for deleting</span><input type="text" data-field="reason" maxlength="500" value="${s.reason}"
                        /></label>
                        <button
                          type="button"
                          class="btn btn-sm btn-primary"
                          data-act="delete-yes"
                          data-id="${r.id}"
                          ${s.busy ? 'disabled' : ''}
                        >
                          Delete for good
                        </button>`
                    : ''
                }`
            : ''
        }
      </td>
    </tr>`;
  }

  function registerTab() {
    const pages = Math.max(1, Math.ceil(s.total / PAGE));
    return html`<section class="card aud-card" aria-label="Register">
      <h2>Register</h2>
      <label class="field"
        ><span>Search</span><input type="search" data-field="rq" value="${s.rq}" placeholder="Product name or code" autocomplete="off"
      /></label>
      <div class="aud-filters">
        <label class="field"><span>Month</span>${monthSelect('rmonth', s.rmonth, 'Any month')}</label>
        <label class="field"
          ><span>Status</span
          ><select data-field="rstatus">
            <option value="">Any status</option>
            ${statusOptions(s.rstatus)}
          </select></label
        >
      </div>
      <p class="muted small">${s.total} entr${s.total === 1 ? 'y' : 'ies'}</p>
      ${
        s.rows.length
          ? html`<div class="aud-scroll">
              <table class="aud-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th class="num">Qty</th>
                    <th>Expires</th>
                    <th>Rack</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${s.rows.map(rowView)}
                </tbody>
              </table>
            </div>`
          : html`<p class="muted">Nothing logged yet.</p>`
      }
      <div class="aud-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-act="prev" ${s.page === 0 ? 'disabled' : ''}>Previous</button>
        <span class="muted small">Page ${s.page + 1} of ${pages}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-act="next" ${s.page + 1 >= pages ? 'disabled' : ''}>Next</button>
      </div>
    </section>`;
  }

  function draw() {
    render(
      el,
      html`<div class="aud">
        ${hero({
          label: 'Audit',
          title: 'Expiry tracking',
          sub: 'Near-expiry stock, shared by everyone',
          actions: owner ? html`<a class="btn btn-ghost btn-sm" href="#/audit/expiry/racks">Racks</a>` : '',
        })}
        <div class="aud-tabs" role="tablist">
          ${canLog ? html`<button type="button" class="btn btn-sm ${s.tab === 'log' ? 'btn-primary' : 'btn-ghost'}" data-act="tab" data-tab="log">Log</button>` : ''}
          <button type="button" class="btn btn-sm ${s.tab === 'register' ? 'btn-primary' : 'btn-ghost'}" data-act="tab" data-tab="register">
            Register
          </button>
        </div>
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''} ${s.tab === 'log' ? logTab() : registerTab()}
      </div>`,
    );
  }

  async function run(fn, done) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      s.error = friendlyError(e).message;
    }
    s.busy = false;
    draw();
  }

  const searchLater = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        s.found = s.pq.trim().length >= 2 ? await api.expiryProducts(s.pq.trim()) : [];
      } catch (e) {
        s.error = friendlyError(e).message;
      }
      draw();
    }, SEARCH_DELAY);
  };

  el.oninput = (e) => {
    const f = e.target.dataset?.field;
    const edit = e.target.dataset?.edit;
    if (edit && s.editing) s.editing[edit] = e.target.value;
    else if (f === 'qty') s.qty = e.target.value;
    else if (f === 'reason') s.reason = e.target.value;
    else if (f === 'pq') {
      s.pq = e.target.value;
      searchLater();
    } else if (f === 'rq') {
      s.rq = e.target.value;
      s.page = 0;
      clearTimeout(timer);
      timer = setTimeout(() => run(loadRegister), SEARCH_DELAY);
    }
  };
  el.onchange = (e) => {
    const f = e.target.dataset?.field;
    const edit = e.target.dataset?.edit;
    if (edit && s.editing) {
      s.editing[edit] = e.target.value;
      return;
    }
    if (f === 'month' || f === 'rack' || f === 'status') s[f] = e.target.value;
    else if (f === 'rmonth' || f === 'rstatus') {
      s[f] = e.target.value;
      s.page = 0;
      return run(loadRegister);
    }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'tab':
        s.tab = b.dataset.tab;
        s.error = null;
        return s.tab === 'register' ? run(loadRegister) : draw();
      case 'pick':
        s.product = s.found.find((p) => p.id === id) ?? null;
        s.found = [];
        return draw();
      case 'clear-product':
        s.product = null;
        return draw();
      case 'save': {
        const problem = checkEntry({ product: s.product, qty: s.qty, month: s.month, rack: s.rack });
        if (problem) {
          s.error = problem;
          return draw();
        }
        return run(async () => {
          await api.logExpiry({ key: s.key, productId: s.product.id, qty: Number(s.qty), month: s.month, rack: s.rack, status: s.status });
          Object.assign(s, { product: null, pq: '', found: [], qty: '', status: 'Near Expiry', key: newKey() });
        }, 'Entry saved and locked.');
      }
      case 'prev':
      case 'next':
        s.page += b.dataset.act === 'next' ? 1 : -1;
        return run(loadRegister);
      case 'reopen':
        return run(async () => {
          await api.reopenExpiry(id);
          await loadRegister();
        }, 'Entry reopened.');
      case 'edit': {
        const r = s.rows.find((x) => x.id === id);
        s.editing = { id, qty: String(Number(r.quantity)), month: r.expiry_month, rack: r.rack_location, status: r.status };
        return draw();
      }
      case 'cancel-edit':
        s.editing = null;
        return draw();
      case 'save-edit': {
        const n = Number(s.editing.qty);
        if (!Number.isFinite(n) || n <= 0) {
          s.error = 'Enter a quantity above zero.';
          return draw();
        }
        return run(async () => {
          await api.updateExpiry({ id: s.editing.id, qty: n, month: s.editing.month, rack: s.editing.rack, status: s.editing.status });
          s.editing = null;
          await loadRegister();
        }, 'Entry saved and locked.');
      }
      case 'delete':
        s.deleting = s.deleting === id ? null : id;
        s.reason = '';
        return draw();
      case 'delete-yes':
        return run(async () => {
          await api.deleteExpiry(id, s.reason.trim());
          s.deleting = null;
          await loadRegister();
        }, 'Entry deleted.');
      default:
    }
  };

  render(el, loadingCard());
  try {
    s.ov = await api.expiryOverview();
    if (s.tab === 'register') await loadRegister();
  } catch (e) {
    return render(el, errorCard('expiry tracking', friendlyError(e).message));
  }
  draw();
}
