// Turns a database refusal into words a cashier understands. The database puts a machine code in the error's `hint`
// (migrations 0203/0204); this file is the only place that maps codes to sentences. A test checks that every code the
// migrations can raise has a sentence here.
export const MESSAGES = {
  not_allowed: 'You are not allowed to do that.',
  opening_required: 'The opening closing has not been entered yet. Ask the owner to set it up first.',
  opening_not_first: 'The opening closing must be the very first closing, and closings already exist.',
  opening_exists: 'An opening closing already exists.',
  opening_only: 'Opening figures can only be typed on the opening closing.',
  previous_slot_open: 'The slot before this one has not been submitted yet. Submit it first, or start a Final closing.',
  slot_in_past: 'A later closing is already submitted, so an earlier slot cannot be added now.',
  slot_taken: 'A closing already exists for this slot.',
  carry_changed: 'An earlier closing was updated, so the opening figures changed. Review them, then submit again.',
  draft_conflict: 'This draft was changed on another device.',
  closing_locked: 'This closing is already submitted and cannot be changed here.',
  audit_not_verified: 'Verify the inventory audit before submitting.',
  choose_responsible: 'Choose the responsible staff member before submitting.',
  responsible_not_found: 'That staff member is not available. Choose another.',
  reason_required: 'Please write a short reason (at least 3 letters).',
  not_current: 'Only the current submitted closing can be changed.',
  revision_open: 'This closing is already open for editing.',
  key_used: 'This request was already used. Reload the page and try again.',
  key_other_slot: 'This draft belongs to a different slot. Reload the page.',
  date_out_of_range: 'That date is not allowed. Pick today or an earlier day.',
  invalid_slot_kind: 'That slot is not valid.',
  invalid_mode: 'That closing type is not valid for this closing.',
  invalid_payload: 'Something in the form could not be read. Reload and try again.',
  invalid_amount: 'One of the amounts is not a valid number.',
  amount_too_large: 'One of the amounts is far too large. Check the digits.',
  invalid_quantity: 'A quantity must be zero or more.',
  invalid_text: 'A label is not valid text.',
  text_too_long: 'A label is too long.',
  invalid_rows: 'A list in the form is not valid. Reload and try again.',
  invalid_cash_count: 'The cash count is not valid.',
  too_many_tiers: 'At most 3 staff-tier credit lines are allowed.',
};

const FALLBACK = 'Something went wrong. Your work is kept on this device. Try again in a moment.';
const OFFLINE = 'No connection. Your work is kept on this device.';

/**
 * @returns {{ code: string|null, kind: 'offline'|'conflict'|'refused'|'unknown', message: string, detail: string|null }}
 *   kind 'conflict' = the draft moved on (draft_conflict) or carried figures changed (carry_changed): the screen reloads.
 */
export function friendlyError(err) {
  if (!err) return { code: null, kind: 'unknown', message: FALLBACK, detail: null };
  const text = String(err.message ?? '');
  const code = err.hint && MESSAGES[err.hint] ? err.hint : err.code === '42501' ? 'not_allowed' : null;
  if (code) {
    const kind = code === 'draft_conflict' || code === 'carry_changed' ? 'conflict' : 'refused';
    return { code, kind, message: MESSAGES[code], detail: err.details ?? err.detail ?? null };
  }
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text) || err.name === 'TypeError') {
    return { code: null, kind: 'offline', message: OFFLINE, detail: null };
  }
  return { code: null, kind: 'unknown', message: FALLBACK, detail: null };
}

// The version a draft_conflict refusal reports ("version=4"), or null.
export const conflictVersion = (err) => {
  const m = /version=(\d+)/.exec(String(err?.details ?? err?.detail ?? ''));
  return m ? Number(m[1]) : null;
};
