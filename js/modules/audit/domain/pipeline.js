// Where a round is on its way from set-up to Final, and what the owner does next. Pure: the screens draw it.
// What a person may do is still decided by the database; this only decides which button to offer.

export const STEPS = [
  { key: 'draft', label: 'Set up' },
  { key: 'locked', label: 'Locked' },
  { key: 'counting', label: 'Counting' },
  { key: 'compiled', label: 'Compiled' },
  { key: 'final', label: 'Final' },
];
const ORDER = STEPS.map((s) => s.key);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The five steps with each one marked 'done', 'current' or 'todo', and a short detail under the ones that have a number:
 * "1 of 3 submitted" while counting, "2 differ" once compiled.
 */
export function pipelineSteps({ round, assignments = [], compilation = null }) {
  const at = Math.max(0, ORDER.indexOf(round?.state));
  const submitted = assignments.filter((a) => a.status === 'submitted').length;
  return STEPS.map((step, i) => {
    let detail = '';
    if (step.key === 'counting' && i <= at && assignments.length) detail = `${submitted} of ${assignments.length} submitted`;
    if (step.key === 'compiled' && i <= at && compilation && Number.isFinite(Number(compilation.variance_count))) {
      detail = `${Number(compilation.variance_count)} differ`;
    }
    // a Final round is finished: every step is done, and Final is the one the person is on
    const state = i < at ? 'done' : i === at ? (step.key === 'final' ? 'done' : 'current') : 'todo';
    return { ...step, detail, state };
  });
}

/** The one thing to do next, as { label, page } for the pages 'round', 'compile' or 'final'; null when this person has nothing to do. */
export function nextStep(state, permissions = []) {
  const can = (key) => permissions.includes(key) || permissions.includes('audit.manage');
  switch (state) {
    case 'draft':
      return can('audit.assign') ? { label: 'Give out the work and lock the round', page: 'round' } : null;
    case 'locked':
      return can('audit.manage') ? { label: 'Start counting', page: 'round' } : null;
    case 'counting':
      return can('audit.compile') || can('audit.review') ? { label: 'Review the counting', page: 'compile' } : null;
    case 'compiled':
      return can('audit.compile') || can('audit.review') ? { label: 'Review and finish', page: 'compile' } : null;
    case 'final':
      return { label: 'See the final result', page: 'final' };
    default:
      return null;
  }
}

/** The newest round of an audit (highest number, then the later letter). */
export function latestRound(rounds = []) {
  return [...rounds]
    .sort((a, b) => a.round_number - b.round_number || String(a.round_suffix ?? '').localeCompare(String(b.round_suffix ?? '')))
    .at(-1);
}

/**
 * What changed after the last compile, so the owner knows the result on screen is out of date:
 * approved corrections that apply at the next compile, counts that were reopened and not submitted again, and counts that were
 * missing at the compile and have been submitted since. Null when nothing is waiting.
 */
export function recompileNeeded({ round, assignments = [], compilation = null, corrections = [] }) {
  if (round?.state !== 'compiled' || !compilation) return null;
  const compiledAt = Date.parse(compilation.compiled_at);
  const missing = new Set(compilation.missing_assignment_ids ?? []);
  const approved = corrections.filter((c) => c.status === 'approved' && Date.parse(c.decided_at) > compiledAt).length;
  const reopened = assignments.filter((a) => a.status !== 'submitted' && !missing.has(a.id));
  const late = assignments.filter((a) => a.status === 'submitted' && missing.has(a.id)).length;
  if (approved === 0 && reopened.length === 0 && late === 0) return null;
  const parts = [];
  if (approved) parts.push(`${plural(approved, 'approved correction')} waiting`);
  if (late) parts.push(`${plural(late, 'count')} submitted since the compile`);
  if (reopened.length) parts.push(`${reopened.map((a) => a.name).join(', ')} reopened and not submitted again`);
  return {
    approved,
    late,
    reopened: reopened.map((a) => a.name),
    text: parts.join(' · '),
    // compiling while someone's reopened count is still open would leave their items out
    ready: reopened.length === 0,
    // people who were already missing at the compile and still have not submitted: that compile was accepted as incomplete
    allowMissing: assignments.some((a) => a.status !== 'submitted'),
  };
}

/** The round before this one in the same audit that was actually given to people, or undefined. Used for "same team as last round". */
export function previousRound(rounds = [], currentId) {
  const ordered = [...rounds].sort(
    (a, b) => a.round_number - b.round_number || String(a.round_suffix ?? '').localeCompare(String(b.round_suffix ?? '')),
  );
  const at = ordered.findIndex((r) => r.id === currentId);
  return ordered
    .slice(0, at < 0 ? 0 : at)
    .reverse()
    .find((r) => Number(r.assignments) > 0);
}
