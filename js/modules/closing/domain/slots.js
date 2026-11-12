// The four kinds of closing slot and which one comes next. The same order the database enforces (migration 0203, CLS-6):
// Night needs yesterday's Evening, Morning needs the Night, a handover or the Evening needs the latest Morning/handover.
export const KINDS = [
  { kind: 'night', label: 'Night', dot: 'night', seq: 10 },
  { kind: 'morning', label: 'Morning', dot: 'morning', seq: 20 },
  { kind: 'handover', label: 'Handover', dot: 'handover', seq: null },
  { kind: 'evening', label: 'Evening', dot: 'evening', seq: 9999 },
];

export const kindLabel = (kind) => KINDS.find((k) => k.kind === kind)?.label ?? kind;

// "Handover 2" for seq 40 (30 is the first handover)
export function slotLabel(kind, seq) {
  if (kind !== 'handover') return kindLabel(kind);
  const n = Math.max(1, Math.round((Number(seq) - 20) / 10));
  return `Handover ${n}`;
}

export const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The slot that normally follows a submitted one. Handovers are optional, so after a Morning the suggestion is the Evening.
 * Returns { date, kind }.
 */
export function suggestNext(last) {
  if (!last) return null;
  if (last.kind === 'night') return { date: last.business_date, kind: 'morning' };
  if (last.kind === 'evening') return { date: addDays(last.business_date, 1), kind: 'night' };
  return { date: last.business_date, kind: 'evening' }; // after a Morning or a handover
}

// Where a slot sits in time, for sorting and for "is this later than that"
export const slotOrder = (s) => `${s.business_date}|${String(s.seq).padStart(5, '0')}`;
