// @vitest-environment jsdom
// Cell editing end to end: the real screen, the real data layer, and the JS reference model standing in for the database
// (the parity test ties that model to the database). A second person is simulated by applying operations to the server
// directly.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], handler: null, styleRows: () => [], confirm: vi.fn() }));

vi.mock('../../js/core/supabase.js', () => ({
  db: () => ({
    rpc: (name, args) => {
      h.calls.push([name, JSON.parse(JSON.stringify(args))]);
      try {
        const data = h.handler(name, args);
        return Promise.resolve({ data: data === undefined ? null : JSON.parse(JSON.stringify(data)), error: null });
      } catch (error) {
        return Promise.resolve({ data: null, error });
      }
    },
    from: () => {
      const q = { filters: {} };
      q.select = () => q;
      q.eq = (k, v) => ((q.filters[k] = v), q);
      q.order = () => q;
      q.then = (res, rej) => Promise.resolve({ data: JSON.parse(JSON.stringify(h.styleRows(q.filters))), error: null }).then(res, rej);
      return q;
    },
  }),
}));
vi.mock('../../js/modules/workspace/ui/panel.js', () => ({ confirmAction: h.confirm, askText: vi.fn(), openPanel: vi.fn() }));

import { OPEN_KEY } from '../../js/modules/workspace/domain/documents.js';
import {
  applyOps,
  buildOp,
  CallRefused,
  createWorkbook,
  findSheet,
  liveSheets,
  pull as modelPull,
} from '../../js/modules/workspace/domain/spreadsheet.js';
import { mount } from '../../js/modules/workspace/ui/sheet.js';

const DOC = '0a000000-0000-4000-8000-00000000000d';
const SHEET = '0a000000-0000-4000-8000-0000000000e1';
const VIEW = { width: 400, height: 300 };
const net = () => ({ message: 'TypeError: Failed to fetch' });
const filled = (x) => x.value !== null || x.formula !== null || x.style_id !== null;

let server;
let role;
let archived;
let fail; // rpc name -> errors thrown before the call does anything
let afterCall; // rpc name -> function run after the server applied the call (to lose the reply)
let override; // rpc name -> function returning a canned answer

function serve() {
  h.styleRows = (f) => {
    const s = server.sheets.find((x) => x.id === f.sheet_id);
    return [...(s?.styles.entries() ?? [])].map(([style_id, style]) => ({ style_id, style }));
  };
  h.handler = (name, args) => {
    if (fail[name]?.length) throw fail[name].shift();
    if (override[name]) return override[name](args);
    let out;
    if (name === 'workspace_workbook_open') {
      out = {
        id: DOC,
        title: 'Stock take',
        role,
        archived,
        head_version: server.head_seq,
        history_visible_to_viewers: false,
        sheets: liveSheets(server).map((s) => ({
          id: s.id,
          name: s.name,
          position: s.position,
          row_order: s.row_order,
          col_order: s.col_order,
          row_sizes: s.row_sizes,
          col_sizes: s.col_sizes,
          frozen_rows: s.frozen_rows,
          frozen_cols: s.frozen_cols,
        })),
      };
    } else if (name === 'workspace_load_sheet') {
      const s = server.sheets.find((x) => x.id === args.p_sheet);
      out = [...s.cells.values()]
        .filter(filled)
        .sort((a, b) => a.r - b.r || a.c - b.c)
        .filter((x) => args.p_after_row === null || x.r > args.p_after_row || (x.r === args.p_after_row && x.c > args.p_after_col))
        .slice(0, args.p_limit)
        .map((x) => ({ row_id: x.r, col_id: x.c, value: x.value, formula: x.formula, style_id: x.style_id, last_seq: x.last_seq }));
    } else if (name === 'workspace_pull') {
      out = modelPull(server, args.p_since, args.p_limit);
    } else if (name === 'workspace_apply_ops') {
      try {
        out = applyOps(server, args.p_ops, { deviceId: args.p_device });
      } catch (e) {
        if (e instanceof CallRefused) throw { code: 'WS001', message: e.message };
        throw e;
      }
    } else {
      throw new Error(`unexpected call ${name}`);
    }
    afterCall[name]?.(args, out);
    return out;
  };
}

function seed() {
  const wb = createWorkbook();
  applyOps(wb, [
    buildOp('add_sheet', { sheet_id: SHEET, name: 'Stock' }),
    buildOp('set_styles', { sheet_id: SHEET, styles: [{ style_id: 1, style: { weight: 'bold', bg: '#ffeecc' } }] }),
  ]);
  applyOps(wb, [
    buildOp('set_cells', {
      sheet_id: SHEET,
      base_seq: wb.head_seq,
      cells: [
        { r: 1, c: 1, value: 'Item', style_id: 1 },
        { r: 2, c: 1, value: 'Panadol' },
        { r: 2, c: 2, value: 1500 },
        { r: 3, c: 1, value: '42' },
        { r: 4, c: 1, value: 'a\nb' },
        { r: 5, c: 1, formula: '=B2*2' },
        { r: 6, c: 1, value: 1e21 },
      ],
    }),
  ]);
  return wb;
}

const serverCell = (r, c) => findSheet(server, SHEET).cells.get(`${r}:${c}`);
const otherEdit = (r, c, value) =>
  applyOps(server, [buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r, c, value }] })]);

let host;
const at = (row, col) => host.querySelector(`.ws-cell[data-row="${row}"][data-col="${col}"]`);
const box = () => host.querySelector('.ws-edit-input');
const btn = (name) => host.querySelector(`[data-edit="${name}"]`);
const msg = () => host.querySelector('.ws-edit-msg').textContent;
const banner = () => host.querySelector('#ws-banner').textContent;
const applyCalls = () => h.calls.filter(([n]) => n === 'workspace_apply_ops');
const settle = () => new Promise((r) => setTimeout(r, 0));

function select(row, col) {
  at(row, col).click();
}
function type(text) {
  box().value = text;
  box().dispatchEvent(new Event('input', { bubbles: true }));
}
const press = (key, extra = {}) => box().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const saved = () => vi.waitFor(() => expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true));

async function open() {
  sessionStorage.setItem(OPEN_KEY, DOC);
  await mount(host, { measure: () => VIEW });
  await vi.waitFor(() => expect(at(0, 0)).not.toBeNull());
}

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  sessionStorage.clear();
  h.calls = [];
  h.confirm.mockReset();
  server = seed();
  role = 'owner';
  archived = false;
  fail = {};
  afterCall = {};
  override = {};
  serve();
  location.hash = '#/workspace/sheet';
  await settle(); // let jsdom's hash change report pass before anything is mounted
});
afterEach(() => {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  host.remove();
});

describe('saving an edit', () => {
  it('stores the text, keeps the cell formatting, and shows the saved result', async () => {
    await open();
    select(0, 0); // "Item", which is bold on a coloured background
    expect(box().value).toBe('Item');
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true); // nothing to save yet
    type('Product');
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(false);
    btn('save').click();
    await vi.waitFor(() => expect(serverCell(1, 1).value).toBe('Product'));
    expect(serverCell(1, 1).style_id).toBe(1); // formatting kept
    await vi.waitFor(() => expect(at(0, 0).textContent).toBe('Product'));
    expect(at(0, 0).style.fontWeight).toBe('700');
    expect(box().value).toBe('Product');
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true);
    expect(applyCalls()).toHaveLength(1);
    expect(applyCalls()[0][1].p_ops[0].payload.base_seq).toBe(3); // the version the edit started from
  });

  it('stores what was typed as the right kind of value', async () => {
    await open();
    const put = async (row, text) => {
      select(row, 1);
      type(text);
      btn('save').click();
      await vi.waitFor(() => expect(applyCalls().length).toBeGreaterThan(0));
      await saved();
      h.calls = [];
    };
    await put(7, '42.5');
    expect(serverCell(8, 2).value).toBe(42.5);
    await put(8, '00123');
    expect(serverCell(9, 2).value).toBe('00123'); // a batch code stays text
    await put(9, 'true');
    expect(serverCell(10, 2).value).toBe(true);
    await put(10, "'42");
    expect(serverCell(11, 2).value).toBe('42'); // the apostrophe forces text and is not stored
    await put(11, 'دوا 😀');
    expect(serverCell(12, 2).value).toBe('دوا 😀');
  });

  it('clearing a cell removes the content but keeps its formatting', async () => {
    await open();
    select(0, 0);
    type('');
    btn('save').click();
    await vi.waitFor(() => expect(serverCell(1, 1).value).toBe(null));
    expect(serverCell(1, 1).style_id).toBe(1);
  });

  it('Enter saves, Shift+Enter does not, Escape puts the old text back', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    press('Enter', { shiftKey: true });
    await settle();
    expect(applyCalls()).toHaveLength(0);
    press('Escape');
    expect(box().value).toBe('Panadol');
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true);
    type('Brufen');
    press('Enter');
    await vi.waitFor(() => expect(serverCell(2, 1).value).toBe('Brufen'));
  });

  it('refuses a formula for now and sends nothing', async () => {
    await open();
    select(1, 0);
    type('=A1+B1');
    btn('save').click();
    await settle();
    expect(msg()).toContain('Formulas can be entered in a later update');
    expect(applyCalls()).toHaveLength(0);
    expect(serverCell(2, 1).value).toBe('Panadol');
    expect(box().value).toBe('=A1+B1'); // the draft is still there
  });

  it('refuses text that is too long for a cell', async () => {
    await open();
    select(1, 0);
    type('x'.repeat(32768));
    btn('save').click();
    await settle();
    expect(msg()).toContain('32,767');
    expect(applyCalls()).toHaveLength(0);
  });

  it('shows text with a line break unchanged and does not treat it as an edit', async () => {
    await open();
    select(3, 0);
    expect(box().value).toBe('a\nb');
    expect(box().rows).toBe(2);
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true);
    // text that looks like a number is shown with an apostrophe, so saving it unchanged cannot turn it into a number
    select(2, 0);
    expect(box().value).toBe("'42");
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true);
  });

  it('shows formulas and numbers that cannot be typed back as read-only, with the reason', async () => {
    await open();
    select(4, 0);
    expect(box().value).toBe('=B2*2');
    expect(box().readOnly).toBe(true);
    expect(msg()).toContain('later update');
    select(5, 0);
    expect(box().readOnly).toBe(true);
    expect(msg()).toContain('too large or too precise');
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true);
  });
});

describe('who may edit', () => {
  it('a viewer sees the content but has nothing to save', async () => {
    role = 'viewer';
    await open();
    select(1, 0);
    expect(box().value).toBe('Panadol');
    expect(box().readOnly).toBe(true);
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true);
    expect(host.querySelector('#ws-foot').textContent).toContain('view this workbook but not change it');
  });

  it('an archived workbook cannot be edited even by its owner', async () => {
    archived = true;
    await open();
    select(1, 0);
    expect(box().readOnly).toBe(true);
    expect(host.querySelector('#ws-foot').textContent).toContain('Archived');
  });
});

describe('unsaved text is never dropped silently', () => {
  it('stays on the cell and says why when another cell is tapped with unsaved text', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    select(1, 1);
    expect(banner()).toContain('Save or cancel your change to A2 first');
    expect(host.querySelector('.ws-formula-label').textContent).toBe('A2');
    expect(box().value).toBe('Brufen');
    expect(at(1, 0).classList.contains('is-selected')).toBe(true);
    expect(at(1, 1).classList.contains('is-selected')).toBe(false);
    // after Cancel the person can move on
    btn('cancel').click();
    select(1, 1);
    expect(host.querySelector('.ws-formula-label').textContent).toBe('B2');
    expect(box().value).toBe('1500');
  });

  it('moving to another cell with nothing unsaved is free, and so is a refresh while typing', async () => {
    await open();
    select(1, 0);
    select(1, 1);
    expect(host.querySelector('.ws-formula-label').textContent).toBe('B2');
    select(1, 0);
    type('Brufen');
    otherEdit(5, 5, 'elsewhere');
    host.querySelector('[data-act="refresh"]').click();
    await vi.waitFor(() => expect(host.querySelector('[data-act="refresh"]').disabled).toBe(false));
    expect(box().value).toBe('Brufen'); // the refresh did not touch the draft
  });

  it('will not switch sheets, and asks before leaving the page, while there is unsaved text', async () => {
    applyOps(server, [buildOp('add_sheet', { sheet_id: '0a000000-0000-4000-8000-0000000000e2', name: 'Prices' })]);
    await open();
    select(1, 0);
    type('Brufen');
    host.querySelector('[data-sheet="0a000000-0000-4000-8000-0000000000e2"]').click();
    expect(banner()).toContain('before switching sheets');
    expect(host.querySelector('.ws-tab.is-active').textContent).toBe('Stock');

    h.confirm.mockResolvedValueOnce(false);
    host.querySelector('a[href="#/workspace"]').click();
    await settle();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm.mock.calls[0][0].message).toContain('A2');
    expect(location.hash).toBe('#/workspace/sheet'); // stayed

    h.confirm.mockResolvedValueOnce(true);
    host.querySelector('a[href="#/workspace"]').click();
    await vi.waitFor(() => expect(location.hash).toBe('#/workspace'));
  });

  it('asks the browser before the tab is closed, only while there is something unsaved', async () => {
    await open();
    select(1, 0);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    type('Brufen');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('keeps a draft whose cell was deleted by someone else visible in a message instead of losing it', async () => {
    await open();
    select(1, 0);
    type('My important note');
    applyOps(server, [buildOp('delete_rows', { sheet_id: SHEET, ids: [2] })]);
    host.querySelector('[data-act="refresh"]').click();
    await vi.waitFor(() => expect(banner()).toContain('no longer exists'));
    expect(banner()).toContain('My important note');
    expect(host.querySelector('.ws-formula-label').textContent).toBe('—');
  });
});

describe('when the network fails', () => {
  it('keeps the change locked and resent with the SAME operation id until it is answered', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    fail.workspace_apply_ops = [net()];
    btn('save').click();
    await vi.waitFor(() => expect(msg()).toContain('offline'));
    expect(box().readOnly).toBe(true); // cannot be edited while an unanswered change is waiting
    expect(btn('save').textContent).toBe('Try again');
    expect(btn('cancel').textContent).toBe('Discard');
    expect(serverCell(2, 1).value).toBe('Panadol');

    btn('save').click();
    await vi.waitFor(() => expect(serverCell(2, 1).value).toBe('Brufen'));
    const [first, second] = applyCalls();
    expect(second[1].p_ops).toEqual(first[1].p_ops); // identical, down to the operation id
    await vi.waitFor(() => expect(box().readOnly).toBe(false));
    expect(at(1, 0).textContent).toBe('Brufen');
  });

  it('a reply lost AFTER the server applied the change is not a conflict with oneself', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    afterCall.workspace_apply_ops = () => {
      delete afterCall.workspace_apply_ops;
      throw net(); // the server applied it, the answer never arrived
    };
    btn('save').click();
    await vi.waitFor(() => expect(msg()).toContain('offline'));
    expect(serverCell(2, 1).value).toBe('Brufen'); // it did reach the server
    const headAfterFirst = server.head_seq;
    btn('save').click(); // Try again: the same id, answered as a duplicate
    await vi.waitFor(() => expect(box().readOnly).toBe(false));
    expect(host.querySelector('.ws-edit-choice').hidden).toBe(true); // no conflict panel
    expect(server.head_seq).toBe(headAfterFirst); // applied once
    expect(at(1, 0).textContent).toBe('Brufen');
  });

  it('Discard drops the waiting change, says what that means, and unlocks the box', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    fail.workspace_apply_ops = [net()];
    btn('save').click();
    await vi.waitFor(() => expect(msg()).toContain('offline'));
    btn('cancel').click();
    expect(banner()).toContain('Refresh will show it');
    expect(box().readOnly).toBe(false);
    expect(box().value).toBe('Panadol');
    // a new edit is a new operation
    type('Aspirin');
    btn('save').click();
    await vi.waitFor(() => expect(serverCell(2, 1).value).toBe('Aspirin'));
    const ids = applyCalls().map(([, a]) => a.p_ops[0].operation_id);
    expect(new Set(ids).size).toBe(2);
  });

  it('shows a refusal in plain words and lets the person fix and retry', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    fail.workspace_apply_ops = [{ code: '42501', message: 'not allowed' }];
    btn('save').click();
    await vi.waitFor(() => expect(msg()).toContain('You do not have access to this.'));
    expect(box().readOnly).toBe(false);
    expect(box().value).toBe('Brufen'); // the text is still there
    btn('save').click();
    await vi.waitFor(() => expect(serverCell(2, 1).value).toBe('Brufen'));
  });

  it('shows why the server did not accept a change', async () => {
    await open();
    select(1, 0);
    type('Brufen');
    override.workspace_apply_ops = (args) => ({
      results: [{ operation_id: args.p_ops[0].operation_id, status: 'rejected', reason: 'a cell can hold at most 32,767 characters' }],
      head_seq: server.head_seq,
    });
    btn('save').click();
    await vi.waitFor(() => expect(msg()).toContain('at most 32,767 characters'));
    expect(box().value).toBe('Brufen');
  });
});

describe('when someone else changed the same cell', () => {
  it('shows both versions and keeps theirs when asked', async () => {
    await open();
    select(1, 0);
    type('Mine');
    otherEdit(2, 1, 'Theirs'); // not yet pulled: the local copy is stale
    btn('save').click();
    await vi.waitFor(() => expect(host.querySelector('.ws-edit-choice').hidden).toBe(false));
    expect(msg()).toContain('Someone else changed A2');
    expect(btn('save').closest('.ws-edit-actions').hidden).toBe(true); // the two choices below replace Save and Cancel
    expect(msg()).toContain('Theirs');
    expect(msg()).toContain('Mine');
    expect(serverCell(2, 1).value).toBe('Theirs'); // not overwritten
    btn('keep-theirs').click();
    expect(box().value).toBe('Theirs');
    expect(host.querySelector('.ws-edit-choice').hidden).toBe(true);
    expect(at(1, 0).textContent).toBe('Theirs');
  });

  it('"Use mine" sends it again from a current copy and it is accepted', async () => {
    await open();
    select(1, 0);
    type('Mine');
    otherEdit(2, 1, 'Theirs');
    btn('save').click();
    await vi.waitFor(() => expect(host.querySelector('.ws-edit-choice').hidden).toBe(false));
    btn('use-mine').click();
    await vi.waitFor(() => expect(serverCell(2, 1).value).toBe('Mine'));
    await vi.waitFor(() => expect(at(1, 0).textContent).toBe('Mine'));
    expect(host.querySelector('.ws-edit-choice').hidden).toBe(true);
  });

  it('a change pulled in WHILE the draft is open is still a conflict, never a silent overwrite', async () => {
    await open();
    select(1, 0);
    type('Mine');
    otherEdit(2, 1, 'Theirs');
    host.querySelector('[data-act="refresh"]').click(); // their change arrives in the local copy
    await vi.waitFor(() => expect(host.querySelector('[data-act="refresh"]').disabled).toBe(false));
    expect(box().value).toBe('Mine'); // the draft is kept
    btn('save').click();
    await vi.waitFor(() => expect(host.querySelector('.ws-edit-choice').hidden).toBe(false));
    expect(serverCell(2, 1).value).toBe('Theirs'); // base was the version the edit STARTED from
  });

  it('when the row was deleted meanwhile, the text is kept in a message rather than lost', async () => {
    await open();
    select(1, 0);
    type('Mine');
    applyOps(server, [buildOp('delete_rows', { sheet_id: SHEET, ids: [2] })]);
    btn('save').click();
    await vi.waitFor(() => expect(banner()).toContain('no longer exists'));
    expect(banner()).toContain('Mine');
    expect(host.querySelector('.ws-formula-label').textContent).toBe('—');
    expect(box().disabled).toBe(true); // nothing is left half-open
  });

  it('a conflict changes nothing on the server except the recorded conflict', async () => {
    await open();
    select(1, 0);
    type('Mine');
    otherEdit(2, 1, 'Theirs');
    btn('save').click();
    await vi.waitFor(() => expect(host.querySelector('.ws-edit-choice').hidden).toBe(false));
    expect(serverCell(2, 1).value).toBe('Theirs');
    expect(server.conflicts.length).toBe(1); // the database keeps it for the conflicts list (a later phase)
  });
});

describe('what the edit files must never do', () => {
  it('cellEditor.js builds nothing from strings', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('js/modules/workspace/ui/cellEditor.js', 'utf8');
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|cssText|setAttribute\(\s*['"]style|\beval\b|new Function/);
  });
});

describe('the stylesheet (a bug found in a real browser: the conflict buttons showed all the time)', () => {
  // jsdom does not apply specificity or !important, so it cannot show this bug; the real browser did. This guards the rule.
  it('makes the hidden attribute win inside the edit bar, where classes set display: flex', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('css/workspace.css', 'utf8');
    expect(css).toMatch(/\.ws-formula \[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
    expect(css).toMatch(/\.ws-edit-choice\s*\{[^}]*display:\s*flex/); // the rule that made the guard necessary
  });
});
