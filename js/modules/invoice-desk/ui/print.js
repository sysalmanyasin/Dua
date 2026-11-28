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

/** Puts the slip into #print-root and sizes the print page to it. Returns the page height in mm and a function that undoes it all. */
export function prepareThermalPrint(invoice, doc = document) {
  const root = doc.getElementById('print-root') || doc.createElement('div');
  root.id = 'print-root';
  render(root, renderInvoice(invoice));
  if (!root.isConnected) doc.body.append(root);
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

export function printInvoice(invoice, win = window) {
  const { cleanup } = prepareThermalPrint(invoice, win.document);
  const done = () => {
    cleanup();
    win.removeEventListener('afterprint', done);
  };
  win.addEventListener('afterprint', done, { once: true });
  win.print();
}
