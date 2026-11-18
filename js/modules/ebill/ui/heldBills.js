// The Held Bills list: search, resume, delete. Shows this device's holds and (online) holds made on other devices. Opens over the
// bill without touching it; closing returns to the same screen. Resuming is done by the caller (it owns the screen).
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { clock } from '../data/products.js';
import { ask } from './dialog.js';

const WHERE = { device: 'Waiting to upload', both: 'Saved on server too', server: 'On the server (another device)' };
const when = (iso) =>
  iso ? `${new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short' })} ${clock(iso)}` : '';

/**
 * @param {{ host: HTMLElement, held: ReturnType<import('../data/held.js').createHeld>, start?: 'first'|'prev'|'next'|'last',
 *           currentId?: string|null, onResume: (id: string) => void, onDeleted?: (id: string) => void, onClose: () => void }} o
 * @returns {() => void} close
 */
export function openHeldBills({ host, held, start, currentId = null, onResume, onDeleted = () => {}, onClose }) {
  let items = [];
  let shown = [];
  let cursor = 0;
  let text = '';
  let msg = '';
  let serverError = false;

  render(
    host,
    html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Held bills">
      <div class="eb-dlg eb-held-dlg">
        <div class="eb-dlg-head">
          <h2>Held bills</h2>
          <span class="muted eb-grow" id="hb-note"></span>
          <button type="button" class="btn btn-sm" data-act="close">Close (Esc)</button>
        </div>
        <label class="field"><span>Search customer or label</span><input id="hb-search" type="search" autocomplete="off" /></label>
        <div id="hb-msg"></div>
        <div class="eb-table-wrap"><div id="hb-table"></div></div>
        <div class="eb-dlg-foot"><span class="muted">↑ ↓ choose · Enter resume · Delete key removes · Esc close</span></div>
      </div>
    </div>`,
  );
  const root = host.querySelector('.eb-modal');
  const q = (s) => root.querySelector(s);

  function draw() {
    const w = text.trim().toLowerCase();
    shown = items.filter((h) => !w || `${h.customer} ${h.label}`.toLowerCase().includes(w));
    if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1);
    render(
      q('#hb-note'),
      html`${items.length} held${serverError ? ' · the server list could not be loaded, showing this device only' : ''}`,
    );
    render(q('#hb-msg'), msg ? html`<p class="note note-info" role="status">${msg}</p>` : html``);
    render(
      q('#hb-table'),
      html`<table class="eb-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Label</th>
            <th class="num">Items</th>
            <th class="num">Net total</th>
            <th>Held</th>
            <th>Where</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${
            shown.length
              ? shown.map(
                  (h, i) =>
                    html`<tr class="${i === cursor ? 'sel' : ''}" data-i="${i}">
                      <td>${h.customer || 'Walk-in'}${h.id === currentId ? html` <span class="eb-tag">on screen</span>` : ''}</td>
                      <td>${h.label}</td>
                      <td class="num">${h.item_count}</td>
                      <td class="num">${money(h.net_total, { decimals: true })}</td>
                      <td>${when(h.updated_at)}</td>
                      <td class="${h.where === 'device' ? '' : 'muted'}">
                        ${WHERE[h.where]}${h.last_error ? html` <span class="neg" title="${h.last_error.message}">⚠</span>` : ''}
                      </td>
                      <td>
                        <button type="button" class="btn btn-sm" data-resume="${i}">Resume</button
                        ><button type="button" class="btn btn-sm" data-delete="${i}">Delete</button>
                      </td>
                    </tr>`,
                )
              : html`<tr>
                  <td colspan="7" class="muted eb-empty">${items.length ? 'No held bill matches.' : 'No held bills.'}</td>
                </tr>`
          }
        </tbody>
      </table>`,
    );
    q('.sel')?.scrollIntoView?.({ block: 'nearest' });
  }

  async function reload() {
    const r = await held.list();
    items = r.items;
    serverError = r.serverError;
    if (start && items.length) {
      const at = Math.max(
        0,
        items.findIndex((h) => h.id === currentId),
      );
      cursor =
        start === 'first'
          ? 0
          : start === 'last'
            ? items.length - 1
            : start === 'next'
              ? Math.min(at + 1, items.length - 1)
              : Math.max(at - 1, 0);
      start = null;
    }
    draw();
  }

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    host.replaceChildren();
    onClose();
  };
  async function del(i) {
    const h = shown[i];
    if (!h) return;
    const v = await ask(host.parentElement?.querySelector('#eb-dialog') ?? host, {
      title: 'Delete this held bill?',
      intro: `${h.customer || 'Walk-in'} · ${h.item_count} items · ${money(h.net_total, { decimals: true })}. It cannot be brought back.`,
      confirm: 'Delete',
      fields: [],
    });
    if (!v) return;
    const r = await held.release(h.id);
    msg = r.ok ? 'Held bill deleted.' : r.message;
    if (r.ok) onDeleted(h.id);
    await reload();
  }
  function onKey(e) {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey, true);
    if (document.querySelector('#eb-dialog .eb-modal')) return; // a question is open on top: it gets the keys
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = Math.min(cursor + 1, shown.length - 1);
      return draw();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      return draw();
    }
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && shown[cursor]) {
      e.preventDefault();
      return resume(cursor);
    }
    if (e.key === 'Delete' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      del(cursor);
    }
  }
  function resume(i) {
    const h = shown[i];
    if (!h) return;
    close();
    onResume(h.id);
  }
  document.addEventListener('keydown', onKey, true);
  q('#hb-search').addEventListener('input', (e) => {
    text = e.target.value;
    cursor = 0;
    draw();
  });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-resume],[data-delete],tr[data-i]');
    if (!t) return;
    if (t.dataset.act === 'close') return close();
    if (t.dataset.resume !== undefined) return resume(Number(t.dataset.resume));
    if (t.dataset.delete !== undefined) return del(Number(t.dataset.delete));
    cursor = Number(t.dataset.i);
    draw();
  });
  root.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) resume(Number(tr.dataset.i));
  });
  reload();
  q('#hb-search').focus();
  return close;
}
