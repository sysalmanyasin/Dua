// The "Latest sale" pill in the status bar: the most recent closed day's total.
import { money } from '../../shared/format.js';
import { lastClosedDay } from './data/api.js';

export async function pill() {
  const r = await lastClosedDay();
  return r ? { label: 'Latest sale', value: `₨ ${money(r.total)}`, href: '#/sales/yesterday' } : null;
}
