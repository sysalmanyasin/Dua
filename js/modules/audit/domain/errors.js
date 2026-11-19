// Turns a database refusal into words a counter or the owner understands. The database puts a machine code in the error's
// `hint` (migrations 0401, 0402); this file is the only place that maps codes to sentences. A test checks that every code the
// audit migrations can raise has a sentence here, and that no sentence is dead.
export const MESSAGES = {
  not_allowed: 'You are not allowed to do that.',
  entry_locked: 'This entry is locked. Reopen it first, then edit.',
  entry_not_found: 'That entry could not be found. Reload and try again.',
  key_taken: 'This save was already used by someone else. Start the entry again.',
  month_invalid: 'Choose a month from 3 months ago to 3 years ahead.',
  person_invalid: 'That person cannot be given a rack. Choose someone with an active account.',
  product_not_found: 'That product could not be found. Search for it again.',
  quantity_invalid: 'Enter a quantity above zero.',
  rack_exists: 'A rack with that name already exists.',
  rack_inactive: 'That rack is switched off. Switch it on first.',
  rack_invalid: 'Choose one of the racks on the list.',
  rack_name_invalid: 'A rack needs a name of 1 to 60 characters.',
  rack_not_found: 'That rack could not be found. Reload and try again.',
  rack_not_yours: 'That rack is not yours this month. Choose one of your racks.',
  status_invalid: 'Choose a status from the list.',
  append_only: 'That record is kept as it was and cannot be changed.',
  assignment_identity: 'An assignment cannot be moved to another person or round.',
  assignment_not_found: 'That assignment could not be found. Reload and try again.',
  assignment_not_submitted: 'Only a submitted count can be reopened.',
  assignment_revoked: 'That assignment was taken back.',
  assignment_submitted: 'This count is already submitted.',
  auditor_unavailable: 'One of the chosen people cannot count right now (disabled or without the counting permission).',
  base_round_required: 'A follow-up round needs the round it follows.',
  batch_too_large: 'Too many counts were sent at once. Try again.',
  engagement_not_found: 'That audit could not be found. Reload and try again.',
  engagement_not_open: 'That audit is not open.',
  illegal_transition: 'The round cannot move to that state from where it is.',
  invalid_auditors: 'Choose at least one person to count.',
  invalid_events: 'Some counts could not be read. Reload and try again.',
  invalid_items: 'The list of items is not valid.',
  invalid_method: 'That counting method is not valid.',
  invalid_qty: 'A quantity must be a number, zero or more.',
  invalid_role: 'That role is not valid.',
  invalid_scope: 'That scope is not valid.',
  invalid_split: 'That way of splitting is not valid.',
  invalid_suffix: 'A sub-round letter must be a single capital letter.',
  invalid_unit: 'That unit is not valid.',
  inventory_interface_missing: 'Stock cannot be read yet, so a round cannot be created. This arrives with the Inventory update.',
  item_not_assigned: 'That item is not in your assignment.',
  items_frozen: 'The items of a locked round cannot change.',
  items_unassigned: 'Every item must be given to someone before the round is locked.',
  key_in_use: 'This request was already used for something else. Reload and try again.',
  key_required: 'The request is missing its key. Reload and try again.',
  missing_assignments: 'Some counters have not submitted. Compile anyway only if you accept their items as uncounted.',
  no_items: 'There is nothing to count in that scope.',
  reason_required: 'Please write a short reason (at least 3 letters).',
  round_exists: 'That round already exists.',
  round_final: 'A final round cannot change.',
  round_identity: 'A round cannot be moved to another audit.',
  round_not_compilable: 'The round is not ready to compile.',
  round_not_counting: 'The round is not open for counting.',
  round_not_draft: 'The round is already locked.',
  round_not_found: 'That round could not be found. Reload and try again.',
  round_not_locked: 'The round must be locked first.',
  too_many_items: 'That scope has too many items for one round. Split it.',
  invalid_codes: 'Enter at least one product code.',
  invalid_template: 'A template needs a name of 2 to 80 letters and at least one product code.',
  self_pick_open: 'You already have an Individual Audit open. Submit it first.',
  template_name_taken: 'Another template already has that name.',
  template_not_found: 'That template could not be found. Reload and try again.',
  too_many_codes: 'That is too many products for one Individual Audit (500 at most).',
  round_not_compiled: 'The round is not compiled yet.',
  item_not_in_round: 'That item is not in this round.',
  correction_pending: 'A correction for this item is already waiting for a decision.',
  correction_not_found: 'That correction could not be found. Reload and try again.',
  correction_decided: 'That correction was already decided.',
  invalid_decision: 'Choose approve or reject.',
  invalid_side: 'Choose which count to keep.',
  conflict_not_found: 'That conflict could not be found. Reload and try again.',
  conflict_resolved: 'That conflict is already settled.',
  invalid_mode: 'Choose a valid option.',
  invalid_sample: 'The sample size must be between 1 and 1000.',
  suffix_exhausted: 'There are no more lettered rounds (A to Z) for this round.',
  too_many_companies: 'Pick 20 companies or fewer for one Individual Audit.',
  compile_stale: 'Something changed after the last compile. Compile again, then create the final.',
  corrections_pending: 'A correction is still waiting for a decision. Approve or reject it first.',
  conflicts_unresolved: 'A conflict is not settled yet. Choose which count to keep for each one.',
  final_not_found: 'This round has no final snapshot yet.',
  version_conflict: 'Someone else changed this. Reload and try again.',
};

const FALLBACK = 'Something went wrong. Your work is kept on this device. Try again in a moment.';
const OFFLINE = 'No connection. Your work is kept on this device.';

/** @returns {{ code: string|null, kind: 'offline'|'conflict'|'refused'|'unknown', message: string }} */
export function friendlyError(err) {
  if (!err) return { code: null, kind: 'unknown', message: FALLBACK };
  const text = String(err.message ?? '');
  const code = err.hint && MESSAGES[err.hint] ? err.hint : err.code === '42501' ? 'not_allowed' : null;
  if (code) return { code, kind: code === 'version_conflict' ? 'conflict' : 'refused', message: MESSAGES[code] };
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text) || err.name === 'TypeError') {
    return { code: null, kind: 'offline', message: OFFLINE };
  }
  return { code: null, kind: 'unknown', message: FALLBACK };
}
