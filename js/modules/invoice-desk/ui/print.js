// Browser print of one saved invoice on an 80 mm thermal roll (no ESC/POS bridge, no silent print).
// The slip is 72 mm wide, centred on the 80 mm roll. Chrome and Edge do not understand `@page { size: 80mm auto }` and would print
// on a Letter sheet, so the slip is measured at its real print width and the page is set to that exact length first.
import { render } from '../../../shared/html.js';
import { renderInvoice } from './renderers.js';

export const ROLL_WIDTH_MM = 80;
const PX_PER_MM = 96 / 25.4;

/** Page length for a slip of the given measured height: rounded up to a whole millimetre plus 1 mm so rounding never spills a second page. */
export const pageHeightMm = (slipHeightPx) => Math.ceil(slipHeightPx / PX_PER_MM) + 1;

function thermalPageRule(doc) {
  for (const sheet of doc.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a cross-origin sheet
    }
    for (const rule of rules) if (rule.type === 6 /* CSSRule.PAGE_RULE */ && rule.selectorText === 'invoice-thermal') return rule;
  }
  return null;
}

// The slip's bundled faces (css/fonts.css) load lazily; measuring before they arrive would size the page for the fallback fonts.
const SLIP_FACES = ['Caladea', 'Carlito', 'Cousine', 'Comic Neue', 'Noto Naskh Arabic'];
async function fontsReady(doc) {
  if (!doc.fonts?.load) return;
  try {
    await Promise.all(SLIP_FACES.map((f) => doc.fonts.load(`700 16px "${f}"`, f === 'Noto Naskh Arabic' ? 'ابج' : 'Ab')));
    await doc.fonts.ready;
  } catch {
    /* a font that cannot load falls back to the system one, so measure anyway */
  }
}

/** Puts the slip into #print-root and sizes the print page to it. Returns the page height in mm and a function that undoes it all. */
export async function prepareThermalPrint(invoice, doc = document) {
  const root = doc.getElementById('print-root') || doc.createElement('div');
  root.id = 'print-root';
  render(root, renderInvoice(invoice));
  if (!root.isConnected) doc.body.append(root);
  await fontsReady(doc);
  root.classList.add('id-measuring');
  const heightMm = pageHeightMm(root.getBoundingClientRect().height);
  root.classList.remove('id-measuring');
  thermalPageRule(doc)?.style.setProperty('size', `${ROLL_WIDTH_MM}mm ${heightMm}mm`);
  doc.body.classList.add('printing-invoice');
  const cleanup = () => {
    doc.body.classList.remove('printing-invoice');
    root.replaceChildren();
  };
  return { heightMm, cleanup };
}

export async function printInvoice(invoice, win = window) {
  const { cleanup } = await prepareThermalPrint(invoice, win.document);
  const done = () => {
    cleanup();
    win.removeEventListener('afterprint', done);
  };
  win.addEventListener('afterprint', done, { once: true });
  win.print();
}
