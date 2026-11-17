// Counting outbox logic. Pure apart from the store and the send function it is given.
// A count is saved on the device first, then sent in batches. Each event has its own id, so a batch that was sent but
// whose answer was lost is simply sent again and the database ignores the repeats: nothing is lost, nothing is doubled.
import { friendlyError } from './errors.js';

export const BATCH_SIZE = 200; // the database accepts 500 per call; smaller batches finish faster on a weak connection

/** One count as it is kept on the device. `qty` is ignored when `auto` is true (the database uses the system quantity). */
export function makeEvent({
  assignmentId,
  itemId,
  qty = null,
  auto = false,
  note = '',
  confirmed = false,
  rowSeconds = 0,
  now = new Date(),
  id,
}) {
  return {
    event_id: id ?? crypto.randomUUID(),
    assignment: assignmentId,
    item: itemId,
    qty: auto ? null : qty,
    auto: !!auto,
    note: String(note ?? '').slice(0, 500),
    confirmed: !!confirmed,
    row_seconds: Math.min(Math.max(Math.floor(rowSeconds) || 0, 0), 600),
    at: now.toISOString(),
  };
}

/** The shape the database function audit_count_batch reads. */
export const toWire = (e) => ({
  event_id: e.event_id,
  item: e.item,
  qty: e.qty,
  auto: e.auto,
  note: e.note,
  confirmed: e.confirmed,
  row_seconds: e.row_seconds,
  at: e.at,
});

/**
 * Sends everything waiting for one assignment, oldest first, in batches. Stops at the first failure and keeps what was not
 * accepted. Returns { sent, left, error } where error is null, or { kind: 'offline'|'refused'|'conflict'|'unknown', message, code }.
 */
export async function flushOutbox({ store, send, assignmentId, batchSize = BATCH_SIZE }) {
  let sent = 0;
  for (;;) {
    const batch = await store.take(assignmentId, batchSize);
    if (batch.length === 0) return { sent, left: 0, error: null };
    try {
      await send(assignmentId, batch.map(toWire));
    } catch (err) {
      return { sent, left: await store.count(assignmentId), error: friendlyError(err) };
    }
    await store.remove(batch.map((e) => e.event_id));
    sent += batch.length;
  }
}

/** The newest waiting event per item, as { [itemId]: event }, so the screen shows the count before it is sent. */
export function latestByItem(events) {
  const out = {};
  for (const e of events) out[e.item] = e;
  return out;
}
