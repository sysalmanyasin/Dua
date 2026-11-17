// Audit compile maths. Pure functions: no DOM, no database, no network.
// Rules R1-R7, R12, R20: docs/modules/audit.md. Ported from the old Audit Hub (compile-actions.js, counting-actions.js).
// Money is INTEGER PAISA in this file (D-13); quantities are held as integer thousandths so no float drift enters
// a figure. The SQL function audit_compile_round() must give identical answers: both run
// tests/fixtures/audit/compile-cases.json.

export const MAX_ROW_SECONDS = 600; // R7
export const EXTRA_NOTE_MAX_LENGTH = 2000;

const toMilli = (q) => Math.round(Number(q) * 1000);
const fromMilli = (m) => m / 1000;

// round(v / 1000) with halves going away from zero, in integers only. Matches Postgres numeric round().
const roundDiv1000 = (n) => {
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const r = Math.floor((2 * abs + 1000) / 2000);
  return r === 0 ? 0 : sign * r;
};

// Value of a variance in paisa: variance quantity x retail price (R20).
export const varianceValuePaisa = (varianceQty, pricePaisa) => roundDiv1000(toMilli(varianceQty) * pricePaisa);

// R1: an item never entered reads as 0 and is flagged missing; an auto-match reads as entered but is also missing.
export function computeEffectiveRow(systemQty, rawCounted, isAutoMatched) {
  const touched = rawCounted !== undefined && rawCounted !== null;
  const countedMilli = touched ? toMilli(rawCounted) : 0;
  return {
    effectiveQty: fromMilli(countedMilli),
    missing: !touched || !!isAutoMatched,
    variance: fromMilli(countedMilli - toMilli(systemQty)),
  };
}

// items:       [{ id, position, company, code, name, qty, pricePaisa }]
// assignments: [{ id, auditorId, itemIds, status, submission: { lines: { [itemId]: { qty, auto, note, confirmed } }, extraNote } | null }]
//              (submission is the newest revision; a revoked assignment is left out by the caller)
// corrections: { [itemId]: qty } approved corrections only (R6)
// Returns { refused } when assignments are missing and allowMissing is not set (R3), else the compiled rows.
export function compileRound({ items, assignments, corrections = {}, allowMissing = false }) {
  const missingAssignmentIds = assignments.filter((a) => a.status !== 'submitted').map((a) => a.id);
  if (missingAssignmentIds.length > 0 && !allowMissing) return { refused: 'missing_assignments' };

  const owner = new Map();
  for (const a of assignments) for (const id of a.itemIds) owner.set(id, a);

  const rows = items.map((it) => {
    const a = owner.get(it.id) || null;
    const line = a && a.submission ? a.submission.lines[it.id] : undefined;
    const corrected = Object.prototype.hasOwnProperty.call(corrections, it.id);
    const raw = corrected ? corrections[it.id] : line ? line.qty : undefined;
    const auto = corrected ? false : !!(line && line.auto);
    const eff = computeEffectiveRow(it.qty, raw, auto);
    return {
      itemId: it.id,
      position: it.position,
      company: it.company,
      code: it.code,
      name: it.name,
      systemQty: it.qty,
      pricePaisa: it.pricePaisa,
      countedQty: eff.effectiveQty,
      variance: eff.variance,
      valuePaisa: varianceValuePaisa(eff.variance, it.pricePaisa),
      missing: eff.missing,
      autoMatched: auto,
      auditorId: a ? a.auditorId : null,
      note: line ? line.note || '' : '',
      confirmedSame: line ? !!line.confirmed : false,
      corrected,
    };
  });

  const notes = assignments
    .filter((a) => a.submission && (a.submission.extraNote || '').trim() !== '')
    .map((a) => ({ assignmentId: a.id, auditorId: a.auditorId, note: a.submission.extraNote.trim() }));

  return {
    rows,
    variances: rows.filter((r) => r.variance !== 0).length,
    valuePaisa: rows.reduce((t, r) => t + r.valuePaisa, 0),
    withMissing: missingAssignmentIds.length > 0,
    missingAssignmentIds,
    notes,
  };
}

// R5: the same product (company + code) counted differently in another compiled round. Never resolved here.
// Missing and codeless rows are ignored. When a code repeats inside a round, the row with the highest position is used.
// others: [{ roundId, rows }] (the newest compilation of every other compiled round of the engagement)
export function detectConflicts(rows, others, roundId) {
  const mine = new Map();
  [...rows]
    .sort((a, b) => a.position - b.position)
    .forEach((r) => {
      if (!r.missing && r.code) mine.set(`${r.company}::${r.code}`, r);
    });
  const out = [];
  for (const other of others) {
    if (other.roundId === roundId) continue;
    for (const o of other.rows) {
      if (o.missing || !o.code) continue;
      const m = mine.get(`${o.company}::${o.code}`);
      if (!m || m.countedQty === o.countedQty) continue;
      out.push({
        company: m.company,
        code: m.code,
        name: m.name,
        a: { roundId, itemId: m.itemId, countedQty: m.countedQty, auditorId: m.auditorId },
        b: { roundId: other.roundId, itemId: o.itemId, countedQty: o.countedQty, auditorId: o.auditorId },
        resolved: null,
      });
    }
  }
  return out;
}

// Combines every compiled round of a family (Round 1 + 1A + 1B) for the difference engine. A duplicate
// (company, code) keeps the most recently compiled side.
export function mergeFamilyCompiled(familyRoundIds, compiledRounds) {
  const family = (compiledRounds || [])
    .filter((c) => familyRoundIds.includes(c.roundId))
    .slice()
    .sort((a, b) => new Date(a.compiledAt || 0) - new Date(b.compiledAt || 0));
  const merged = new Map();
  const variances = new Map();
  for (const c of family) {
    for (const r of c.mergedItems || []) merged.set(`${r.company}::${r.code || r.itemKey}`, r);
    for (const r of c.variances || []) variances.set(`${r.company}::${r.code || r.itemKey}`, r);
  }
  return { mergedItems: [...merged.values()], variances: [...variances.values()], memberCount: family.length };
}

// R7: time credited to one row is the gap since the last action, never more than the cap.
export function computeRowTimeDelta(lastActionAtMs, nowMs, maxSeconds = MAX_ROW_SECONDS) {
  if (lastActionAtMs === null || lastActionAtMs === undefined) return 0;
  const secs = Math.floor((nowMs - lastActionAtMs) / 1000);
  return Math.min(Math.max(secs, 0), maxSeconds);
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !(seconds >= 0)) return '—';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const pad = (n) => String(n).padStart(2, '0');
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

export const truncateExtraNote = (text) => (text || '').slice(0, EXTRA_NOTE_MAX_LENGTH);
