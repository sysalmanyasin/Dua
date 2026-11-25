// What must be true before a round is made final. Pure: the compile overview in, a checklist out.
// The blocking checks are the ones the database enforces (audit_finalize refuses a stale compile, a waiting correction and an
// unsettled conflict); showing them first lets the owner fix them before pressing the button, not after. The others only warn.
import { recompileNeeded } from './pipeline.js';

const plural = (n, one, many) => (n === 1 ? one : many);

export function finalChecks({ round, compilation, conflicts = [], corrections = [], assignments = [] }) {
  const open = conflicts.filter((k) => !k.resolved_side).length;
  const waiting = corrections.filter((c) => c.status === 'proposed').length;
  const need = recompileNeeded({ round, assignments, compilation, corrections });
  const stale = Boolean(need && (need.approved > 0 || need.late > 0));
  const reopened = need?.reopened ?? [];
  const incomplete = Boolean(compilation?.with_missing) || reopened.length > 0;
  return [
    {
      key: 'current',
      blocking: true,
      ok: !stale,
      text: stale ? `Needs a recompile first: ${need.text}.` : 'The compile includes every count and approved correction.',
      fix: stale ? { label: 'Recompile', path: '/audit/compile' } : null,
    },
    {
      key: 'corrections',
      blocking: true,
      ok: waiting === 0,
      text:
        waiting === 0
          ? 'No correction is waiting for a decision.'
          : `${waiting} ${plural(waiting, 'correction is', 'corrections are')} waiting for a decision.`,
      fix: waiting ? { label: 'Decide', path: '/audit/corrections' } : null,
    },
    {
      key: 'conflicts',
      blocking: true,
      ok: open === 0,
      text: open === 0 ? 'Every conflict is settled.' : `${open} ${plural(open, 'conflict is', 'conflicts are')} not settled yet.`,
      fix: open ? { label: 'Settle', path: '/audit/compile' } : null,
    },
    {
      key: 'complete',
      blocking: false,
      ok: !incomplete,
      text: !incomplete
        ? 'Everyone assigned has submitted.'
        : reopened.length
          ? `${reopened.join(', ')} reopened and not submitted again.`
          : 'Incomplete: some people had not submitted when this was compiled.',
      fix: null,
    },
  ];
}

/** True when any blocking check fails: the final snapshot cannot be made yet. */
export const finalBlocked = (checks) => checks.some((c) => c.blocking && !c.ok);
