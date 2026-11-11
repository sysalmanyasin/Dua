// Manage Fields helpers. Pure functions.
export const SIGN_LABEL = { add: 'Adds to the sale', sub: 'Deducts from the sale', none: 'Information only' };

// Moves one field up or down in the whole list and returns the new order of codes.
export function moveCode(codes, code, direction) {
  const i = codes.indexOf(code);
  const j = i + (direction === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= codes.length) return codes;
  const next = [...codes];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const sectionsOf = (methods) =>
  ['Cash', 'Banks', 'Credit Clients']
    .map((s) => ({ section: s, items: methods.filter((m) => m.section === s).sort((a, b) => a.sort - b.sort) }))
    .filter((g) => g.items.length);

export function friendlyFieldError(message) {
  const m = String(message ?? '');
  if (/already has saved figures/i.test(m))
    return 'This field already has saved figures, so its type and section cannot change. Hide it and add a new field instead.';
  if (/name must/i.test(m)) return 'Give the field a name of 1 to 60 characters.';
  if (/not allowed|permission/i.test(m)) return 'You do not have permission to change fields.';
  return 'Could not save the change. Please try again.';
}
