// One open workbook: sheet tabs, the grid, the edit bar for the selected cell, refresh.
// Which workbook is open comes from session storage (the router carries no ids); home.js sets it.
// Cell text and formulas can be edited (ui/cellEditor.js); formulas are calculated by domain/formulas. Formatting and structure
// changes arrive in later increments.
import { html, render } from '../../../shared/html.js';
import { newId, OPEN_KEY, relativeWhen } from '../domain/documents.js';
import { can, roleLabel } from '../domain/permissions.js';
import { buildOp, findLiveSheet, liveSheets } from '../domain/spreadsheet.js';
import { createOperationSender, openWorkbookFull, pullAndApply } from '../data/workbooks.js';
import { createCellEditor } from './cellEditor.js';
import { createSheetCalc } from '../domain/formulas/sheetCalc.js';
import { createGridView } from './gridView.js';
import { confirmAction } from './panel.js';

const STALE_MS = 60000; // coming back to the page after this long refreshes it quietly

function message(el, title, text) {
  render(
    el,
    html`<div class="card">
      <h2>${title}</h2>
      <p class="muted">${text}</p>
      <a class="btn" href="#/workspace">Back to Workspace</a>
    </div>`,
  );
}

export async function mount(el, { measure = null } = {}) {
  const id = sessionStorage.getItem(OPEN_KEY);
  if (!id) return message(el, 'No workbook is open', 'Choose a workbook from your Workspace.');
  render(el, html`<div class="card"><p class="muted" id="ws-loading" role="status">Opening workbook…</p></div>`);
  let opened;
  try {
    opened = await openWorkbookFull(id, {
      onProgress: ({ loaded }) => {
        const p = el.querySelector('#ws-loading');
        if (p) p.textContent = `Opening workbook… ${loaded.toLocaleString('en-US')} cells`;
      },
    });
  } catch (e) {
    return message(el, 'This workbook could not be opened', e.message);
  }

  const s = { wb: opened.wb, info: opened.info, sheetId: null, error: '', notice: '', busy: false, syncedAt: Date.now() };
  const canEdit = () => can(s.info.role, 'edit', { archived: !!s.info.archived });

  render(
    el,
    html`<div class="ws-sheet">
      <div class="ws-note-head">
        <a class="btn btn-ghost btn-sm" href="#/workspace">‹ Workspace</a>
        <h2 class="ws-sheet-title ws-grow" id="ws-sheet-title"></h2>
        <span class="pill ws-role" id="ws-role"></span>
        <button class="btn btn-sm" type="button" data-act="refresh">Refresh</button>
      </div>
      <div id="ws-banner" role="status" aria-live="polite"></div>
      <div class="ws-formula" id="ws-formula"></div>
      <div class="ws-grid-host" id="ws-grid"></div>
      <div class="ws-sheet-tabs" id="ws-tabs" role="tablist" aria-label="Sheets"></div>
      <p class="muted ws-sheet-foot" id="ws-foot"></p>
    </div>`,
  );
  const $ = (sel) => el.querySelector(sel);
  document.title = `${s.info.title} · Dua`;

  const activeSheet = () => {
    const live = liveSheets(s.wb);
    const sheet = (s.sheetId && findLiveSheet(s.wb, s.sheetId)) || live[0] || null;
    s.sheetId = sheet ? sheet.id : null;
    return sheet;
  };

  // Calculated results for the sheet on screen. Rebuilt whenever the sheet may have changed (its version moves on every
  // change, ours or anyone's) or another sheet is shown.
  let calcCache = { sheet: null, seq: -1, calc: null };
  function calcFor(sheet) {
    if (!sheet) return null;
    if (calcCache.sheet !== sheet || calcCache.seq !== s.wb.head_seq)
      calcCache = { sheet, seq: s.wb.head_seq, calc: createSheetCalc(sheet) };
    return calcCache.calc;
  }

  const sender = createOperationSender({ docId: id });
  const editor = createCellEditor($('#ws-formula'), {
    getSheet: activeSheet,
    getHeadSeq: () => s.wb.head_seq,
    sender,
    canEdit,
    refresh: () => sync(),
    notify(text) {
      s.notice = text;
      drawBanner();
    },
  });

  const grid = createGridView($('#ws-grid'), {
    measure,
    onSelect(info) {
      if (!editor.select(info)) {
        // unsaved text on another cell: stay there, and say why
        const c = editor.cell();
        s.notice = `Save or cancel your change to ${c.label} first.`;
        drawBanner();
        grid.select(c.rowId, c.colId, { reveal: false });
      }
    },
  });

  function drawHead() {
    $('#ws-sheet-title').textContent = s.info.title;
    $('#ws-role').textContent = roleLabel(s.info.role);
    const when = `Updated ${relativeWhen(new Date(s.syncedAt).toISOString())}.`;
    $('#ws-foot').textContent = s.info.archived
      ? `Archived, so it cannot be changed. ${when}`
      : canEdit()
        ? `Tap a cell, type, then Save. Start with = to enter a formula. Formatting arrives in a later update. ${when}`
        : `You can view this workbook but not change it. ${when}`;
    const refresh = $('[data-act="refresh"]');
    refresh.disabled = s.busy;
    refresh.textContent = s.busy ? 'Refreshing…' : 'Refresh';
  }

  function drawBanner() {
    const box = $('#ws-banner');
    const parts = [];
    if (s.info.archived) parts.push(html`<p class="ws-banner">This workbook is archived. It cannot be changed.</p>`);
    if (s.error) parts.push(html`<p class="ws-banner ws-banner-warn">${s.error}</p>`);
    else if (s.notice) parts.push(html`<p class="ws-banner">${s.notice}</p>`);
    if (!activeSheet()) {
      parts.push(
        canEdit()
          ? html`<div class="card">
              <p>This workbook has no sheet yet.</p>
              <button class="btn btn-primary" type="button" data-act="add-sheet" ${s.busy ? 'disabled' : ''}>Add a sheet</button>
            </div>`
          : html`<div class="card"><p class="muted">This workbook has no sheet yet.</p></div>`,
      );
    }
    render(box, html`${parts}`);
  }

  function drawTabs() {
    const live = liveSheets(s.wb);
    const current = activeSheet();
    const bar = $('#ws-tabs');
    bar.hidden = live.length === 0;
    bar.replaceChildren(
      ...live.map((sh) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = sh.id === current?.id ? 'ws-tab is-active' : 'ws-tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', sh.id === current?.id ? 'true' : 'false');
        b.dataset.sheet = sh.id;
        b.textContent = sh.name;
        return b;
      }),
    );
  }

  function drawAll() {
    drawHead();
    drawBanner();
    drawTabs();
    grid.setSheet(activeSheet(), calcFor(activeSheet()));
    $('#ws-grid').hidden = !activeSheet();
  }

  async function runSync({ silent = false } = {}) {
    s.busy = true;
    s.notice = '';
    drawHead();
    try {
      const result = await pullAndApply(s.wb, id);
      if (result.status === 'reload') {
        const again = await openWorkbookFull(id);
        s.wb = again.wb;
        s.info = again.info;
        s.notice = 'This workbook was restored or changed a lot, so it was loaded again.';
      }
      s.syncedAt = Date.now();
      s.error = '';
    } catch (e) {
      // A failed refresh never blanks what is on screen.
      if (silent) s.notice = 'Could not refresh. Showing what was loaded earlier.';
      else s.error = e.message;
    }
    s.busy = false;
    drawAll();
  }

  // Refreshes run one after another, so a pull that a save depends on is never skipped because another one was running.
  let chain = Promise.resolve();
  const sync = (options) => {
    s.busy = true; // the button shows it at once
    drawHead();
    chain = chain.then(() => runSync(options));
    return chain;
  };

  async function addFirstSheet() {
    if (s.busy || !canEdit()) return;
    s.busy = true;
    s.error = '';
    drawBanner();
    let added = false;
    try {
      const sender = createOperationSender({ docId: id });
      sender.enqueue(buildOp('add_sheet', { sheet_id: newId(), name: 'Sheet1' }));
      const r = await sender.flush();
      if (r.status !== 'answered') {
        s.error = r.status === 'refused' ? r.error.message : 'You seem to be offline. Try again when you are back online.';
      } else if (r.results[0].result.status !== 'applied') {
        s.error = r.results[0].result.reason ?? 'The sheet could not be added.';
      } else {
        added = true;
      }
    } catch (e) {
      s.error = e.message;
    }
    s.busy = false;
    if (added) await sync();
    else drawAll(); // keep the message on screen
  }

  el.addEventListener('click', async (e) => {
    const link = e.target.closest('a[href="#/workspace"]');
    if (link && editor.hasUnsaved()) {
      e.preventDefault();
      const leave = await confirmAction({
        title: 'Leave without saving?',
        message: `Your change to ${editor.where()} is not saved.`,
        confirmLabel: 'Leave',
        danger: true,
      });
      if (leave) location.hash = '#/workspace';
      return;
    }
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.act === 'refresh') sync();
    else if (b.dataset.act === 'add-sheet') addFirstSheet();
    else if (b.dataset.sheet) {
      if (editor.hasUnsaved()) {
        s.notice = `Save or cancel your change to ${editor.where()} before switching sheets.`;
        drawBanner();
        return;
      }
      s.sheetId = b.dataset.sheet;
      drawTabs();
      grid.setSheet(activeSheet(), calcFor(activeSheet()));
    }
  });

  const guard = (e) => {
    if (editor.hasUnsaved()) e.preventDefault(); // closing the tab or reloading asks first
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - s.syncedAt > STALE_MS) sync({ silent: true });
  };
  const onHash = () => {
    removeEventListener('hashchange', onHash);
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('beforeunload', guard);
    grid.destroy();
  };
  addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('beforeunload', guard);

  drawAll();
  return undefined;
}
