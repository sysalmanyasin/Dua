// Barcode Center: find a product by its barcode (works without signal, from the copy saved on this phone), register and verify
// barcodes, settle conflicts, keep the master list, and read scan history. This file is the page shell and the Find and History
// tabs; the register, queue, conflict and master tabs are in barcodeAdmin.js.
// Who may do what is decided by the database. The tabs only hide what the person cannot use.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { barcodeStore, loadMirror, refreshMirror, saveScan, sendScans } from '../data/barcodeStore.js';
import { cleanBarcode, lookup, makeScanEvent } from '../domain/barcode.js';
import { friendlyError } from '../domain/errors.js';
import { mountAdminTab, resetAdminTab } from './barcodeAdmin.js';
import { loadingCard, toast } from './parts.js';
import { openScanner } from './scanner.js';
import { installSignOutGuard } from './signoutGuard.js';
import { warmEngine } from './scanEngine.js';

export const STATUS_TEXT = { unverified: 'Not verified yet', verified: 'Verified', conflict: 'In conflict', disabled: 'Switched off' };
const HISTORY_PAGE = 50;
const RESULT_TEXT = {
  matched: 'Found',
  not_found: 'Not in the list',
  unverified: 'Not verified',
  conflict: 'In conflict',
  disabled: 'Switched off',
  not_in_assignment: 'Not in the list given',
  ambiguous: 'Several items',
};

export async function mount(el, { ctx } = {}) {
  installSignOutGuard();
  const perms = ctx?.permissions ?? [];
  const isAdmin = perms.includes('audit.barcode_admin');
  const canRegister = isAdmin || perms.includes('audit.barcode_register');
  const store = barcodeStore();
  const s = {
    tab: 'find',
    index: new Map(),
    count: 0,
    online: true,
    refreshing: false,
    waiting: 0,
    last: null, // the last scan: { code, row, result }
    history: [],
    historyTotal: 0,
    historyPage: 0,
    error: null,
    prefill: null, // a barcode handed to the Register tab
  };
  const tabs = [
    ['find', 'Find'],
    ...(canRegister
      ? [
          ['register', 'Register'],
          ['queue', 'To verify'],
          ['conflicts', 'Conflicts'],
          ['master', 'All barcodes'],
        ]
      : []),
    ['history', isAdmin ? 'Scan history' : 'My scans'],
  ];

  render(el, loadingCard());
  const saved = await loadMirror(store);
  s.index = saved.index;
  s.count = saved.count;
  s.waiting = await store.count('scan').catch(() => 0);

  // ── the phone's copy of the list ──
  async function refresh() {
    if (s.refreshing) return;
    s.refreshing = true;
    drawTop();
    try {
      const r = await refreshMirror({ fetchPage: api.barcodeMirrorPage, store });
      s.index = r.index;
      s.count = r.count;
      s.online = true;
      s.error = null;
    } catch (e) {
      const f = friendlyError(e);
      s.online = f.kind !== 'offline';
      if (f.kind !== 'offline') s.error = f.message;
      if (s.count === 0 && f.kind === 'offline')
        s.error = 'No connection, and no barcode list is saved on this device yet. Connect once to download it.';
    }
    s.refreshing = false;
    if (!el.isConnected) return;
    drawTop();
    if (s.tab === 'find') drawBody();
  }
  async function flush() {
    const r = await sendScans(api.scanBatch, store);
    s.waiting = r.left;
    if (r.error && r.error.kind !== 'offline') s.error = r.error.message;
    if (el.isConnected) drawTop();
  }

  // ── a scan from the Find tab ──
  async function onScan({ code, format }) {
    const clean = cleanBarcode(code);
    const row = lookup(s.index, clean);
    const result = row ? (row.status === 'verified' ? 'matched' : row.status) : 'not_found';
    s.last = { code: clean, row, result, format };
    try {
      await saveScan(makeScanEvent({ barcode: clean, type: 'lookup', result: s.last.result, code: row?.product_code ?? null }), store);
      s.waiting += 1;
      void flush();
    } catch {
      toast('This device could not save the scan. The result is still shown.', 'error');
    }
    drawBody();
  }
  const startScan = (then) =>
    openScanner({
      title: 'Scan a barcode',
      onCode: then ?? onScan,
      onClose: () => el.querySelector('[data-act="scan"]')?.focus(),
    });

  // ── drawing ──
  function drawTop() {
    const box = el.querySelector('#bc-top');
    if (!box) return;
    render(
      box,
      html`<p class="small muted" role="status">
          ${s.count} ${s.count === 1 ? 'barcode' : 'barcodes'} saved on this
          phone${s.refreshing ? ' · updating…' : ''}${s.online ? '' : ' · no connection'}
        </p>
        ${
          s.waiting
            ? html`<p class="small aud-diff-bad" role="status">
                ${s.waiting} ${s.waiting === 1 ? 'scan' : 'scans'} waiting to send.
                <button type="button" class="btn btn-ghost btn-sm" data-act="send">Send now</button>
              </p>`
            : ''
        }
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}`,
    );
  }

  function lastCard() {
    const l = s.last;
    if (!l) return '';
    const r = l.row;
    return html`<section class="card aud-card" aria-label="Scan result" aria-live="polite">
      <h2>${l.code}</h2>
      ${
        r
          ? html`<p>
                <strong>${r.product_name}</strong><br /><span class="muted small"
                  >${r.product_code} · ${STATUS_TEXT[r.status] ?? r.status}</span
                >
              </p>
              ${r.status === 'conflict' ? html`<p class="note" role="status">Also claimed for ${r.conflict_product_code}. A person with barcode administration has to decide which is right.</p>` : ''}
              ${r.status === 'unverified' ? html`<p class="note" role="status">Registered, but nobody has checked it yet.</p>` : ''}
              ${r.status === 'disabled' ? html`<p class="note" role="status">This barcode was switched off and will not count anything.</p>` : ''}
              ${canRegister && r.status === 'unverified' && s.online ? html`<button type="button" class="btn btn-sm" data-act="verify" data-id="${r.id}">Verify it</button>` : ''}`
          : html`<p>This barcode is not registered.</p>
              ${canRegister ? html`<button type="button" class="btn btn-sm btn-primary" data-act="register-this">Register this barcode</button>` : html`<p class="muted small">Ask a deputy to register it.</p>`}`
      }
    </section>`;
  }

  function findTab() {
    return html`<section class="card aud-card" aria-label="Find by barcode">
        <h2>Find a product</h2>
        <p class="muted small">Scan a barcode to see which product it belongs to. This works without signal.</p>
        <div class="aud-actions"><button type="button" class="btn btn-primary" data-act="scan">Scan a barcode</button></div>
      </section>
      ${lastCard()}`;
  }

  async function loadHistory() {
    try {
      const rows = await api.scanHistory({ limit: HISTORY_PAGE, offset: s.historyPage * HISTORY_PAGE });
      s.history = rows;
      s.historyTotal = rows.length ? Number(rows[0].total) : 0;
      s.error = null;
    } catch (e) {
      s.error = friendlyError(e).message;
    }
  }
  function historyTab() {
    const pages = Math.max(1, Math.ceil(s.historyTotal / HISTORY_PAGE));
    return html`<section class="card aud-card" aria-label="Scan history">
      <h2>${isAdmin ? 'Scan history' : 'My scans'}</h2>
      ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
      ${
        s.history.length === 0
          ? html`<p class="muted">No scans yet.</p>`
          : html`<div class="aud-table-wrap">
                <table class="aud-table">
                  <caption class="sr-only">
                    Scans, newest first
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      ${isAdmin ? html`<th scope="col">Who</th>` : ''}
                      <th scope="col">Barcode</th>
                      <th scope="col">Product</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${s.history.map(
                      (h) =>
                        html`<tr>
                          <td>
                            ${shortDate(h.scanned_at.slice(0, 10))}
                            ${new Date(h.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          ${isAdmin ? html`<td>${h.user_name ?? ''}</td>` : ''}
                          <td>${h.barcode}</td>
                          <td>${h.product_code ?? ''}</td>
                          <td>${RESULT_TEXT[h.result] ?? h.result}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              <div class="aud-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-act="hprev" ${s.historyPage === 0 ? 'disabled' : ''}>Newer</button>
                <span class="muted small">Page ${s.historyPage + 1} of ${pages}</span>
                <button type="button" class="btn btn-ghost btn-sm" data-act="hnext" ${s.historyPage + 1 >= pages ? 'disabled' : ''}>
                  Older
                </button>
              </div>`
      }
    </section>`;
  }

  const adminCtx = () => ({
    el: el.querySelector('#bc-body'),
    isAdmin,
    index: () => s.index,
    online: () => s.online,
    prefill: () => s.prefill,
    clearPrefill: () => (s.prefill = null),
    refreshMirror: refresh,
    startScan,
    setTab: go,
  });

  function drawBody() {
    const box = el.querySelector('#bc-body');
    if (!box) return;
    if (s.tab === 'find') return render(box, findTab());
    if (s.tab === 'history') return render(box, historyTab());
    return void mountAdminTab(s.tab, adminCtx());
  }
  async function go(tab) {
    resetAdminTab();
    s.tab = tab;
    s.error = null;
    drawShell();
    if (tab === 'history') {
      await loadHistory();
      drawBody();
    }
  }

  function drawShell() {
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Barcodes', sub: 'Find, register and verify product barcodes.' })}
        <div id="bc-top"></div>
        <div class="aud-tabs" role="tablist" aria-label="Barcode sections">
          ${tabs.map(
            ([id, text]) =>
              html`<button
                type="button"
                role="tab"
                class="btn btn-sm ${s.tab === id ? 'btn-primary' : 'btn-ghost'}"
                aria-selected="${s.tab === id ? 'true' : 'false'}"
                data-tab="${id}"
              >
                ${text}
              </button>`,
          )}
        </div>
        <div id="bc-body" role="tabpanel"></div>
      </div>`,
    );
    drawTop();
    drawBody();
  }

  el.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.tab) return void go(t.dataset.tab);
    if (s.tab !== 'find' && s.tab !== 'history') return; // the working tabs handle their own buttons
    switch (t.dataset.act) {
      case 'scan':
        return void startScan();
      case 'send':
        return void flush();
      case 'hprev':
        s.historyPage -= 1;
        await loadHistory();
        return drawBody();
      case 'hnext':
        s.historyPage += 1;
        await loadHistory();
        return drawBody();
      case 'register-this':
        s.prefill = { barcode: s.last.code, format: s.last.format };
        return void go('register');
      case 'verify':
        try {
          await api.verifyBarcode(t.dataset.id);
          toast('Verified.');
          await refresh();
          const row = lookup(s.index, s.last.code);
          s.last = { ...s.last, row, result: row?.status === 'verified' ? 'matched' : (row?.status ?? s.last.result) };
          drawBody();
        } catch (err) {
          toast(friendlyError(err).message, 'error');
        }
        return;
      default:
    }
  };

  // the copy of the list stays fresh while the screen is open; an offline phone keeps what it has
  drawShell();
  void warmEngine();
  void refresh();
  if (s.waiting > 0) void flush();
  const onOnline = () => {
    if (!el.isConnected) return window.removeEventListener('online', onOnline);
    void refresh();
    void flush();
  };
  window.addEventListener('online', onOnline);
}
