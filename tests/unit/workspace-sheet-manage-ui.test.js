// @vitest-environment jsdom
// Sheet management end to end: the real screen, the real data layer, and the JS reference model standing in for the database
// (the parity test ties that model to the database). A second person is simulated by applying operations to the server
// directly. The panel's two small dialogs (a name, a confirmation) are answered by the test.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], handler: null, styleRows: () => [], confirm: vi.fn(), ask: vi.fn() }));

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
vi.mock('../../js/modules/workspace/ui/panel.js', async (orig) => ({
  ...(await orig()),
  confirmAction: h.confirm,
  askText: h.ask,
}));

import { OPEN_KEY } from '../../js/modules/workspace/domain/documents.js';
import {
  applyOps,
  buildOp,
  CallRefused,
  createWorkbook,
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

const S2 = '0a000000-0000-4000-8000-0000000000e2';
const S3 = '0a000000-0000-4000-8000-0000000000e3';

function seed() {
  const wb = createWorkbook();
  applyOps(wb, [
    buildOp('add_sheet', { sheet_id: SHEET, name: 'Stock' }),
    buildOp('add_sheet', { sheet_id: S2, name: 'Sales' }),
    buildOp('add_sheet', { sheet_id: S3, name: 'Archive' }),
  ]);
  applyOps(wb, [
    buildOp('set_cells', {
      sheet_id: SHEET,
      base_seq: wb.head_seq,
      cells: [
        { r: 1, c: 1, value: 'Item' },
        { r: 2, c: 1, value: 'Panadol' },
      ],
    }),
  ]);
  return wb;
}

const names = () => liveSheets(server).map((s) => s.name);
const otherOp = (type, payload) => applyOps(server, [buildOp(type, payload)]);

let host;
const settle = () => new Promise((r) => setTimeout(r, 0));
const tabs = () => [...host.querySelectorAll('.ws-tab')].map((b) => b.textContent);
const panel = () => document.querySelector('.ws-panel');
const pbtn = (act, id) => panel().querySelector(`[data-act="${act}"]${id ? `[data-sheet="${id}"]` : ''}`);
const status = () => panel().querySelector('[role="status"]').textContent;
const banner = () => host.querySelector('#ws-banner').textContent;
const applyCalls = () => h.calls.filter(([n]) => n === 'workspace_apply_ops');

async function open() {
  sessionStorage.setItem(OPEN_KEY, DOC);
  await mount(host, { measure: () => VIEW });
  await vi.waitFor(() => expect(host.querySelector('.ws-cell')).not.toBeNull());
}
const openPanelNow = () => {
  host.querySelector('[data-act="manage-sheets"]').click();
  expect(panel()).not.toBeNull();
};
const rows = () => [...panel().querySelectorAll('.ws-sheet-row .ws-sheet-name')].map((n) => n.firstChild.textContent);

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  sessionStorage.clear();
  h.calls = [];
  h.confirm.mockReset();
  h.ask.mockReset();
  server = seed();
  role = 'owner';
  archived = false;
  fail = {};
  afterCall = {};
  override = {};
  serve();
  location.hash = '#/workspace/sheet';
  await settle();
});
afterEach(() => {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  document.querySelectorAll('.ws-backdrop').forEach((n) => n.remove());
  host.remove();
});

describe('the Sheets panel', () => {
  it('lists the sheets in order and marks the one that is open', async () => {
    await open();
    openPanelNow();
    expect(rows()).toEqual(['Stock', 'Sales', 'Archive']);
    expect(panel().textContent).toContain('3 of 20 sheets');
    expect(panel().querySelector('.pill').textContent).toBe('Open');
    expect(pbtn('earlier', SHEET).disabled).toBe(true); // first cannot go earlier
    expect(pbtn('later', S3).disabled).toBe(true); // last cannot go later
  });

  it('a viewer sees the list but no way to change it', async () => {
    role = 'viewer';
    await open();
    expect(host.querySelector('#ws-add-sheet').hidden).toBe(true);
    openPanelNow();
    expect(rows()).toEqual(['Stock', 'Sales', 'Archive']);
    expect(panel().querySelector('[data-act="rename"], [data-act="delete"], [data-act="add"]')).toBeNull();
    expect(panel().textContent).toContain('not change its sheets');
  });

  it('an archived workbook cannot have its sheets changed', async () => {
    archived = true;
    await open();
    openPanelNow();
    expect(panel().querySelector('[data-act="delete"]')).toBeNull();
  });
});

describe('adding a sheet', () => {
  it('asks for a name (Sheet4 is suggested), adds the sheet last and shows its tab', async () => {
    await open();
    h.ask.mockResolvedValue('Totals');
    host.querySelector('#ws-add-sheet').click();
    await vi.waitFor(() => expect(names()).toEqual(['Stock', 'Sales', 'Archive', 'Totals']));
    expect(h.ask.mock.calls[0][0]).toMatchObject({ value: 'Sheet4', maxLength: 31 });
    await vi.waitFor(() => expect(tabs()).toEqual(['Stock', 'Sales', 'Archive', 'Totals']));
    expect(banner()).toContain('Added the sheet Totals.');
    expect(applyCalls()).toHaveLength(1);
  });

  it('asks again, saying why, until the name is usable (capitals do not make a name different)', async () => {
    await open();
    openPanelNow();
    h.ask.mockResolvedValueOnce('stock').mockResolvedValueOnce('   ').mockResolvedValueOnce('x'.repeat(32)).mockResolvedValueOnce('Totals');
    pbtn('add').click();
    await vi.waitFor(() => expect(names()).toContain('Totals'));
    expect(h.ask).toHaveBeenCalledTimes(4);
    expect(h.ask.mock.calls[1][0].label).toContain('Another sheet already has that name.');
    expect(h.ask.mock.calls[2][0].label).toContain('needs a name');
    expect(h.ask.mock.calls[3][0].label).toContain('at most 31');
    expect(applyCalls()).toHaveLength(1); // nothing was sent for a name that was refused here
  });

  it('cancelling the name sends nothing', async () => {
    await open();
    openPanelNow();
    h.ask.mockResolvedValue(null);
    pbtn('add').click();
    await settle();
    await settle();
    expect(applyCalls()).toHaveLength(0);
    expect(names()).toHaveLength(3);
  });

  it('stops at 20 sheets and says so', async () => {
    for (let i = 4; i <= 20; i += 1)
      otherOp('add_sheet', { sheet_id: `0a000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, name: `S${i}` });
    await open();
    openPanelNow();
    expect(panel().textContent).toContain('20 of 20 sheets');
    expect(pbtn('add').disabled).toBe(true);
    panel().querySelector('.ws-backdrop, .ws-panel-head button').click();
    host.querySelector('#ws-add-sheet').click();
    await settle();
    expect(h.ask).not.toHaveBeenCalled();
    expect(banner()).toContain('at most 20 sheets');
  });

  it("shows the database's refusal when someone else took the name a moment ago", async () => {
    await open();
    openPanelNow();
    h.ask.mockImplementation(async () => {
      otherOp('add_sheet', { sheet_id: '0a000000-0000-4000-8000-0000000000f1', name: 'Totals' }); // lands while the dialog is open
      return 'Totals';
    });
    pbtn('add').click();
    await vi.waitFor(() => expect(status()).toContain('Another sheet already has that name.'));
    expect(names().filter((n) => n === 'Totals')).toHaveLength(1);
  });
});

describe('renaming', () => {
  it('renames the sheet and its tab; changing only capitals is allowed; the same name sends nothing', async () => {
    await open();
    openPanelNow();
    h.ask.mockResolvedValue('Sales 2026');
    pbtn('rename', S2).click();
    await vi.waitFor(() => expect(names()).toEqual(['Stock', 'Sales 2026', 'Archive']));
    expect(h.ask.mock.calls[0][0]).toMatchObject({ value: 'Sales', confirmLabel: 'Rename' });
    await vi.waitFor(() => expect(tabs()).toContain('Sales 2026'));
    expect(rows()).toContain('Sales 2026');

    h.ask.mockResolvedValue('SALES 2026');
    pbtn('rename', S2).click();
    await vi.waitFor(() => expect(names()).toContain('SALES 2026'));

    const calls = applyCalls().length;
    h.ask.mockResolvedValue('SALES 2026');
    pbtn('rename', S2).click();
    await settle();
    await settle();
    expect(applyCalls()).toHaveLength(calls);
  });

  it("refuses another sheet's name before sending, but not its own", async () => {
    await open();
    openPanelNow();
    h.ask.mockResolvedValueOnce('archive').mockResolvedValueOnce(null);
    pbtn('rename', S2).click();
    await vi.waitFor(() => expect(h.ask).toHaveBeenCalledTimes(2));
    expect(h.ask.mock.calls[1][0].label).toContain('already has that name');
    expect(applyCalls()).toHaveLength(0);
  });
});

describe('moving sheets', () => {
  it('moves a sheet earlier or later, in the tabs and in the list, and keeps focus on the button', async () => {
    await open();
    openPanelNow();
    pbtn('earlier', S3).click();
    await vi.waitFor(() => expect(names()).toEqual(['Stock', 'Archive', 'Sales']));
    await vi.waitFor(() => expect(tabs()).toEqual(['Stock', 'Archive', 'Sales']));
    expect(rows()).toEqual(['Stock', 'Archive', 'Sales']);
    expect(applyCalls()[0][1].p_ops[0].payload.order).toEqual([SHEET, S3, S2]);
    expect(document.activeElement).toBe(pbtn('earlier', S3));
    expect(status()).toContain('Archive moved earlier.');
    pbtn('later', SHEET).click();
    await vi.waitFor(() => expect(names()).toEqual(['Archive', 'Stock', 'Sales']));
  });

  it('says what happened when someone added a sheet while the person was reordering', async () => {
    await open();
    openPanelNow();
    otherOp('add_sheet', { sheet_id: '0a000000-0000-4000-8000-0000000000f2', name: 'Extra' }); // this copy does not know yet
    pbtn('later', SHEET).click();
    await vi.waitFor(() => expect(status()).toContain('sheets changed'));
    expect(names()).toEqual(['Stock', 'Sales', 'Archive', 'Extra']); // order untouched
    await vi.waitFor(() => expect(rows()).toEqual(['Stock', 'Sales', 'Archive', 'Extra'])); // and the list caught up
  });
});

describe('deleting', () => {
  it('asks first, says what is lost, and does nothing if the person says no', async () => {
    await open();
    openPanelNow();
    h.confirm.mockResolvedValue(false);
    pbtn('delete', S2).click();
    await settle();
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ title: 'Delete Sales?', danger: true, confirmLabel: 'Delete sheet' });
    expect(h.confirm.mock.calls[0][0].message).toContain('everything on it');
    expect(applyCalls()).toHaveLength(0);
    expect(names()).toHaveLength(3);
  });

  it('deletes the sheet when confirmed; deleting the open sheet falls back to the first one', async () => {
    await open();
    openPanelNow();
    h.confirm.mockResolvedValue(true);
    pbtn('delete', SHEET).click();
    await vi.waitFor(() => expect(names()).toEqual(['Sales', 'Archive']));
    await vi.waitFor(() => expect(tabs()).toEqual(['Sales', 'Archive']));
    expect(host.querySelector('.ws-tab.is-active').textContent).toBe('Sales');
    expect(rows()).toEqual(['Sales', 'Archive']);
    expect(status()).toContain('Deleted the sheet Stock.');
  });

  it('never offers to delete the last sheet', async () => {
    otherOp('delete_sheet', { sheet_id: S2 });
    otherOp('delete_sheet', { sheet_id: S3 });
    await open();
    openPanelNow();
    expect(pbtn('delete', SHEET).disabled).toBe(true);
  });

  it('says so when someone else deleted the sheet first', async () => {
    await open();
    openPanelNow();
    h.confirm.mockImplementation(async () => {
      otherOp('delete_sheet', { sheet_id: S2 });
      return true;
    });
    pbtn('delete', S2).click();
    await vi.waitFor(() => expect(status()).toContain('no longer exists'));
    expect(names()).toEqual(['Stock', 'Archive']);
  });

  it('will not delete the sheet a person has unsaved text on', async () => {
    await open();
    host.querySelector('.ws-cell[data-row="0"][data-col="0"]').click();
    const box = host.querySelector('.ws-edit-input');
    box.value = 'Changed';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    openPanelNow();
    pbtn('delete', SHEET).click();
    await settle();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(status()).toContain('Save or cancel your change');
    expect(names()).toHaveLength(3);
  });
});

describe('when the network fails', () => {
  it('keeps the change, blocks other saves, and sends it again with the SAME operation id', async () => {
    await open();
    fail.workspace_apply_ops = [net()];
    h.ask.mockResolvedValue('Totals');
    host.querySelector('#ws-add-sheet').click();
    await vi.waitFor(() => expect(host.querySelector('[data-act="retry-sheet"]')).not.toBeNull());
    expect(banner()).toContain('offline');
    expect(names()).toHaveLength(3);

    // a cell save cannot start while the sheet change is waiting (it would be answered as if it were the sheet change)
    host.querySelector('.ws-cell[data-row="0"][data-col="0"]').click();
    const box = host.querySelector('.ws-edit-input');
    box.value = 'Changed';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('[data-edit="save"]').click();
    await settle();
    expect(host.querySelector('.ws-edit-msg').textContent).toContain('sheet change is waiting');
    expect(applyCalls()).toHaveLength(1);

    host.querySelector('[data-act="retry-sheet"]').click();
    await vi.waitFor(() => expect(names()).toContain('Totals'));
    expect(applyCalls()).toHaveLength(2);
    expect(applyCalls()[1][1].p_ops).toEqual(applyCalls()[0][1].p_ops); // byte for byte the same batch
    await vi.waitFor(() => expect(host.querySelector('[data-act="retry-sheet"]')).toBeNull());
    await vi.waitFor(() => expect(banner()).toContain('was sent'));
  });

  it('a sheet change is not started while a cell save is still unanswered (it would share its batch and be misread)', async () => {
    await open();
    fail.workspace_apply_ops = [net()];
    host.querySelector('.ws-cell[data-row="0"][data-col="0"]').click();
    const box = host.querySelector('.ws-edit-input');
    box.value = 'Changed';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector('[data-edit="save"]').click();
    await vi.waitFor(() => expect(host.querySelector('.ws-edit-msg').textContent).toContain('offline'));
    expect(applyCalls()).toHaveLength(1);
    h.ask.mockResolvedValue('Totals');
    host.querySelector('#ws-add-sheet').click();
    await vi.waitFor(() => expect(banner()).toContain('Save or cancel your cell change first.'));
    expect(applyCalls()).toHaveLength(1); // nothing new was sent
    expect(names()).not.toContain('Totals');
  });

  it('a lost reply does not add the sheet twice', async () => {
    await open();
    afterCall.workspace_apply_ops = () => {
      delete afterCall.workspace_apply_ops;
      throw net(); // the server applied the change, the answer never arrived
    };
    h.ask.mockResolvedValue('Totals');
    host.querySelector('#ws-add-sheet').click();
    await vi.waitFor(() => expect(host.querySelector('[data-act="retry-sheet"]')).not.toBeNull());
    expect(names()).toContain('Totals'); // the server has it; this copy does not know yet
    host.querySelector('[data-act="retry-sheet"]').click();
    await vi.waitFor(() => expect(host.querySelector('[data-act="retry-sheet"]')).toBeNull());
    expect(names().filter((n) => n === 'Totals')).toHaveLength(1);
    await vi.waitFor(() => expect(tabs()).toContain('Totals'));
    expect(host.querySelector('.ws-banner-warn')).toBeNull();
  });

  it('"Discard" drops the waiting change and says what that means', async () => {
    await open();
    fail.workspace_apply_ops = [net()];
    h.ask.mockResolvedValue('Totals');
    host.querySelector('#ws-add-sheet').click();
    await vi.waitFor(() => expect(host.querySelector('[data-act="discard-sheet"]')).not.toBeNull());
    host.querySelector('[data-act="discard-sheet"]').click();
    expect(banner()).toContain('Discarded');
    expect(host.querySelector('[data-act="retry-sheet"]')).toBeNull();
    // saving is possible again, and the discarded change is never sent
    h.ask.mockResolvedValue('Other');
    host.querySelector('#ws-add-sheet').click();
    await vi.waitFor(() => expect(names()).toContain('Other'));
    expect(names()).not.toContain('Totals');
  });
});
