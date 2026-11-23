// The New audit wizard: what each step needs before the person may go on. Pure: the screen asks, the database still decides.

export const WIZARD_STEPS = ['Scope and method', 'Team', 'Split preview', 'Lock and start'];
export const EXTRA_ROLES = { lead: 'Lead', deputy: 'Deputy', observer: 'Observer' };

/** The companies the audit covers, as the form holds them: ticked from the stock list, or typed with commas. */
export function companiesOf(form, hasList) {
  if (form.scope === 'full') return [];
  if (hasList) return form.picked;
  return form.companies
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Why step 1 cannot go on yet, in words; null when it can. */
export function scopeProblem(form, hasList) {
  if (form.name.trim() === '') return 'Give the audit a name.';
  const companies = companiesOf(form, hasList);
  if (form.scope === 'full') return null;
  if (companies.length === 0) return form.scope === 'single' ? 'Choose the company.' : 'Choose at least one company.';
  if (form.scope === 'single' && companies.length > 1) return 'A single-company audit has one company.';
  return null;
}

/** Why step 2 cannot go on yet; null when someone is chosen to count. */
export const teamProblem = (counters) => (counters.size === 0 ? 'Choose at least one person to count.' : null);

/** People given a role besides counting: [{ userId, role }]. Counters need no entry. */
export const extraMembers = (roles) =>
  Object.entries(roles)
    .filter(([, role]) => Object.hasOwn(EXTRA_ROLES, role))
    .map(([userId, role]) => ({ userId, role }));

/**
 * "Same team as last round": the earlier round's counters who can still count, and the names of those who cannot any more.
 * `assignments` are the earlier round's, `people` the current list from the database.
 */
export function sameTeam(assignments, people) {
  const canCount = new Set(people.filter((p) => p.can_count).map((p) => p.user_id));
  const ids = [];
  const gone = [];
  for (const a of assignments) {
    if (a.status === 'revoked') continue;
    if (canCount.has(a.auditor_id)) {
      if (!ids.includes(a.auditor_id)) ids.push(a.auditor_id);
    } else gone.push(a.name);
  }
  return { ids, gone };
}
