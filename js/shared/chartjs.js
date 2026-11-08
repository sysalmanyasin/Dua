// Chart.js is loaded only when a page that draws charts is opened (it is a 200 KB file kept in vendor/).
let loading = null;

export function loadChartJs() {
  if (globalThis.Chart) return Promise.resolve(globalThis.Chart);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/chart-4.4.7.umd.js';
    s.onload = () => resolve(globalThis.Chart);
    s.onerror = () => {
      loading = null;
      reject(new Error('The chart library could not be loaded.'));
    };
    document.head.append(s);
  });
  return loading;
}

// Colours for the canvas follow the page's light or dark theme.
export function chartTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text-muted', '#465166'),
    grid: v('--border', '#d5dde6'),
    primary: v('--primary', '#0e8074'),
    navy: '#101b2d',
    amber: '#f2b84b',
  };
}
export const PALETTE = ['#0e8074', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#475569', '#ca8a04'];
