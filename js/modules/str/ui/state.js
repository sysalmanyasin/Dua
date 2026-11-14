// What the STR pages remember while the app stays open: the list filters and the list the person was looking at,
// so Back from the detail returns to the same list and Prev/Next walk it. Held in memory only; a reload starts fresh.
// (Routes carry no query string, so the detail page learns which STR to show from here.)
export const state = {
  stage: 'all',
  branch: 'all',
  search: '',
  dateFrom: '',
  dateTo: '',
  selectedId: null,
  orderedIds: [],
};

export function resetFilters() {
  Object.assign(state, { stage: 'all', branch: 'all', search: '', dateFrom: '', dateTo: '' });
}
