// Sheets data layer (Phase 5, increment 3). Every Supabase call goes through ./api.js; nothing here draws a screen.
//
//  * openWorkbookFull   open, load every sheet's styles and cells page by page, then pull from the head_version the
//                       workbook was opened at, so edits made while paging are not missed (design section 4a).
//  * pullAndApply       bring a local copy up to date with workspace_pull + applyRemote.
//  * createOperationSender  sends operation batches. A batch that was not answered is kept and sent again with the SAME
//                       operation ids and content until the server answers, so a lost reply can never make a person
//                       conflict with their own change (D-45; the same rule as domain/autosave.js). Nothing unsent is
//                       ever dropped silently: a refused batch is held until the caller takes it.
//  * snapshots          create, list and restore (restore is owner only; the database decides).
//
// Not here: applying the person's own pending operations locally, the offline queue, formulas, screens (later phases).
import { read, rpc, table, WorkspaceError } from './api.js';
import {
  addLoadedCells,
  addLoadedStyles,
  applyRemote,
  jsonInt,
  LIMITS,
  loadWorkbook,
  OPERATION_TYPES,
  ReplicaOutOfSync,
  uuidOrNull,
} from '../domain/spreadsheet.js';

const INT_MAX = 2147483647;
export const PAGE_SIZE = 5000; // cells per workspace_load_sheet call (the database caps a page at 10,000)
export const PULL_PAGE = 500; // operations per workspace_pull call (the database caps a page at 500)
export const BATCH_BYTES = 3000000; // the database refuses a batch above 4,000,000 characters; stay well below
export const RETRY_DELAYS_MS = Object.freeze([2000, 5000, 15000, 30000, 60000]);
const MAX_PAGES = 200; // a sheet holds at most 50,000 cells, so this is far more than ever needed

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const invalid = (message) => new WorkspaceError(message, { code: 'invalid' });
const sizeOf = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

function needUuid(value, what) {
  const id = uuidOrNull(value);
  if (id === null) throw invalid(`${what} is not valid.`);
  return id;
}

// ───────── reading ─────────

export const openWorkbook = async (docId) => rpc('workspace_workbook_open', { p_doc: needUuid(docId, 'The workbook') });

// One page of the non-empty cells of a sheet, in (row, column) order. Pass the last row and column of the previous page.
export async function loadSheetPage(sheetId, { afterRow = null, afterCol = null, limit = PAGE_SIZE } = {}) {
  const rows = await rpc('workspace_load_sheet', {
    p_sheet: needUuid(sheetId, 'The sheet'),
    p_after_row: afterRow,
    p_after_col: afterCol,
    p_limit: limit,
  });
  if (!Array.isArray(rows)) throw invalid('The server sent something unexpected. Please try again.');
  return rows;
}

// The styles of one sheet: [{ style_id, style }] (at most 500).
export async function loadSheetStyles(sheetId) {
  const rows = await read(
    table('workspace_sheet_styles')
      .select('style_id,style')
      .eq('sheet_id', needUuid(sheetId, 'The sheet'))
      .order('style_id', { ascending: true }),
  );
  if (!Array.isArray(rows)) throw invalid('The server sent something unexpected. Please try again.');
  return rows;
}

// Loads every page of a sheet's cells into the local copy. Returns the number of cells loaded.
export async function loadSheetCells(wb, sheetId, { pageSize = PAGE_SIZE, onPage = () => {} } = {}) {
  const size = Math.min(Math.max(Math.trunc(pageSize) || PAGE_SIZE, 1), 10000);
  let afterRow = null;
  let afterCol = null;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await loadSheetPage(sheetId, { afterRow, afterCol, limit: size });
    addLoadedCells(wb, sheetId, rows);
    total += rows.length;
    onPage({ sheetId, loaded: total });
    if (rows.length < size) return total;
    const last = rows[rows.length - 1];
    // A page must move forward, or a faulty answer would loop for ever.
    if (afterRow !== null && (last.row_id < afterRow || (last.row_id === afterRow && last.col_id <= afterCol))) {
      throw invalid('The server sent something unexpected. Please try again.');
    }
    afterRow = last.row_id;
    afterCol = last.col_id;
  }
  throw invalid('This sheet is too large to open.');
}

// Operations that changed something after `since`, oldest first: [{ seq, op_id, op_type, author, payload, applied_at }].
export async function pullOperations(docId, since, limit = PULL_PAGE) {
  const rows = await rpc('workspace_pull', {
    p_doc: needUuid(docId, 'The workbook'),
    p_since: since ?? 0,
    p_limit: Math.min(Math.max(Math.trunc(limit) || PULL_PAGE, 1), PULL_PAGE),
  });
  if (!Array.isArray(rows)) throw invalid('The server sent something unexpected. Please try again.');
  return rows;
}

// Brings the local copy up to date: pulls from wb.head_seq and applies each operation with applyRemote.
// Returns { status: 'ok', applied } or { status: 'reload', reason } when the copy has drifted or the workbook was restored
// (open it again with openWorkbookFull). The rows that were applied before a drift stay in the copy; discard it on 'reload'.
export async function pullAndApply(wb, docId, { limit = PULL_PAGE } = {}) {
  const size = Math.min(Math.max(Math.trunc(limit) || PULL_PAGE, 1), PULL_PAGE);
  let applied = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const since = wb.head_seq;
    const rows = await pullOperations(docId, since, size);
    for (const row of rows) {
      const before = wb.head_seq;
      try {
        applyRemote(wb, { seq: Number(row.seq), op_type: row.op_type, payload: row.payload });
      } catch (e) {
        if (e instanceof ReplicaOutOfSync) return { status: 'reload', reason: e.message };
        throw e;
      }
      if (wb.head_seq > before) applied += 1;
    }
    if (rows.length < size) return { status: 'ok', applied };
    if (wb.head_seq <= since) throw invalid('The server sent something unexpected. Please try again.');
  }
  throw invalid('There are too many changes to catch up. Please open the workbook again.');
}

// Opens a workbook and builds the whole local copy. Returns { wb, info, applied }, where info is what the database said
// about the workbook (id, title, role, archived, head_version, history_visible_to_viewers) without the sheets.
// If another writer changes the structure while pages are loading and the copy cannot absorb it, it starts again.
export async function openWorkbookFull(docId, { pageSize = PAGE_SIZE, onProgress = () => {}, attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const open = await openWorkbook(docId);
    const wb = loadWorkbook(open);
    for (const sheet of open.sheets ?? []) {
      addLoadedStyles(wb, sheet.id, await loadSheetStyles(sheet.id));
      await loadSheetCells(wb, sheet.id, { pageSize, onPage: onProgress });
    }
    // Close the gap: anything applied after the version we opened at.
    const sync = await pullAndApply(wb, docId);
    if (sync.status === 'ok') {
      const info = { ...open };
      delete info.sheets;
      return { wb, info, applied: sync.applied };
    }
    if (attempt >= attempts) throw invalid('This workbook changed while it was opening. Please try again.');
  }
}

// ───────── writing ─────────

// Whole-call hazards, checked before anything is sent. The database undoes a whole batch for an envelope it cannot read
// or for a row or column id outside the integer range, and answers nothing per operation (handover, pitfall 14).
export function checkOperation(op) {
  if (!isObj(op)) throw invalid('A change is not valid.');
  if (uuidOrNull(op.operation_id) === null) throw invalid('Every change needs its own id.');
  if (typeof op.operation_type !== 'string' || !OPERATION_TYPES.includes(op.operation_type))
    throw invalid('That kind of change is not known.');
  const ids = isObj(op.payload) ? op.payload.ids : undefined;
  if (Array.isArray(ids) && ids.some((x) => jsonInt(x) === null || x < 1 || x > INT_MAX))
    throw invalid('A row or column number is out of range.');
  if (sizeOf(op) > LIMITS.operationBytes) throw invalid('That change is too large to send.');
}

export function checkOperations(ops) {
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > LIMITS.operationsPerBatch)
    throw invalid('Send between 1 and 200 changes at a time.');
  const seen = new Set();
  for (const op of ops) {
    checkOperation(op);
    const id = uuidOrNull(op.operation_id);
    if (seen.has(id)) throw invalid('The same change appears twice.');
    seen.add(id);
  }
}

// One call to workspace_apply_ops. Returns { results: [{ operation_id, status, seq, ... }], head_seq }.
// Prefer createOperationSender, which also resends after a failure.
export async function applyOperations({ docId, ops, deviceId = null }) {
  checkOperations(ops);
  return rpc('workspace_apply_ops', {
    p_doc: needUuid(docId, 'The workbook'),
    p_ops: ops,
    p_device: deviceId === null ? null : needUuid(deviceId, 'The device'),
  });
}

// A failure the same batch could get past later (no network, server busy, session expired) versus one that will never
// work (no access, archived, refused envelope).
export function isTransient(error) {
  const code = error?.code ?? null;
  if (code === null || code === 'offline') return true;
  if (!/^[0-9A-Z]{5}$/.test(code)) return true; // gateway and API codes such as PGRST301 (expired session)
  return /^(08|40|53|57|58)/.test(code); // connection, rollback, resources, operator intervention
}

export const tally = (results) =>
  results.reduce((t, r) => ({ ...t, [r.status]: (t[r.status] ?? 0) + 1 }), { applied: 0, conflict: 0, rejected: 0, duplicate: 0 });

// Sends the operations of ONE workbook in order. Keeps what was not answered:
//  * enqueue(ops) adds copies (later changes to the caller's objects cannot alter what is resent);
//  * flush() makes one attempt: resends the batch that was not answered, or else takes the next batch;
//  * drain() flushes until the queue is empty, waiting between failures (2 s to 60 s, plus a little jitter);
//  * takeRefused() hands back a batch the server will never accept so the caller can show or export it.
// Status of a flush: 'idle' (nothing to send), 'answered', 'offline' (try again later; the same batch stays in flight)
// or 'refused' (the whole call was refused; nothing later is sent until takeRefused()).
export function createOperationSender({
  docId,
  deviceId = null,
  send = applyOperations,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  jitter = (ms) => ms + Math.floor(Math.random() * ms * 0.2),
  delays = RETRY_DELAYS_MS,
  maxBatch = LIMITS.operationsPerBatch,
} = {}) {
  needUuid(docId, 'The workbook');
  if (deviceId !== null) needUuid(deviceId, 'The device');
  const batchMax = Math.min(Math.max(Math.trunc(maxBatch) || LIMITS.operationsPerBatch, 1), LIMITS.operationsPerBatch);

  let queue = [];
  let inflight = null; // the exact batch last sent and not yet answered
  let refused = null; // { ops, error }
  let running = null;
  const known = new Set();

  function enqueue(ops) {
    const list = Array.isArray(ops) ? ops : [ops];
    const fresh = new Set();
    for (const op of list) {
      checkOperation(op);
      const id = uuidOrNull(op.operation_id);
      if (known.has(id) || fresh.has(id)) throw invalid('That change was already queued.');
      fresh.add(id);
    }
    for (const op of list) queue.push({ ...structuredClone(op), operation_id: uuidOrNull(op.operation_id) });
    for (const id of fresh) known.add(id);
    return list.length;
  }

  function takeBatch() {
    const out = [];
    let bytes = 0;
    while (queue.length > 0 && out.length < batchMax) {
      const size = sizeOf(queue[0]);
      if (out.length > 0 && bytes + size > BATCH_BYTES) break;
      out.push(queue.shift());
      bytes += size;
    }
    return out;
  }

  async function attempt() {
    if (refused) return { status: 'refused', error: refused.error };
    if (!inflight) {
      if (queue.length === 0) return { status: 'idle' };
      inflight = takeBatch();
    }
    const batch = inflight;
    let answer;
    try {
      answer = await send({ docId, ops: batch, deviceId });
    } catch (error) {
      if (isTransient(error)) return { status: 'offline', error, pending: pendingCount() };
      refused = { ops: batch, error };
      inflight = null;
      return { status: 'refused', error };
    }
    const results = Array.isArray(answer?.results) ? answer.results : null;
    const byId = new Map((results ?? []).map((r) => [uuidOrNull(r?.operation_id), r]));
    if (!results || batch.some((o) => !byId.has(o.operation_id))) {
      // An answer that does not cover the batch is not an answer: keep it in flight and send the same ids again.
      return { status: 'offline', error: invalid('The server sent something unexpected.'), pending: pendingCount() };
    }
    inflight = null;
    for (const o of batch) known.delete(o.operation_id);
    return {
      status: 'answered',
      head_seq: answer.head_seq,
      results: batch.map((o) => ({ operation: o, result: byId.get(o.operation_id) })),
    };
  }

  const flush = () => {
    if (!running) {
      running = attempt().finally(() => {
        running = null;
      });
    }
    return running;
  };

  async function drain() {
    const answered = [];
    let failures = 0;
    for (;;) {
      const r = await flush();
      if (r.status === 'answered') {
        answered.push(r);
        failures = 0;
      } else if (r.status === 'idle') {
        return { status: 'idle', answered };
      } else if (r.status === 'refused') {
        return { status: 'refused', error: r.error, answered };
      } else {
        if (failures >= delays.length) return { status: 'offline', error: r.error, answered, pending: pendingCount() };
        await sleep(jitter(delays[failures]));
        failures += 1;
      }
    }
  }

  function pendingCount() {
    return (inflight?.length ?? 0) + queue.length + (refused?.ops.length ?? 0);
  }

  return {
    enqueue,
    flush,
    drain,
    pendingCount,
    // Everything that has not been answered, oldest first (including a refused batch), as copies.
    pending: () => structuredClone([...(refused?.ops ?? []), ...(inflight ?? []), ...queue]),
    hasRefused: () => refused !== null,
    takeRefused() {
      const r = refused;
      refused = null;
      if (r) for (const o of r.ops) known.delete(o.operation_id);
      return r;
    },
    // Clears everything that has not been answered and returns it, so it can be exported. Only for an explicit "discard".
    discardAll() {
      const all = [...(refused?.ops ?? []), ...(inflight ?? []), ...queue];
      queue = [];
      inflight = null;
      refused = null;
      known.clear();
      return all;
    },
  };
}

// ───────── restore points (snapshots) ─────────

export const createSnapshot = async ({ docId, label = null, key }) =>
  rpc('workspace_snapshot_create', {
    p_doc: needUuid(docId, 'The workbook'),
    p_label: label,
    p_key: needUuid(key, 'The request key'),
  }); // { snapshot_id, seq }

export const listSnapshots = async ({ docId, before = null, limit = 50 }) =>
  rpc('workspace_snapshot_list', { p_doc: needUuid(docId, 'The workbook'), p_before: before, p_limit: limit }); // [{ id, seq, kind, label, bytes, author, created_at }]

// Owner only. Puts the workbook back to a restore point as a new change: { status: 'restored', seq, restored_from_seq }.
// The local copy cannot follow a restore: load the workbook again with openWorkbookFull.
export const restoreSnapshot = async ({ docId, snapshotId, key }) =>
  rpc('workspace_sheet_restore', {
    p_doc: needUuid(docId, 'The workbook'),
    p_snapshot: needUuid(snapshotId, 'The restore point'),
    p_key: needUuid(key, 'The request key'),
  });
