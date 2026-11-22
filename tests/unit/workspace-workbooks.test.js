import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The "server" is the JS reference model (domain/spreadsheet.js), which is proven against the database by the parity test.
// The mocked Supabase client turns rpc() calls into calls on that model, JSON-copied like a real network answer.
const h = vi.hoisted(() => ({ calls: [], handler: null, styleRows: () => [] }));

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
    from: (tableName) => {
      const q = { filters: {} };
      q.select = () => q;
      q.eq = (k, v) => ((q.filters[k] = v), q);
      q.order = () => q;
      q.then = (res, rej) =>
        Promise.resolve({ data: JSON.parse(JSON.stringify(h.styleRows(tableName, q.filters))), error: null }).then(res, rej);
      return q;
    },
  }),
}));

import { friendlyError } from '../../js/modules/workspace/data/api.js';
import {
  applyOperations,
  checkOperation,
  checkOperations,
  createOperationSender,
  createSnapshot,
  isTransient,
  listSnapshots,
  loadSheetPage,
  openWorkbookFull,
  pullAndApply,
  restoreSnapshot,
  tally,
} from '../../js/modules/workspace/data/workbooks.js';
import {
  applyOps,
  buildOp,
  CallRefused,
  createSnapshot as modelSnapshot,
  createWorkbook,
  exportState,
  liveSheets,
  newIds,
  pull as modelPull,
  restoreSnapshot as modelRestore,
} from '../../js/modules/workspace/domain/spreadsheet.js';

const DOC = '0a000000-0000-4000-8000-00000000000d';
const SHEET = '0a000000-0000-4000-8000-0000000000e1';
const DEVICE = '0a000000-0000-4000-8000-0000000000d1';
const uid = () => globalThis.crypto.randomUUID();

const filled = (x) => x.value !== null || x.formula !== null || x.style_id !== null;

// A fake database function set backed by a model workbook.
function serve(server, { fail = {}, after = {} } = {}) {
  h.styleRows = (_table, filters) => {
    const s = server.sheets.find((x) => x.id === filters.sheet_id);
    return [...(s?.styles.entries() ?? [])].map(([style_id, style]) => ({ style_id, style })).sort((a, b) => a.style_id - b.style_id);
  };
  h.handler = (name, args) => {
    if (fail[name]?.length) throw fail[name].shift(); // an error the call never got past
    let out;
    if (name === 'workspace_workbook_open') {
      out = {
        id: DOC,
        title: 'Stock',
        role: 'owner',
        archived: false,
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
      const after = [args.p_after_row, args.p_after_col ?? 0];
      out = [...s.cells.values()]
        .filter(filled)
        .sort((a, b) => a.r - b.r || a.c - b.c)
        .filter((x) => args.p_after_row === null || x.r > after[0] || (x.r === after[0] && x.c > after[1]))
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
    after[name]?.(args, out);
    return out;
  };
}

// A server with one sheet, a style and 4 x 2 cells.
function seed() {
  const server = createWorkbook();
  applyOps(server, [
    buildOp('add_sheet', { sheet_id: SHEET, name: 'Stock' }),
    buildOp('set_styles', { sheet_id: SHEET, styles: [{ style_id: 1, style: { weight: 'bold' } }] }),
  ]);
  const cells = [];
  for (let r = 1; r <= 4; r += 1)
    for (let c = 1; c <= 2; c += 1) cells.push({ r, c, value: r * 10 + c, ...(c === 1 ? { style_id: 1 } : {}) });
  applyOps(server, [buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells })]);
  return server;
}

const visible = (wb) => {
  const s = exportState(wb);
  return { sheets: s.sheets };
};
const callsTo = (name) => h.calls.filter(([n]) => n === name);
const net = (message = 'TypeError: Failed to fetch') => ({ message });

beforeEach(() => {
  h.calls = [];
  h.handler = () => {
    throw new Error('no server');
  };
  h.styleRows = () => [];
});

describe('opening a workbook', () => {
  it('builds a local copy equal to the server: sheets, order, styles and cells', async () => {
    const server = seed();
    serve(server);
    const { wb, info, applied } = await openWorkbookFull(DOC);
    expect(visible(wb)).toEqual(visible(server));
    expect(wb.head_seq).toBe(server.head_seq);
    expect(info).toMatchObject({ id: DOC, title: 'Stock', role: 'owner', archived: false, head_version: server.head_seq });
    expect(info.sheets).toBeUndefined();
    expect(applied).toBe(0);
  });

  it('pages the cells with a moving cursor, including a last page that is exactly full', async () => {
    const server = seed(); // 8 cells
    serve(server);
    const { wb } = await openWorkbookFull(DOC, { pageSize: 4 });
    expect(visible(wb)).toEqual(visible(server));
    const pages = callsTo('workspace_load_sheet').map(([, a]) => [a.p_after_row, a.p_after_col, a.p_limit]);
    // two full pages of 4 and then an empty one that ends the loop
    expect(pages).toEqual([
      [null, null, 4],
      [2, 2, 4],
      [4, 2, 4],
    ]);
  });

  it('stops after a short page', async () => {
    const server = seed();
    serve(server);
    await openWorkbookFull(DOC, { pageSize: 5 });
    expect(callsTo('workspace_load_sheet')).toHaveLength(2);
  });

  it('does not miss edits made by someone else while pages are loading', async () => {
    const server = seed();
    let n = 0;
    serve(server, {
      after: {
        workspace_load_sheet: () => {
          n += 1;
          if (n === 1) {
            // another person edits a cell and adds rows after the first page was sent
            applyOps(server, [
              buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r: 1, c: 1, value: 'changed' }] }),
              buildOp('insert_rows', { sheet_id: SHEET, after: 100, ids: [5001, 5002] }),
            ]);
          }
        },
      },
    });
    const { wb, applied } = await openWorkbookFull(DOC, { pageSize: 4 });
    expect(visible(wb)).toEqual(visible(server));
    expect(applied).toBeGreaterThan(0);
  });

  it('starts again when the workbook was restored while it was opening, and gives up politely after the attempts', async () => {
    const server = seed();
    const snap = modelSnapshot(server, 'before');
    applyOps(server, [buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r: 1, c: 1, value: 'later' }] })]);
    let restored = false;
    serve(server, {
      after: {
        workspace_load_sheet: () => {
          if (!restored) {
            restored = true;
            modelRestore(server, snap.snapshot_id);
          }
        },
      },
    });
    const { wb } = await openWorkbookFull(DOC);
    expect(visible(wb)).toEqual(visible(server));
    expect(callsTo('workspace_workbook_open')).toHaveLength(2);

    // a workbook that is restored every time it is opened
    const again = seed();
    const s2 = modelSnapshot(again, 'x');
    serve(again, { after: { workspace_load_sheet: () => modelRestore(again, s2.snapshot_id) } });
    h.calls = [];
    await expect(openWorkbookFull(DOC, { attempts: 2 })).rejects.toThrow('This workbook changed while it was opening. Please try again.');
    expect(callsTo('workspace_workbook_open')).toHaveLength(2);
  });

  it('refuses ids that are not uuids before calling the server', async () => {
    await expect(openWorkbookFull('not-a-uuid')).rejects.toThrow('The workbook is not valid.');
    await expect(loadSheetPage('nope')).rejects.toThrow('The sheet is not valid.');
    expect(h.calls).toHaveLength(0);
  });

  it('a faulty server that repeats a page cannot loop for ever', async () => {
    h.handler = (name) => {
      if (name === 'workspace_workbook_open') return { id: DOC, head_version: 0, sheets: [{ id: SHEET, name: 'A', position: 0 }] };
      if (name === 'workspace_load_sheet') return [{ row_id: 1, col_id: 1, value: 1, formula: null, style_id: null, last_seq: 1 }];
      return [];
    };
    await expect(openWorkbookFull(DOC, { pageSize: 1 })).rejects.toThrow('The server sent something unexpected');
  });

  it('turns a database refusal into a friendly error', async () => {
    h.handler = () => {
      throw { code: '42501', message: 'not allowed' };
    };
    await expect(openWorkbookFull(DOC)).rejects.toThrow('You do not have access to this.');
  });
});

describe('pulling', () => {
  it('applies what changed since the head, page by page', async () => {
    const server = seed();
    serve(server);
    const { wb } = await openWorkbookFull(DOC);
    for (let i = 0; i < 5; i += 1) {
      applyOps(server, [buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r: 1, c: 2, value: `v${i}` }] })]);
    }
    h.calls = [];
    const result = await pullAndApply(wb, DOC, { limit: 2 });
    expect(result).toEqual({ status: 'ok', applied: 5 });
    expect(visible(wb)).toEqual(visible(server));
    expect(callsTo('workspace_pull').map(([, a]) => a.p_since)).toEqual([3, 5, 7]); // 2 + 2 + 1 operations: the short last page ends it
    expect(callsTo('workspace_pull').every(([, a]) => a.p_limit === 2)).toBe(true);
  });

  it('says "reload" when the workbook was restored', async () => {
    const server = seed();
    const snap = modelSnapshot(server, 'a');
    serve(server);
    const { wb } = await openWorkbookFull(DOC);
    modelRestore(server, snap.snapshot_id);
    const result = await pullAndApply(wb, DOC);
    expect(result.status).toBe('reload');
    expect(result.reason).toMatch(/restored/);
  });

  it('applies nothing when there is nothing new', async () => {
    const server = seed();
    serve(server);
    const { wb } = await openWorkbookFull(DOC);
    expect(await pullAndApply(wb, DOC)).toEqual({ status: 'ok', applied: 0 });
  });
});

describe('checking operations before they are sent', () => {
  const ok = () => buildOp('set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 1 }] });

  it('accepts what the model builds, including ids from newIds', () => {
    expect(() => checkOperation(ok())).not.toThrow();
    const ids = newIds(50, new Set());
    expect(ids.every((x) => x >= 1000 && x <= 2147483647)).toBe(true);
    expect(() => checkOperation(buildOp('insert_rows', { sheet_id: SHEET, after: null, ids }))).not.toThrow();
  });

  it('refuses a row or column id outside the integer range (it would undo a whole batch)', async () => {
    for (const bad of [2147483648, 0, -5, 1.5, '7', null]) {
      expect(() => checkOperation(buildOp('insert_rows', { sheet_id: SHEET, after: null, ids: [1000, bad] })), String(bad)).toThrow(
        'A row or column number is out of range.',
      );
    }
    expect(() => checkOperation(buildOp('delete_cols', { sheet_id: SHEET, ids: [2147483648] }))).toThrow('out of range');
    await expect(applyOperations({ docId: DOC, ops: [buildOp('delete_rows', { sheet_id: SHEET, ids: [3e9] })] })).rejects.toThrow(
      'out of range',
    );
    expect(h.calls).toHaveLength(0);
  });

  it('refuses bad envelopes, unknown types, repeated ids and wrong batch sizes', () => {
    expect(() => checkOperation(null)).toThrow('A change is not valid.');
    expect(() => checkOperation({ ...ok(), operation_id: 'x' })).toThrow('Every change needs its own id.');
    expect(() => checkOperation({ ...ok(), operation_type: 'drop_table' })).toThrow('That kind of change is not known.');
    expect(() => checkOperations([])).toThrow('Send between 1 and 200 changes at a time.');
    expect(() => checkOperations(Array.from({ length: 201 }, ok))).toThrow('Send between 1 and 200 changes at a time.');
    const a = ok();
    expect(() => checkOperations([a, { ...a }])).toThrow('The same change appears twice.');
  });

  it('refuses a change that is too large for one operation', () => {
    const big = buildOp('set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'x'.repeat(300000) }] });
    expect(() => checkOperation(big)).toThrow('That change is too large to send.');
  });
});

describe('applyOperations', () => {
  it('maps to workspace_apply_ops with the device id', async () => {
    const server = seed();
    serve(server);
    const op = buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r: 2, c: 2, value: 'new' }] });
    const answer = await applyOperations({ docId: DOC, ops: [op], deviceId: DEVICE });
    expect(h.calls[0]).toEqual(['workspace_apply_ops', { p_doc: DOC, p_ops: [op], p_device: DEVICE }]);
    expect(answer.results[0]).toMatchObject({ operation_id: op.operation_id, status: 'applied' });
    expect(answer.head_seq).toBe(server.head_seq);
  });

  it('passes a null device when none is given and refuses a device that is not a uuid', async () => {
    const server = seed();
    serve(server);
    await applyOperations({ docId: DOC, ops: [buildOp('resize', { sheet_id: SHEET, rows: { 1: 40 } })] });
    expect(h.calls[0][1].p_device).toBeNull();
    await expect(applyOperations({ docId: DOC, ops: [buildOp('resize', { sheet_id: SHEET, rows: {} })], deviceId: 'dev' })).rejects.toThrow(
      'The device is not valid.',
    );
  });

  it('tally counts the four answers', () => {
    expect(tally([{ status: 'applied' }, { status: 'applied' }, { status: 'conflict' }, { status: 'duplicate' }])).toEqual({
      applied: 2,
      conflict: 1,
      rejected: 0,
      duplicate: 1,
    });
  });
});

describe('the operation sender (D-45: same ids resent until answered)', () => {
  const cellOp = (server, value, r = 1, c = 2) =>
    buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r, c, value }] });
  const make = (extra = {}) =>
    createOperationSender({ docId: DOC, deviceId: DEVICE, sleep: () => Promise.resolve(), jitter: (ms) => ms, ...extra });

  it('sends a batch and reports each answer next to its operation', async () => {
    const server = seed();
    serve(server);
    const sender = make();
    const op = cellOp(server, 'a');
    sender.enqueue(op);
    const r = await sender.flush();
    expect(r.status).toBe('answered');
    expect(r.results[0].operation.operation_id).toBe(op.operation_id);
    expect(r.results[0].result.status).toBe('applied');
    expect(sender.pendingCount()).toBe(0);
    expect((await sender.flush()).status).toBe('idle');
  });

  it('after a failed send the SAME batch goes again, with the same ids and content, and the server applies it once', async () => {
    const server = seed();
    // the first call reaches the server but its reply is lost; the second is refused by the network
    let lost = 0;
    serve(server, {
      fail: { workspace_apply_ops: [] },
      after: {
        workspace_apply_ops: () => {
          lost += 1;
          if (lost === 1) throw net(); // reply lost AFTER the server applied the batch
        },
      },
    });
    const sender = make();
    const op = cellOp(server, 'once');
    sender.enqueue(op);
    const first = await sender.flush();
    expect(first.status).toBe('offline');
    expect(sender.pendingCount()).toBe(1);
    const headAfterFirst = server.head_seq;

    const second = await sender.flush();
    expect(second.status).toBe('answered');
    expect(second.results[0].result.status).toBe('duplicate'); // the server replays its first answer
    expect(second.results[0].result.original_status).toBe('applied');
    expect(server.head_seq).toBe(headAfterFirst); // not applied twice

    const sent = callsTo('workspace_apply_ops').map(([, a]) => JSON.stringify(a));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]); // byte for byte the same request
  });

  it('keeps the exact content of an unanswered batch even if the caller edits its object afterwards', async () => {
    const server = seed();
    serve(server, { fail: { workspace_apply_ops: [net()] } });
    const sender = make();
    const op = cellOp(server, 'original');
    sender.enqueue(op);
    expect((await sender.flush()).status).toBe('offline');
    op.payload.cells[0].value = 'tampered';
    expect((await sender.flush()).status).toBe('answered');
    expect(server.sheets[0].cells.get('1:2').value).toBe('original');
  });

  it('later changes wait for the unanswered batch instead of joining it', async () => {
    const server = seed();
    serve(server, { fail: { workspace_apply_ops: [net()] } });
    const sender = make();
    const a = cellOp(server, 'a');
    sender.enqueue(a);
    expect((await sender.flush()).status).toBe('offline');
    const b = cellOp(server, 'b', 2, 2);
    sender.enqueue(b);
    await sender.flush(); // resends [a] only
    expect(callsTo('workspace_apply_ops')[1][1].p_ops.map((o) => o.operation_id)).toEqual([a.operation_id]);
    await sender.flush(); // then [b]
    expect(callsTo('workspace_apply_ops')[2][1].p_ops.map((o) => o.operation_id)).toEqual([b.operation_id]);
  });

  it('cuts batches at 200 operations and keeps the order', async () => {
    const seen = [];
    const sender = make({
      send: async ({ ops }) => {
        seen.push(ops.map((o) => o.operation_id));
        return { results: ops.map((o, i) => ({ operation_id: o.operation_id, status: 'applied', seq: i + 1 })), head_seq: 9 };
      },
    });
    const ops = Array.from({ length: 450 }, () => buildOp('resize', { sheet_id: SHEET, rows: { 1: 40 } }));
    sender.enqueue(ops);
    const result = await sender.drain();
    expect(result.status).toBe('idle');
    expect(seen.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(seen.flat()).toEqual(ops.map((o) => o.operation_id));
    expect(result.answered).toHaveLength(3);
  });

  it('cuts a batch before it gets too large', async () => {
    const seen = [];
    const sender = make({
      send: async ({ ops }) => {
        seen.push(ops.length);
        return { results: ops.map((o) => ({ operation_id: o.operation_id, status: 'applied', seq: 1 })), head_seq: 1 };
      },
    });
    const text = 'x'.repeat(200000); // each change is about 200 KB; 3 MB allows 14
    sender.enqueue(
      Array.from({ length: 30 }, () => buildOp('set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: text }] })),
    );
    await sender.drain();
    expect(seen.reduce((a, b) => a + b, 0)).toBe(30);
    expect(Math.max(...seen)).toBeLessThanOrEqual(14);
    expect(seen.length).toBeGreaterThan(1);
  });

  it('drain waits between failures (2 s to 60 s), gives up as offline, and nothing is lost', async () => {
    const server = seed();
    const failures = Array.from({ length: 10 }, () => net());
    serve(server, { fail: { workspace_apply_ops: failures } });
    const waits = [];
    const sender = make({ sleep: async (ms) => void waits.push(ms) });
    const op = cellOp(server, 'patient');
    sender.enqueue(op);
    const r = await sender.drain();
    expect(r.status).toBe('offline');
    expect(waits).toEqual([2000, 5000, 15000, 30000, 60000]);
    expect(callsTo('workspace_apply_ops')).toHaveLength(6); // the first try and five retries
    expect(sender.pending().map((o) => o.operation_id)).toEqual([op.operation_id]);

    // the network comes back: the same operation id goes out and is answered
    failures.length = 0;
    const done = await sender.drain();
    expect(done.status).toBe('idle');
    expect(done.answered[0].results[0].operation.operation_id).toBe(op.operation_id);
    expect(sender.pendingCount()).toBe(0);
  });

  it('adds jitter by default, never below the base delay', async () => {
    const server = seed();
    serve(server, { fail: { workspace_apply_ops: [net(), net()] } });
    const waits = [];
    const sender = createOperationSender({ docId: DOC, sleep: async (ms) => void waits.push(ms) });
    sender.enqueue(cellOp(server, 'j'));
    await sender.drain();
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
    expect(waits[0]).toBeLessThanOrEqual(2400);
    expect(waits[1]).toBeGreaterThanOrEqual(5000);
  });

  it('holds a batch the server refuses, blocks what follows, and hands it back on request', async () => {
    const server = seed();
    serve(server, { fail: { workspace_apply_ops: [{ code: '42501', message: 'not allowed' }] } });
    const sender = make();
    const a = cellOp(server, 'a');
    const b = cellOp(server, 'b', 2, 2);
    sender.enqueue(a);
    const first = await sender.flush();
    expect(first.status).toBe('refused');
    expect(first.error.message).toBe('You do not have access to this.');
    sender.enqueue(b);
    expect(sender.hasRefused()).toBe(true);
    expect((await sender.flush()).status).toBe('refused'); // nothing is sent while a refused batch is held
    expect(callsTo('workspace_apply_ops')).toHaveLength(1);
    expect(sender.pending().map((o) => o.operation_id)).toEqual([a.operation_id, b.operation_id]); // nothing dropped

    const taken = sender.takeRefused();
    expect(taken.ops.map((o) => o.operation_id)).toEqual([a.operation_id]);
    expect(sender.hasRefused()).toBe(false);
    expect((await sender.flush()).status).toBe('answered'); // b goes out now
  });

  it('drain stops at a refusal', async () => {
    h.handler = () => {
      throw { code: 'WS001', message: 'send 1 to 200 operations' };
    };
    const sender = make();
    sender.enqueue(buildOp('resize', { sheet_id: SHEET, rows: { 1: 30 } }));
    const r = await sender.drain();
    expect(r.status).toBe('refused');
    expect(r.error.message).toBe('Send 1 to 200 operations.');
  });

  it('treats an answer that does not cover the batch as no answer and resends the same ids', async () => {
    const calls = [];
    const sender = make({
      send: async ({ ops }) => {
        calls.push(ops.map((o) => o.operation_id));
        return calls.length === 1
          ? { results: [], head_seq: 0 }
          : { results: ops.map((o) => ({ operation_id: o.operation_id, status: 'applied', seq: 1 })), head_seq: 1 };
      },
    });
    sender.enqueue(buildOp('resize', { sheet_id: SHEET, rows: { 1: 30 } }));
    expect((await sender.flush()).status).toBe('offline');
    expect(sender.pendingCount()).toBe(1);
    expect((await sender.flush()).status).toBe('answered');
    expect(calls[0]).toEqual(calls[1]);
  });

  it('two flushes at once make one call', async () => {
    let n = 0;
    const sender = make({
      send: async ({ ops }) => {
        n += 1;
        return { results: ops.map((o) => ({ operation_id: o.operation_id, status: 'applied', seq: 1 })), head_seq: 1 };
      },
    });
    sender.enqueue(buildOp('resize', { sheet_id: SHEET, rows: { 1: 30 } }));
    const [a, b] = await Promise.all([sender.flush(), sender.flush()]);
    expect(n).toBe(1);
    expect(a).toBe(b);
  });

  it('refuses a change queued twice, bad changes and bad construction', () => {
    const sender = make();
    const op = buildOp('resize', { sheet_id: SHEET, rows: { 1: 30 } });
    sender.enqueue(op);
    expect(() => sender.enqueue(op)).toThrow('That change was already queued.');
    expect(() => sender.enqueue(buildOp('insert_rows', { sheet_id: SHEET, after: null, ids: [2147483648] }))).toThrow('out of range');
    expect(sender.pendingCount()).toBe(1); // the bad one was not queued
    expect(() => createOperationSender({ docId: 'x' })).toThrow('The workbook is not valid.');
    expect(() => createOperationSender({ docId: DOC, deviceId: 'x' })).toThrow('The device is not valid.');
  });

  it('discardAll returns everything that was unsent so it can be exported', async () => {
    const server = seed();
    serve(server, { fail: { workspace_apply_ops: [net()] } });
    const sender = make();
    const a = cellOp(server, 'a');
    const b = cellOp(server, 'b', 2, 2);
    sender.enqueue([a, b]);
    await sender.flush();
    const all = sender.discardAll();
    expect(all.map((o) => o.operation_id)).toEqual([a.operation_id, b.operation_id]);
    expect(sender.pendingCount()).toBe(0);
    expect(() => sender.enqueue(a)).not.toThrow(); // its id is free again
  });

  it('end to end: edits sent, then pulled back into the local copy', async () => {
    const server = seed();
    serve(server);
    const { wb } = await openWorkbookFull(DOC);
    const sender = make();
    sender.enqueue([
      buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 1, c: 2, value: 'mine' }] }),
      buildOp('insert_rows', { sheet_id: SHEET, after: 2, ids: newIds(2, new Set([...wb.sheets[0].row_order])) }),
    ]);
    const done = await sender.drain();
    expect(tally(done.answered.flatMap((x) => x.results.map((y) => y.result)))).toMatchObject({ applied: 2 });
    expect(await pullAndApply(wb, DOC)).toMatchObject({ status: 'ok', applied: 2 });
    expect(visible(wb)).toEqual(visible(server));
  });

  it('a conflict is reported, not hidden', async () => {
    const server = seed();
    serve(server);
    const { wb } = await openWorkbookFull(DOC);
    // someone else changes the cell after our copy was made
    applyOps(server, [buildOp('set_cells', { sheet_id: SHEET, base_seq: server.head_seq, cells: [{ r: 3, c: 2, value: 'theirs' }] })]);
    const sender = make();
    sender.enqueue(buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 3, c: 2, value: 'mine' }] }));
    const done = await sender.drain();
    expect(done.answered[0].results[0].result.status).toBe('conflict');
    expect(server.sheets[0].cells.get('3:2').value).toBe('theirs');
  });
});

describe('failure classes', () => {
  it('tells waiting-it-out from never-going-to-work', () => {
    for (const code of [null, 'offline', 'PGRST301', '40001', '40P01', '57014', '53300', '08006']) {
      expect(isTransient({ code }), String(code)).toBe(true);
    }
    for (const code of ['42501', 'WS001', '22003', '23505', 'P0001', '22P02']) {
      expect(isTransient({ code }), code).toBe(false);
    }
  });
  it('friendly messages for what the Sheets functions say on purpose', () => {
    expect(friendlyError({ message: 'not a workbook' }).message).toBe('Not a workbook.');
    expect(friendlyError({ message: 'no such restore point' }).message).toBe('No such restore point.');
    expect(friendlyError({ message: 'that batch is too large' }).message).toBe('That batch is too large.');
    expect(friendlyError({ message: 'a label is at most 100 characters' }).message).toBe('A label is at most 100 characters.');
    expect(friendlyError({ message: 'the document is archived' }).message).toBe('The document is archived.');
    expect(friendlyError({ message: 'relation workspace_cells does not exist' }).message).toBe('Something went wrong. Please try again.');
  });
});

describe('restore points', () => {
  const KEY = uid();
  const SNAP = uid();

  it('maps create, list and restore to their database functions', async () => {
    h.handler = () => ({ ok: true });
    await createSnapshot({ docId: DOC, label: 'Before the audit', key: KEY });
    await listSnapshots({ docId: DOC, before: 40, limit: 10 });
    await listSnapshots({ docId: DOC });
    await restoreSnapshot({ docId: DOC, snapshotId: SNAP, key: KEY });
    expect(h.calls).toEqual([
      ['workspace_snapshot_create', { p_doc: DOC, p_label: 'Before the audit', p_key: KEY }],
      ['workspace_snapshot_list', { p_doc: DOC, p_before: 40, p_limit: 10 }],
      ['workspace_snapshot_list', { p_doc: DOC, p_before: null, p_limit: 50 }],
      ['workspace_sheet_restore', { p_doc: DOC, p_snapshot: SNAP, p_key: KEY }],
    ]);
  });

  it('needs a request key and valid ids, and does not call the server without them', async () => {
    h.handler = () => ({});
    await expect(createSnapshot({ docId: DOC })).rejects.toThrow('The request key is not valid.');
    await expect(restoreSnapshot({ docId: DOC, snapshotId: 'x', key: KEY })).rejects.toThrow('The restore point is not valid.');
    await expect(restoreSnapshot({ docId: DOC, snapshotId: SNAP })).rejects.toThrow('The request key is not valid.');
    expect(h.calls).toHaveLength(0);
  });

  it('shows friendly messages: only the owner may restore, and the label is limited', async () => {
    h.handler = () => {
      throw { code: '42501', message: 'not allowed' };
    };
    await expect(restoreSnapshot({ docId: DOC, snapshotId: SNAP, key: KEY })).rejects.toThrow('You do not have access to this.');
    h.handler = () => {
      throw { message: 'a label is at most 100 characters' };
    };
    await expect(createSnapshot({ docId: DOC, label: 'x'.repeat(101), key: KEY })).rejects.toThrow('A label is at most 100 characters.');
    h.handler = () => {
      throw { message: 'no such restore point' };
    };
    await expect(restoreSnapshot({ docId: DOC, snapshotId: SNAP, key: KEY })).rejects.toThrow('No such restore point.');
  });
});

describe('boundaries', () => {
  const src = readFileSync('js/modules/workspace/data/workbooks.js', 'utf8');
  it('talks to Supabase only through data/api.js', () => {
    expect(src).not.toMatch(/core\/supabase/);
    expect(src).not.toMatch(/\bdb\(\)/);
    expect(src).toMatch(/from '\.\/api\.js'/);
  });
  it('has no eval, no storage and no inline handlers', () => {
    expect(src).not.toMatch(/\beval\b|new Function|localStorage|sessionStorage|innerHTML/);
  });
});
