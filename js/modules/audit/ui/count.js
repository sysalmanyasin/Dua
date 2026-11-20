// Counting: the person's own assignments, and the counting screen for one of them.
// Every count is saved on the device first and sent in the background; the screen works without signal (OD-6, PHONE 1).
// The counter sees the system quantity, the retail price and the difference with its value for their own items (AUD-4, AUD-5).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { loadMirror, refreshMirror, saveScan, sendScans } from '../data/barcodeStore.js';
import { outboxStore } from '../data/outboxStore.js';
import { cleanBarcode, lookup, makeScanEvent, resolveScan, scanMessage } from '../domain/barcode.js';
import { computeRowTimeDelta, truncateExtraNote } from '../domain/compile.js';
import { filterItems, groupByCompany, impactPaisa, parseQty, rupees, summarize, varianceView } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { getView, setView } from '../domain/nav.js';
import { flushOutbox, latestByItem, makeEvent, timing } from '../domain/outbox.js';
import { errorCard, loadingCard, toast } from './parts.js';
import { openScanner } from './scanner.js';
import { installSignOutGuard } from './signoutGuard.js';

const ROUND = { draft: 'being set up', locked: 'locked, not started', counting: 'counting', compiled: 'compiled', final: 'final' };
const PAGE = 100;
const q = (n) => String(Number(n));

const label = (a) => `${a.engagement_name} · Round ${a.round_number}${a.round_suffix ?? ''}`;

export async function mount(el, { ctx } = {}) {
  installSignOutGuard();
  const view = getView();
  if (view?.assignment) return mountCounting(el, view.assignment, ctx);
  return mountList(el, ctx);
}

// ───────── the person's assignments ─────────
async function mountList(el, ctx) {
  const store = outboxStore();
  render(el, loadingCard());
  let list;
  let offline = false;
  try {
    list = await api.myAssignments();
    await store.setKv('assignments', list).catch(() => {});
  } catch (e) {
    list = await store.getKv('assignments').catch(() => null);
    if (!list) return render(el, errorCard('your counts', friendlyError(e).message));
    offline = true;
  }
  const canIndividual = (ctx?.permissions ?? []).includes('audit.individual');
  render(
    el,
    html`<div class="aud">
      ${hero({ label: 'Audit', title: 'Counting', sub: 'The items given to you to count.' })}
      ${offline ? html`<p class="note" role="status">No connection. Showing the last list saved on this device.</p>` : ''}
      <section class="card aud-card" aria-label="Your assignments">
        <h2>Your assignments</h2>
        ${
          list.length === 0
            ? html`<p class="muted">Nothing has been given to you to count yet.</p>`
            : list.map(
                (a) =>
                  html`<div class="row">
                    <div>
                      <strong>${label(a)}</strong><br /><span class="muted small"
                        >${a.items} items · ${a.counted} counted ·
                        ${a.status === 'submitted' ? 'Submitted' : `Round ${ROUND[a.round_state] ?? a.round_state}`}${
                          a.template_name ? ` · ${a.template_name}` : ''
                        }</span
                      >
                    </div>
                    <button
                      type="button"
                      class="btn btn-sm ${a.round_state === 'counting' && a.status !== 'submitted' ? 'btn-primary' : 'btn-ghost'}"
                      data-open="${a.assignment_id}"
                    >
                      ${a.round_state === 'counting' && a.status !== 'submitted' ? 'Count' : 'Open'}
                    </button>
                  </div>`,
              )
        }
        ${
          canIndividual
            ? html`<p>
                <a class="aud-link" href="#/audit/individual"
                  ><strong>Start an Individual Audit</strong><span class="muted small">Count products you choose yourself</span></a
                >
              </p>`
            : ''
        }
      </section>
    </div>`,
  );
  el.onclick = (e) => {
    const b = e.target.closest('button[data-open]');
    if (!b) return;
    setView({ ...(getView() ?? {}), assignment: b.dataset.open });
    mountCounting(el, b.dataset.open, ctx);
  };
}

// ───────── the counting screen ─────────
async function mountCounting(el, assignmentId, ctx) {
  const store = outboxStore();
  render(el, loadingCard());
  const s = {
    a: null,
    items: [],
    byId: new Map(),
    entries: {},
    notes: {},
    waiting: 0,
    online: true,
    flushing: false,
    error: null,
    text: '',
    company: '',
    mode: 'all',
    shown: PAGE,
    collapsed: new Set(),
    lastAction: null,
    confirmSubmit: false,
    extraNote: '',
    busy: false,
    fromCache: false,
    // barcode counting (migration 0411): a scan only finds an item; the quantity is always typed
    method: 'manual',
    canScan: false,
    index: new Map(),
    pinned: null,
    unlocked: new Set(),
    scanMsg: '',
    choices: [],
  };

  // the assignment's facts and its items: from the database, or the copy saved on this device
  try {
    const [list, items] = await Promise.all([api.myAssignments(), api.myItems(assignmentId)]);
    s.a = list.find((x) => x.assignment_id === assignmentId);
    s.items = items;
    await store.setKv('assignments', list).catch(() => {});
    await store.setKv(`items:${assignmentId}`, { a: s.a, items }).catch(() => {});
  } catch (e) {
    const saved = await store.getKv(`items:${assignmentId}`).catch(() => null);
    if (!saved?.a) return render(el, errorCard('this count', friendlyError(e).message));
    s.a = saved.a;
    s.items = saved.items;
    s.fromCache = true;
    s.online = false;
  }
  if (!s.a) {
    setView({ ...(getView() ?? {}), assignment: null });
    return mountList(el, ctx);
  }
  s.byId = new Map(s.items.map((it) => [it.round_item_id, it]));
  for (const it of s.items) {
    if (it.counted_qty !== null && it.counted_qty !== undefined) {
      s.entries[it.round_item_id] = { qty: Number(it.counted_qty), auto: !!it.auto_matched };
      s.notes[it.round_item_id] = it.note ?? '';
    }
  }
  // counts still waiting on this device show straight away, before they are sent
  const waitingEvents = await store.all(assignmentId).catch(() => []);
  for (const [itemId, ev] of Object.entries(latestByItem(waitingEvents))) {
    const it = s.byId.get(itemId);
    if (!it) continue;
    s.entries[itemId] = { qty: ev.auto ? Number(it.system_qty) : Number(ev.qty), auto: ev.auto };
    s.notes[itemId] = ev.note ?? '';
  }
  s.waiting = waitingEvents.length;
  s.method = s.a.counting_method ?? 'manual';
  s.canScan = s.method !== 'manual' && (ctx?.permissions ?? []).includes('audit.barcode_scan');
  if (s.canScan) {
    const m = await loadMirror().catch(() => ({ index: new Map(), count: 0 }));
    s.index = m.index;
    if (!s.fromCache)
      refreshMirror({ fetchPage: api.barcodeMirrorPage })
        .then((r) => (s.index = r.index))
        .catch(() => {});
  }

  const open = () => s.a.round_state === 'counting' && s.a.status !== 'submitted';
  const companies = [...new Set(s.items.map((i) => i.company))].sort();
  const signedRs = (delta, value) => `${delta > 0 ? '+' : '-'}${rupees(Math.abs(value))}`;
  const diffHtml = (it) => {
    const v = varianceView(it, s.entries[it.round_item_id]);
    const cls = v.delta === 0 ? 'aud-diff-ok' : v.delta > 0 ? 'aud-diff-over' : 'aud-diff-bad';
    return html`<span class="aud-diff-qty ${cls}${v.hint ? ' aud-dim' : ''}">${v.delta > 0 ? '+' : ''}${q(v.delta)}</span
      >${v.delta !== 0 ? html`<span class="aud-diff-rs">${signedRs(v.delta, v.value)}</span>` : ''}${v.hint ? html`<span class="aud-diff-hint">${v.hint}</span>` : ''}`;
  };

  // with the barcode method a row starts locked: scan it, or choose Count by hand for a damaged or unregistered label
  const locked = (id) => s.method === 'barcode' && s.canScan && !s.unlocked.has(id) && !s.entries[id];
  // one row: medicine | system | count | difference, as in the old Audit Hub
  const rowHtml = (it) => {
    const id = it.round_item_id;
    const e = s.entries[id];
    const prev = it.prev_counted !== null && it.prev_counted !== undefined;
    return html`<div class="aud-row ${s.pinned === id ? 'aud-row-scanned' : ''}" data-item="${id}">
      <div class="aud-grid">
        <div class="aud-row-main">
          <strong>${it.name || it.code}</strong>
          <span class="muted small">${it.code ? it.code : 'No SKU'} · Rs ${q(Number(it.retail_price))}</span>
          ${it.is_new ? html`<span class="small aud-diff-bad">New product since the last round</span>` : ''}
          ${
            prev
              ? html`<span class="muted small"
                  >Last round: Var ${Number(it.prev_variance) > 0 ? '+' : ''}${q(it.prev_variance)}
                  ${open() && !locked(id) ? html`<button type="button" class="aud-mini" data-same="${id}">Same</button>` : ''}</span
                >`
              : ''
          }
        </div>
        <div class="aud-sys">${q(it.system_qty)}</div>
        <div class="aud-row-entry">
          <input
            type="text"
            inputmode="decimal"
            enterkeyhint="next"
            autocomplete="off"
            placeholder="-"
            data-qty="${id}"
            aria-label="Counted quantity for ${it.name || it.code}, system quantity ${q(it.system_qty)}"
            value="${e ? q(e.qty) : ''}"
            ${open() && !locked(id) ? '' : 'disabled'}
          />
          ${open() && locked(id) ? html`<button type="button" class="aud-mini" data-hand="${id}">Count by hand</button>` : ''}
          ${open() && !locked(id) ? html`<button type="button" class="aud-mini" data-match="${id}">Matches</button>` : ''}
        </div>
        <div class="aud-diff" data-diff="${id}">${diffHtml(it)}</div>
      </div>
      ${
        open()
          ? html`<details class="aud-note">
              <summary>Note${s.notes[id] ? ' ✓' : ''}</summary>
              <input
                type="text"
                maxlength="500"
                data-note="${id}"
                value="${s.notes[id] ?? ''}"
                aria-label="Note for ${it.name || it.code}"
              />
            </details>`
          : ''
      }
    </div>`;
  };

  const groupHeader = (g) => {
    const collapsed = s.collapsed.has(g.company);
    const all = s.items.filter((i) => i.company === g.company);
    return html`<button type="button" class="aud-group" data-group="${g.company}" aria-expanded="${!collapsed}">
      <span>${collapsed ? '▸' : '▾'} ${g.company}</span><span class="aud-group-impact" data-impact="${g.company}">${impactText(all)}</span>
    </button>`;
  };
  const impactText = (all) => {
    const v = impactPaisa(all, s.entries);
    return v === 0 ? 'Rs 0' : `${v < 0 ? '-' : '+'}${rupees(Math.abs(v))}`;
  };
  const refreshImpacts = () => {
    for (const node of el.querySelectorAll('[data-impact]')) {
      const all = s.items.filter((i) => i.company === node.dataset.impact);
      const v = impactPaisa(all, s.entries);
      node.textContent = impactText(all);
      node.className = `aud-group-impact${v < 0 ? ' aud-diff-bad' : v > 0 ? ' aud-diff-over' : ''}`;
    }
  };

  const visible = () => filterItems(s.items, s.entries, { text: s.text, company: s.company, mode: s.mode });

  function drawList() {
    const rows = visible();
    const box = el.querySelector('#aud-list');
    if (!box) return;
    const groups = groupByCompany(rows);
    let budget = s.shown;
    const parts = [];
    // a scanned item goes to the very top, above the company groups
    const pin = s.pinned && s.byId.get(s.pinned);
    if (pin) parts.push(rowHtml(pin));
    for (const g of groups) {
      if (g.company) parts.push(groupHeader(g));
      if (g.company && s.collapsed.has(g.company)) continue;
      const take = g.items.filter((i) => i.round_item_id !== s.pinned).slice(0, Math.max(budget, 0));
      budget -= take.length;
      parts.push(...take.map(rowHtml));
    }
    render(
      box,
      html`<div class="aud-cols" aria-hidden="true"><span>Medicine</span><span>Sys</span><span>Count</span><span>Var</span></div>
        ${rows.length === 0 ? html`<p class="muted">No items match.</p>` : parts}
        ${rows.length > s.shown ? html`<button type="button" class="btn btn-ghost" data-more>Show ${Math.min(PAGE, rows.length - s.shown)} more (${rows.length - s.shown} left)</button>` : ''}`,
    );
    refreshImpacts();
  }

  function drawSummary() {
    const t = summarize(s.items, s.entries);
    const box = el.querySelector('#aud-summary');
    if (!box) return;
    render(
      box,
      html`<p>
          <strong>${t.counted} of ${t.total}</strong> counted · ${t.left} to count · ${t.different} different · net
          <strong>${rupees(t.value)}</strong>
        </p>
        <p class="small ${s.waiting ? 'aud-diff-bad' : 'muted'}" role="status">
          ${s.waiting ? `${s.waiting} ${s.waiting === 1 ? 'count' : 'counts'} waiting to send.` : 'Everything is sent.'}
          ${s.online ? '' : ' No connection: counts are kept on this device.'}
        </p>
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
        ${
          s.waiting
            ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="send" ${s.flushing ? 'disabled' : ''}>
                ${s.flushing ? 'Sending…' : 'Send now'}
              </button>`
            : ''
        }`,
    );
  }

  function patchRow(id) {
    const it = s.byId.get(id);
    const row = [...el.querySelectorAll('.aud-row')].find((r) => r.dataset.item === id);
    if (!it || !row) return;
    render(row.querySelector('[data-diff]'), diffHtml(it));
    const input = row.querySelector('input[data-qty]');
    const e = s.entries[id];
    if (input && e && document.activeElement !== input) input.value = q(e.qty);
    refreshImpacts();
  }

  function drawShell() {
    const submitted = s.a.status === 'submitted';
    render(
      el,
      html`<div class="aud">
        ${hero({
          label: 'Audit',
          title: label(s.a),
          sub: `${s.items.length} items${s.a.template_name ? ` · ${s.a.template_name}` : ''} · Round ${ROUND[s.a.round_state] ?? s.a.round_state}`,
          actions: html`<button type="button" class="btn btn-ghost btn-sm" data-act="back">All assignments</button>`,
        })}
        ${s.fromCache ? html`<p class="note" role="status">No connection. This list was saved on this device earlier. Your counts are kept and will send when you are back online.</p>` : ''}
        ${
          open()
            ? ''
            : html`<p class="note" role="status">
                ${submitted ? 'You submitted this count. It is shown here for reading only.' : `Counting is not open: the round is ${ROUND[s.a.round_state] ?? s.a.round_state}.`}
              </p>`
        }
        <section class="card aud-card" id="aud-summary" aria-label="Progress"></section>
        <section class="card aud-card" aria-label="Find items">
          ${scanBox()}
          <div class="aud-filters">
            <input type="search" data-f="text" placeholder="Search items…" value="${s.text}" aria-label="Search items" />
            <select data-f="company" aria-label="Company">
              <option value="">All companies</option>
              ${companies.map((c) => html`<option value="${c}" ${s.company === c ? 'selected' : ''}>${c}</option>`)}
            </select>
            <select data-f="mode" aria-label="Show">
              ${[
                ['all', 'All'],
                ['todo', 'Not counted'],
                ['done', 'Counted'],
                ['diff', 'Different'],
              ].map(([v, t]) => html`<option value="${v}" ${s.mode === v ? 'selected' : ''}>${t}</option>`)}
            </select>
          </div>
        </section>
        <section class="card aud-card" id="aud-list" aria-label="Items"></section>
        ${open() ? submitCard() : ''}
      </div>`,
    );
    drawSummary();
    drawList();
  }

  const scanBox = () =>
    s.canScan && open()
      ? html`<div class="aud-actions">
            <button type="button" class="btn btn-primary btn-sm" data-act="scan">Scan a barcode</button>
            ${s.pinned ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="unpin">Show the whole list</button>` : ''}
          </div>
          <p class="small" id="aud-scan-note" role="status" aria-live="polite">${s.scanMsg}</p>
          ${
            s.choices.length
              ? html`<ul class="aud-list">
                  ${s.choices.map((id) => {
                    const it = s.byId.get(id);
                    return html`<li>
                      <button type="button" class="btn btn-ghost btn-sm" data-choose="${id}">
                        <strong>${it.name || it.code}</strong> <span class="muted small">${it.company}</span>
                      </button>
                    </li>`;
                  })}
                </ul>`
              : ''
          }`
      : '';

  // a scan finds an item in the person's own list and puts it first; the quantity is always typed (AUD-4, AUD-5)
  function pin(id) {
    s.pinned = id;
    s.unlocked.add(id);
    s.choices = [];
    s.text = '';
    s.company = '';
    s.mode = 'all';
    s.shown = PAGE;
    drawShell();
    const input = [...el.querySelectorAll('input[data-qty]')].find((i) => i.dataset.qty === id);
    input?.focus();
  }
  async function onScan({ code }) {
    const clean = cleanBarcode(code);
    const row = lookup(s.index, clean);
    const r = resolveScan(row, s.items);
    s.scanMsg =
      s.index.size === 0 && !row
        ? 'No barcode list is saved on this phone yet. Connect once to download it, or find the item by name.'
        : scanMessage(r, clean);
    try {
      await saveScan(makeScanEvent({ barcode: clean, type: 'count', result: r.result, assignmentId, code: row?.product_code ?? null }));
    } catch {
      toast('This device could not save the scan record. Your counts are not affected.', 'error');
    }
    void sendScans(api.scanBatch).catch(() => {});
    if (r.result === 'matched') return pin(r.items[0].round_item_id);
    s.choices = r.result === 'ambiguous' ? r.items.map((i) => i.round_item_id) : [];
    drawShell();
  }

  const submitCard = () => {
    const t = summarize(s.items, s.entries);
    return html`<section class="card aud-card" aria-label="Submit">
      <h2>Submit your count</h2>
      <label class="field"
        ><span>Anything the owner should know (optional)</span><textarea data-f="extra" rows="3" maxlength="2000">${s.extraNote}</textarea>
      </label>
      ${
        s.confirmSubmit && t.left > 0
          ? html`<p class="note" role="alert">
                ${t.left} ${t.left === 1 ? 'item is' : 'items are'} not counted. Uncounted items are treated as zero in stock.
              </p>
              <div class="aud-actions">
                <button type="button" class="btn" data-act="mark-rest" ${s.busy ? 'disabled' : ''}>Mark the rest as matching</button>
                <button type="button" class="btn btn-primary" data-act="submit" ${s.busy ? 'disabled' : ''}>Submit anyway</button>
                <button type="button" class="btn btn-ghost" data-act="cancel-submit">Keep counting</button>
              </div>`
          : html`<button
              type="button"
              class="btn btn-primary"
              data-act="${t.left > 0 ? 'ask-submit' : 'submit'}"
              ${s.busy ? 'disabled' : ''}
            >
              Submit count
            </button>`
      }
    </section>`;
  };

  // ── saving and sending ──
  async function record(id, { qty = null, auto = false, note, confirmed = false }, quiet = false) {
    const it = s.byId.get(id);
    if (!it || !open()) return;
    const now = Date.now();
    const rowSeconds = computeRowTimeDelta(s.lastAction, now);
    s.lastAction = now;
    const prev = s.entries[id];
    const nextQty = auto ? Number(it.system_qty) : qty;
    const noteText = note ?? s.notes[id] ?? '';
    if (prev && !auto && !prev.auto && prev.qty === nextQty && (s.notes[id] ?? '') === noteText) return; // nothing changed
    const event = makeEvent({ assignmentId, itemId: id, qty: nextQty, auto, note: noteText, confirmed, rowSeconds });
    // shown at once; if the device cannot keep it, it is taken back and the person is told
    const before = { entry: prev, note: s.notes[id] };
    s.entries[id] = { qty: nextQty, auto };
    s.notes[id] = noteText;
    if (!quiet) {
      patchRow(id);
      drawSummary();
    }
    try {
      await store.add(event);
    } catch {
      if (before.entry) s.entries[id] = before.entry;
      else delete s.entries[id];
      s.notes[id] = before.note ?? '';
      if (!quiet) patchRow(id);
      s.error = 'This device could not save the count. Free some space or try another browser, then count again.';
      return drawSummary();
    }
    s.waiting += 1;
    if (!quiet) drawSummary();
    scheduleFlush();
  }

  let timer = null;
  const scheduleFlush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => flush(false), timing.flushDelayMs);
  };

  async function flush(manual) {
    if (s.flushing || !el.isConnected) return;
    s.flushing = true;
    drawSummary();
    const r = await flushOutbox({ store, send: api.countBatch, assignmentId });
    if (s.canScan) await sendScans(api.scanBatch).catch(() => {}); // scan history is best effort; counts are what block submitting
    s.flushing = false;
    s.waiting = r.left;
    s.online = !(r.error && r.error.kind === 'offline');
    s.error = r.error && r.error.kind !== 'offline' ? r.error.message : null;
    if (manual && r.sent > 0 && !r.error) toast(`${r.sent} ${r.sent === 1 ? 'count' : 'counts'} sent.`);
    drawSummary();
  }

  // ── events ──
  const nextInput = (input) => {
    const rows = [...el.querySelectorAll('input[data-qty]:not([disabled])')];
    rows[rows.indexOf(input) + 1]?.focus();
  };
  el.onchange = (e) => {
    const t = e.target;
    const f = t.dataset?.f;
    if (f === 'company' || f === 'mode') {
      s[f] = t.value;
      s.shown = PAGE;
      return drawList();
    }
    if (f === 'extra') return void (s.extraNote = truncateExtraNote(t.value));
    if (t.dataset?.qty) {
      if (t.value.trim() === '') return;
      const n = parseQty(t.value);
      if (n === null) {
        toast('Enter a number, zero or more (for example 12 or 2.5).', 'error');
        const old = s.entries[t.dataset.qty];
        t.value = old ? q(old.qty) : '';
        return;
      }
      return void record(t.dataset.qty, { qty: n });
    }
    if (t.dataset?.note) {
      const id = t.dataset.note;
      if (!s.entries[id]) return toast('Count the item first, then add the note.', 'error');
      // a note on a marked-as-matching item turns it into an ordinary count of the same number
      return void record(id, { qty: s.entries[id].qty, auto: false, note: t.value });
    }
  };
  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'text') {
      s.text = e.target.value;
      s.shown = PAGE;
      drawList();
    }
  };
  el.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.dataset?.qty) {
      e.preventDefault();
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
      nextInput(e.target);
    }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.group !== undefined) {
      if (s.collapsed.has(b.dataset.group)) s.collapsed.delete(b.dataset.group);
      else s.collapsed.add(b.dataset.group);
      return drawList();
    }
    if (b.dataset.more !== undefined) {
      s.shown += PAGE;
      return drawList();
    }
    if (b.dataset.match) return void record(b.dataset.match, { auto: true });
    if (b.dataset.hand) {
      s.unlocked.add(b.dataset.hand);
      drawList();
      return void [...el.querySelectorAll('input[data-qty]')].find((i) => i.dataset.qty === b.dataset.hand)?.focus();
    }
    if (b.dataset.choose) return pin(b.dataset.choose);
    if (b.dataset.same) {
      const it = s.byId.get(b.dataset.same);
      return void record(b.dataset.same, { qty: Number(it.prev_counted), confirmed: true });
    }
    switch (b.dataset.act) {
      case 'scan':
        return void openScanner({ title: 'Scan an item', onCode: onScan, onClose: () => el.querySelector('[data-act="scan"]')?.focus() });
      case 'unpin':
        s.pinned = null;
        s.scanMsg = '';
        s.choices = [];
        return drawShell();
      case 'back':
        setView({ ...(getView() ?? {}), assignment: null });
        return mountList(el, ctx);
      case 'send':
        return flush(true);
      case 'ask-submit':
        s.confirmSubmit = true;
        return drawShell();
      case 'cancel-submit':
        s.confirmSubmit = false;
        return drawShell();
      case 'mark-rest': {
        s.busy = true;
        for (const it of s.items) if (!s.entries[it.round_item_id]) await record(it.round_item_id, { auto: true }, true);
        s.busy = false;
        s.confirmSubmit = false;
        return drawShell();
      }
      case 'submit': {
        s.busy = true;
        s.error = null;
        drawShell();
        await flush(false);
        if (s.waiting > 0) {
          s.busy = false;
          s.error = s.error ?? 'Some counts are still waiting to send. Connect to the internet and try again.';
          return drawShell();
        }
        try {
          await api.submitCount(assignmentId, s.extraNote.trim());
          s.a = { ...s.a, status: 'submitted' };
          await store.setKv(`items:${assignmentId}`, { a: s.a, items: s.items }).catch(() => {});
          toast('Count submitted.');
        } catch (err) {
          const f = friendlyError(err);
          s.error = f.message;
        }
        s.busy = false;
        s.confirmSubmit = false;
        return drawShell();
      }
      default:
    }
  };

  // sends in the background: when the connection returns, and every so often while the screen is open
  const onOnline = () => {
    if (el.isConnected) flush(false);
    else window.removeEventListener('online', onOnline);
  };
  window.addEventListener('online', onOnline);
  const every = setInterval(() => {
    if (!el.isConnected) {
      clearInterval(every);
      window.removeEventListener('online', onOnline);
    } else if (s.waiting > 0) flush(false);
  }, timing.pollMs);

  drawShell();
  if (s.waiting > 0 && !s.fromCache) flush(false);
}
