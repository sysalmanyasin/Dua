// Product history across rounds, and Individual audits by person and month. Pure: rows in, plain objects out.
import { monthLabel, signed, todayPkt } from '../../../shared/format.js';

const STATE = { counting: 'Counting', compiled: 'Compiled', final: 'Final', draft: 'Draft', locked: 'Locked' };
export const stateLabel = (s) => STATE[s] ?? String(s ?? '').replaceAll('_', ' ');

/** A quantity without trailing zeros (3 decimals at most); a dash when there is none. */
export function qtyText(v) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '–';
  return String(Number(Number(v).toFixed(3)));
}

/** The search text to send, or null when there is nothing to look for. */
export const searchTerm = (text) => {
  const t = String(text ?? '').trim();
  return t === '' ? null : t.slice(0, 80);
};

const dayOf = (iso) => (iso ? todayPkt(new Date(iso)) : '');

/** One row of audit_product_history as the screen shows it. */
export function historyRow(r) {
  const variance = Number(r.variance);
  const flags = [];
  if (r.not_counted) flags.push('Not counted');
  if (r.assumed_to_match) flags.push('Assumed to match');
  if (r.corrected) flags.push('Corrected');
  return {
    key: `${r.round_id}:${r.company}:${r.code}`,
    engagementId: r.engagement_id,
    roundId: r.round_id,
    where: `${r.engagement_name} · Round ${r.round_label}`,
    state: r.state,
    stateLabel: stateLabel(r.state),
    day: dayOf(r.at),
    system: qtyText(r.system_qty),
    counted: qtyText(r.counted_qty),
    variance,
    varianceText: variance === 0 ? 'Matches' : `${signed(variance)}`,
    value: Number(r.variance_value),
    flags,
  };
}

/** Rows grouped by product (company + code), keeping the database order (newest round first) inside each. */
export function groupByProduct(rows) {
  const groups = new Map();
  for (const r of rows ?? []) {
    const id = `${r.company}\u0000${r.code}`;
    if (!groups.has(id)) groups.set(id, { id, code: r.code, name: r.name, company: r.company, rounds: [] });
    groups.get(id).rounds.push(historyRow(r));
  }
  return [...groups.values()];
}

/** True when the database had more matches than it returned. */
export const moreThanShown = (rows) => Number(rows?.[0]?.total ?? 0) > (rows?.length ?? 0);

/** 'YYYY-MM' of today in Pakistan. */
export const currentMonth = (now = new Date()) => todayPkt(now).slice(0, 7);

/** The current month and the 11 before it, newest first, as { value, label }. */
export function monthChoices(now = new Date(), count = 12) {
  let y = Number(currentMonth(now).slice(0, 4));
  let m = Number(currentMonth(now).slice(5, 7));
  const out = [];
  for (let i = 0; i < count; i++) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ value, label: monthLabel(`${value}-01`) });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** audit_individual_overview rows grouped by person (the database sorts people A–Z and rounds newest first). */
export function overviewGroups(rows) {
  const people = new Map();
  for (const r of rows ?? []) {
    if (!people.has(r.person_id)) people.set(r.person_id, { id: r.person_id, name: r.person_name, rounds: [] });
    const done = r.variance_count !== null && r.variance_count !== undefined;
    people.get(r.person_id).rounds.push({
      engagementId: r.engagement_id,
      roundId: r.round_id,
      label: r.round_label,
      state: r.state,
      stateLabel: stateLabel(r.state),
      day: dayOf(r.started_at),
      done,
      items: done ? Number(r.item_count) : null,
      differences: done ? Number(r.variance_count) : null,
      value: done ? Number(r.variance_value) : null,
    });
  }
  return [...people.values()].map((p) => ({
    ...p,
    total: p.rounds.length,
    waiting: p.rounds.filter((x) => !x.done).length,
    differences: p.rounds.reduce((n, x) => n + (x.differences ?? 0), 0),
  }));
}
