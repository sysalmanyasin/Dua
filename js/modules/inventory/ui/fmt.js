// Number and time formatting shared by the Inventory screens.
import { money } from '../../../shared/format.js';

export const qty = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const rs = (n) => money(Math.round(Number(n) || 0));
export const days = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : qty(Math.round(n)));
const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short' });
export const clock = (iso) => clockFmt.format(new Date(iso)).toLowerCase();
export const dayTime = (iso) => `${dayFmt.format(new Date(iso))}, ${clock(iso)}`;
