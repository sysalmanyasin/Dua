// The "Candela today" pill in the status bar: today's total, one number, for anyone holding candela.today_total
// (or the owner's candela.view). The date is decided by the database in Pakistan time, so the pill follows the
// business day at midnight. Kept in memory only (never saved on the phone).
import { money } from '../../shared/format.js';
import { todayTotal } from './data/api.js';

export async function pill(ctx) {
  const total = await todayTotal();
  if (total === null) return { label: 'Candela today', value: '—', href: owner(ctx) ? '#/candela-sales' : '#/home' };
  return { label: 'Candela today', value: `₨ ${money(total)}`, href: owner(ctx) ? '#/candela-sales' : '#/home' };
}

const owner = (ctx) => (ctx.permissions ?? []).includes('candela.view');
