// The Barcode Center's working tabs: Register, To verify, Conflicts and All barcodes. The rules (who may register, that a second
// claim never replaces the first, that only an administrator settles a conflict, that every decision has a reason and is logged)
// are the database's. This file asks, and shows what came back in plain words.
import { html, render } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { cleanBarcode, guessType, isValidBarcode } from '../domain/barcode.js';
import { friendlyError } from '../domain/errors.js';
import { exportBarcodes } from './exports.js';
import { toast } from './parts.js';

const PAGE = 50;
const SEARCH_DELAY = 250;
const STATUS = { unverified: 'Not verified yet', verified: 'Verified', conflict: 'In conflict', disabled: 'Switched off' };
const TYPES = [
  ['unknown', 'Not sure'],
  ['ean13', 'EAN-13'],
  ['ean8', 'EAN-8'],
  ['upca', 'UPC-A'],
  ['code128', 'Code 128'],
  ['code39', 'Code 39'],
  ['itf', 'ITF'],
  ['qr', 'QR code'],
  ['other', 'Other'],
];
export const OUTCOME = {
  created: (b, p) => `Saved: ${b} now points to ${p}. It is not verified yet. Someone has to check it before it can be relied on.`,
  exists: () => 'This barcode is already registered for that product. Nothing changed.',
  conflict: () =>
    'This barcode already belongs to a different product. Nothing was changed. It is listed under Conflicts for a person with barcode administration to decide.',
  disabled: () => 'This barcode was switched off. Ask a person with barcode administration to switch it on first.',
};
export const reasonOk = (t) => String(t ?? '').trim().length >= 3;

// One tab is open at a time; leaving a tab forgets its form.
const S = { tab: null, busy: false };
let timer = null;
/** Forget the open tab's form, so the next visit starts clean (and a handed-over barcode is picked up). */
export const resetAdminTab = () => {
  S.tab = null;
  clearTimeout(timer);
};

function fresh(tab, ctx) {
  Object.assign(S, {
    tab,
    busy: false,
    rows: [],
    total: 0,
    page: 0,
    q: '',
    status: '',
    error: null,
    // register
    barcode: '',
    type: 'unknown',
    pq: '',
    found: [],
    product: null,
    notes: '',
    outcome: null,
    // admin panels on a row
    panel: null,
    reason: '',
    history: null,
  });
  const pre = ctx.prefill();
  if (tab === 'register' && pre) {
    S.barcode = pre.barcode;
    S.type = guessType(pre.barcode, pre.format);
    ctx.clearPrefill();
  }
}

export async function mountAdminTab(tab, ctx) {
  if (S.tab !== tab) fresh(tab, ctx);
  const el = ctx.el;
  const admin = ctx.isAdmin;

  async function load() {
    try {
      const status = tab === 'queue' ? 'unverified' : tab === 'conflicts' ? 'conflict' : S.status;
      const rows = await api.listBarcodes({ status, query: S.q, limit: PAGE, offset: S.page * PAGE });
      S.rows = rows;
      S.total = rows.length ? Number(rows[0].total) : 0;
      S.error = null;
    } catch (e) {
      S.error = friendlyError(e).message;
    }
  }

  const err = () => (S.error ? html`<p class="note note-error" role="alert">${S.error}</p>` : '');
  const pager = () => {
    const pages = Math.max(1, Math.ceil(S.total / PAGE));
    return S.total > PAGE
      ? html`<div class="aud-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="prev" ${S.page === 0 ? 'disabled' : ''}>Previous</button>
          <span class="muted small">Page ${S.page + 1} of ${pages} · ${S.total} barcodes</span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="next" ${S.page + 1 >= pages ? 'disabled' : ''}>Next</button>
        </div>`
      : '';
  };
  const productPicker = (field) =>
    S.product
      ? html`<p>
          <strong>${S.product.name}</strong><br /><span class="muted small">${S.product.company} · ${S.product.code}</span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="clear-product">Change</button>
        </p>`
      : html`<label class="field"
            ><span>Product</span
            ><input type="search" data-f="${field}" value="${S.pq}" placeholder="Name, code or generic" autocomplete="off"
          /></label>
          <div id="bc-found">${foundList()}</div>`;
  function foundList() {
    if (S.found.length > 0) {
      return html`<ul class="aud-list">
        ${S.found.map(
          (p) =>
            html`<li>
              <button type="button" class="btn btn-ghost btn-sm" data-act="pick" data-id="${p.id}">
                <strong>${p.name}</strong>
                <span class="muted small"
                  >${p.company} · ${p.code || 'no code'}${p.barcodes ? ` · ${p.barcodes} barcode${p.barcodes === 1 ? '' : 's'}` : ''}</span
                >
              </button>
            </li>`,
        )}
      </ul>`;
    }
    return S.pq.trim().length >= 2 ? html`<p class="muted small">No product found.</p>` : '';
  }

  // ───────── Register ─────────
  const registerTab = () =>
    html`<section class="card aud-card" aria-label="Register a barcode">
      <h2>Register a barcode</h2>
      ${
        S.outcome
          ? html`<p class="note ${S.outcome.kind === 'created' || S.outcome.kind === 'exists' ? '' : 'note-error'}" role="status">
              ${S.outcome.text}
            </p>`
          : ''
      }
      ${err()}
      <label class="field"
        ><span>Barcode</span
        ><input
          type="text"
          data-f="barcode"
          value="${S.barcode}"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="60"
      /></label>
      <div class="aud-actions"><button type="button" class="btn btn-sm" data-act="scan">Scan it</button></div>
      <label class="field"
        ><span>Type</span
        ><select data-f="type">
          ${TYPES.map(([v, t]) => html`<option value="${v}" ${S.type === v ? 'selected' : ''}>${t}</option>`)}
        </select></label
      >
      ${productPicker('pq')}
      <label class="field"><span>Note (optional)</span><input type="text" data-f="notes" maxlength="500" value="${S.notes}" /></label>
      <div class="aud-actions">
        <button type="button" class="btn btn-primary" data-act="register" ${S.busy ? 'disabled' : ''}>Register barcode</button>
      </div>
      <p class="muted small">
        A new barcode starts as not verified. A second look turns it into a verified barcode that counters can rely on.
      </p>
    </section>`;

  // ───────── To verify / Conflicts / All barcodes ─────────
  const badge = (st) => html`<span class="aud-badge aud-badge-${st}">${STATUS[st] ?? st}</span>`;
  const rowHead = (r) =>
    html`<strong>${r.barcode}</strong> ${badge(r.status)}<br /><span class="muted small"
        >${r.product_name} · ${r.product_code}${r.registered_by_name ? ` · registered by ${r.registered_by_name}` : ''}</span
      >`;

  const queueTab = () =>
    html`<section class="card aud-card" aria-label="Barcodes to verify">
      <h2>To verify</h2>
      ${err()}
      ${
        S.rows.length === 0
          ? html`<p class="muted">Nothing is waiting to be verified.</p>`
          : html`<ul class="aud-list">
              ${S.rows.map(
                (r) =>
                  html`<li>
                    <span>${rowHead(r)}${r.notes ? html`<br /><span class="muted small">Note: ${r.notes}</span>` : ''}</span>
                    <button type="button" class="btn btn-sm btn-primary" data-act="verify" data-id="${r.id}" ${S.busy ? 'disabled' : ''}>
                      Verify
                    </button>
                  </li>`,
              )}
            </ul>`
      }
      ${pager()}
    </section>`;

  const conflictsTab = () =>
    html`<section class="card aud-card" aria-label="Barcode conflicts">
      <h2>Conflicts</h2>
      <p class="muted small">A barcode claimed for two products. It counts nothing until a person with barcode administration decides.</p>
      ${err()}
      ${
        S.rows.length === 0
          ? html`<p class="muted">No conflicts.</p>`
          : S.rows.map(
              (r) =>
                html`<div class="aud-row">
                  <div class="aud-row-main">
                    <strong>${r.barcode}</strong>
                    <span>Kept: ${r.product_name} (${r.product_code})</span>
                    <span>Also claimed: ${r.conflict_product_name} (${r.conflict_product_code})</span>
                    ${r.conflict_note ? html`<span class="muted small">Note: ${r.conflict_note}</span>` : ''}
                  </div>
                  ${
                    admin
                      ? S.panel?.id === r.id
                        ? html`<label class="field"
                              ><span>Reason (required)</span><input type="text" data-f="reason" maxlength="500" value="${S.reason}"
                            /></label>
                            <div class="aud-actions">
                              <button
                                type="button"
                                class="btn btn-sm"
                                data-act="decide"
                                data-id="${r.id}"
                                data-d="keep"
                                ${S.busy ? 'disabled' : ''}
                              >
                                Keep ${r.product_code}
                              </button>
                              <button
                                type="button"
                                class="btn btn-sm"
                                data-act="decide"
                                data-id="${r.id}"
                                data-d="reassign"
                                ${S.busy ? 'disabled' : ''}
                              >
                                Give to ${r.conflict_product_code}
                              </button>
                              <button
                                type="button"
                                class="btn btn-sm btn-ghost"
                                data-act="decide"
                                data-id="${r.id}"
                                data-d="disable"
                                ${S.busy ? 'disabled' : ''}
                              >
                                Switch off
                              </button>
                              <button type="button" class="btn btn-sm btn-ghost" data-act="close-panel">Cancel</button>
                            </div>`
                        : html`<button type="button" class="btn btn-sm btn-primary" data-act="open-decide" data-id="${r.id}">
                            Decide
                          </button>`
                      : html`<span class="muted small">Waiting for a decision.</span>`
                  }
                </div>`,
            )
      }
      ${pager()}
    </section>`;

  const panelFor = (r) => {
    if (!admin || S.panel?.id !== r.id) return '';
    if (S.panel.kind === 'history') {
      return html`<div class="aud-edit" aria-label="History of ${r.barcode}">
        ${
          S.history === null
            ? html`<p class="muted small">Loading…</p>`
            : S.history.length === 0
              ? html`<p class="muted small">No history.</p>`
              : html`<ul class="aud-list">
                  ${S.history.map(
                    (h) =>
                      html`<li>
                        <span
                          >${h.action.replaceAll('_', ' ')}${h.from_status ? ` (${h.from_status} → ${h.to_status})` : ''}${h.reason ? ` · ${h.reason}` : ''}<br /><span
                            class="muted small"
                            >${h.actor_name ?? ''} · ${h.created_at.slice(0, 16).replace('T', ' ')}</span
                          ></span
                        >
                      </li>`,
                  )}
                </ul>`
        }
        <button type="button" class="btn btn-sm btn-ghost" data-act="close-panel">Close</button>
      </div>`;
    }
    const change = S.panel.kind === 'change';
    return html`<div class="aud-edit">
      ${change ? productPicker('pq') : ''}
      <label class="field"><span>Reason (required)</span><input type="text" data-f="reason" maxlength="500" value="${S.reason}" /></label>
      <div class="aud-actions">
        <button type="button" class="btn btn-sm btn-primary" data-act="apply" data-id="${r.id}" ${S.busy ? 'disabled' : ''}>
          ${change ? 'Move to this product' : S.panel.kind === 'enable' ? 'Switch on' : 'Switch off'}
        </button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="close-panel">Cancel</button>
      </div>
    </div>`;
  };

  const masterTab = () =>
    html`<section class="card aud-card" aria-label="All barcodes">
      <h2>All barcodes</h2>
      <div class="aud-filters">
        <input type="search" data-f="q" value="${S.q}" placeholder="Barcode, product name or code" aria-label="Search barcodes" />
        <select data-f="status" aria-label="Status">
          <option value="">All</option>
          ${Object.entries(STATUS).map(([v, t]) => html`<option value="${v}" ${S.status === v ? 'selected' : ''}>${t}</option>`)}
        </select>
      </div>
      ${err()}
      <div id="bc-master">${masterRows()}</div>
      ${
        admin
          ? html`<div class="aud-block no-print" aria-label="Download">
              <h3>Download</h3>
              <div class="aud-actions">
                <button type="button" class="btn btn-sm btn-primary" data-bc-export="xlsx">Excel: all four</button>
                <button type="button" class="btn btn-sm" data-bc-export="master">Master CSV</button>
                <button type="button" class="btn btn-sm" data-bc-export="verification">Verification CSV</button>
                <button type="button" class="btn btn-sm" data-bc-export="conflicts">Conflicts CSV</button>
                <button type="button" class="btn btn-sm" data-bc-export="history">Scan history CSV</button>
              </div>
              <p class="muted small" role="status" data-bc-note></p>
            </div>`
          : ''
      }
    </section>`;
  const masterRows = () =>
    html`${
      S.rows.length === 0
        ? html`<p class="muted">No barcodes match.</p>`
        : S.rows.map(
            (r) =>
              html`<div class="aud-row">
                <div class="aud-row-main">${rowHead(r)}</div>
                ${
                  admin && S.panel?.id !== r.id
                    ? html`<div class="aud-actions">
                        <button type="button" class="btn btn-sm btn-ghost" data-act="open" data-k="change" data-id="${r.id}">
                          Change product
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm btn-ghost"
                          data-act="open"
                          data-k="${r.status === 'disabled' ? 'enable' : 'disable'}"
                          data-id="${r.id}"
                        >
                          ${r.status === 'disabled' ? 'Switch on' : 'Switch off'}
                        </button>
                        <button type="button" class="btn btn-sm btn-ghost" data-act="open" data-k="history" data-id="${r.id}">
                          History
                        </button>
                      </div>`
                    : ''
                }
                ${panelFor(r)}
              </div>`,
          )
    }${pager()}`;

  const body = () => ({ register: registerTab, queue: queueTab, conflicts: conflictsTab, master: masterTab })[tab]();
  const draw = () => render(el, body());
  const drawLists = () => {
    const box = el.querySelector('#bc-master');
    if (box) render(box, masterRows());
    else draw();
  };

  if (tab !== 'register' && S.rows.length === 0) {
    render(el, html`<div class="card aud-card"><p class="muted">Loading…</p></div>`);
    await load();
  }
  draw();

  // ── actions ──
  const afterWrite = async (message) => {
    toast(message);
    S.panel = null;
    S.reason = '';
    S.history = null;
    await load();
    draw();
    void ctx.refreshMirror();
  };
  const run = async (fn, message) => {
    S.busy = true;
    S.error = null;
    draw();
    try {
      await fn();
      S.busy = false;
      await afterWrite(message);
    } catch (e) {
      S.busy = false;
      S.error = friendlyError(e).message;
      draw();
    }
  };

  const searchProducts = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        S.found = S.pq.trim().length >= 2 ? await api.barcodeProducts(S.pq.trim(), 20) : [];
      } catch (e) {
        S.found = [];
        S.error = friendlyError(e).message;
      }
      const box = el.querySelector('#bc-found');
      if (box) render(box, foundList());
    }, SEARCH_DELAY);
  };

  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    if (f === 'pq') {
      S.pq = e.target.value;
      return searchProducts();
    }
    if (f === 'q') {
      S.q = e.target.value;
      S.page = 0;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await load();
        drawLists();
      }, SEARCH_DELAY);
      return;
    }
    if (f in S) S[f] = e.target.value;
  };
  el.onchange = async (e) => {
    const f = e.target.dataset?.f;
    if (f === 'status') {
      S.status = e.target.value;
      S.page = 0;
      await load();
      drawLists();
    } else if (f === 'type') S.type = e.target.value;
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (b.dataset.bcExport) {
      const note = el.querySelector('[data-bc-note]');
      const say = (text) => note && (note.textContent = text);
      const all = [...el.querySelectorAll('button[data-bc-export]')];
      all.forEach((x) => (x.disabled = true));
      say('Preparing the file…');
      try {
        await exportBarcodes(b.dataset.bcExport, say);
        say('Done.');
      } catch (err) {
        say(err?.message && !err.code ? err.message : friendlyError(err).message);
      }
      all.forEach((x) => (x.disabled = false));
      return;
    }
    switch (b.dataset.act) {
      case 'scan':
        return void ctx.startScan(({ code, format }) => {
          S.barcode = code;
          S.type = guessType(code, format);
          S.outcome = null;
          draw();
        });
      case 'pick':
        S.product = S.found.find((p) => p.id === id) ?? null;
        S.found = [];
        S.pq = '';
        return draw();
      case 'clear-product':
        S.product = null;
        return draw();
      case 'register': {
        const code = cleanBarcode(S.barcode);
        if (!isValidBarcode(code)) {
          S.error = 'Enter the barcode: 4 to 48 letters or digits, with no spaces.';
          return draw();
        }
        if (!S.product) {
          S.error = 'Choose the product this barcode belongs to.';
          return draw();
        }
        S.busy = true;
        S.error = null;
        draw();
        try {
          const r = await api.registerBarcode({ barcode: code, productId: S.product.id, type: S.type, notes: S.notes.trim() || null });
          S.outcome = { kind: r.outcome, text: OUTCOME[r.outcome](code, S.product.name) };
          Object.assign(S, { barcode: '', type: 'unknown', product: null, pq: '', found: [], notes: '' });
          void ctx.refreshMirror();
        } catch (er) {
          S.error = friendlyError(er).message;
        }
        S.busy = false;
        return draw();
      }
      case 'verify':
        return void run(() => api.verifyBarcode(id), 'Verified.');
      case 'open-decide':
        S.panel = { id, kind: 'decide' };
        S.reason = '';
        return draw();
      case 'decide':
        if (!reasonOk(S.reason)) {
          S.error = 'Write a short reason (at least 3 letters).';
          return draw();
        }
        return void run(() => api.resolveBarcodeConflict({ id, decision: b.dataset.d, reason: S.reason.trim() }), 'Decision saved.');
      case 'open':
        S.panel = { id, kind: b.dataset.k };
        S.reason = '';
        S.product = null;
        S.pq = '';
        S.found = [];
        S.history = null;
        drawLists();
        if (b.dataset.k === 'history') {
          try {
            S.history = await api.barcodeHistory(id);
          } catch (er) {
            S.history = [];
            S.error = friendlyError(er).message;
          }
          drawLists();
        }
        return;
      case 'close-panel':
        S.panel = null;
        S.history = null;
        S.error = null;
        return tab === 'master' ? drawLists() : draw();
      case 'apply': {
        const kind = S.panel?.kind;
        if (!reasonOk(S.reason)) {
          S.error = 'Write a short reason (at least 3 letters).';
          return draw();
        }
        if (kind === 'change') {
          if (!S.product) {
            S.error = 'Choose the product to move this barcode to.';
            return draw();
          }
          return void run(() => api.changeBarcode({ id, productId: S.product.id, reason: S.reason.trim() }), 'Barcode moved.');
        }
        if (kind === 'enable') return void run(() => api.enableBarcode(id, S.reason.trim()), 'Barcode switched on.');
        return void run(() => api.disableBarcode(id, S.reason.trim()), 'Barcode switched off.');
      }
      case 'prev':
      case 'next':
        S.page += b.dataset.act === 'next' ? 1 : -1;
        await load();
        return tab === 'master' ? drawLists() : draw();
      default:
    }
  };
}
