import { raw } from './html.js';

const svg = (d) =>
  raw(
    `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`,
  );

export const ICONS = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  users: svg(
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5a3.5 3.5 0 010 6.5M18 14c2.2.6 3.5 2.6 3.5 5"/>',
  ),
  logout: svg('<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4M20 12H9"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};
export const icon = (name) => ICONS[name] ?? ICONS.shield;
