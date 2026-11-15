// Turns the bill on screen into the one payload the server accepts, and turns the server's answer into plain words.
// The invoice id is made once per bill and reused on every retry; that, with the server's duplicate check, is what makes
// "save again" safe.

export const newInvoiceId = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export function buildInvoice({ cart, bill, totals, deviceId, invoiceId, now = new Date() }) {
  return {
    invoice_id: invoiceId,
    device_id: deviceId,
    client_created_at: now.toISOString(),
    customer: bill.customer || '',
    payment_mode: bill.mode,
    customer_discount_pct: bill.customerDiscountPct,
    receipt_discount: bill.receiptOn ? { mode: bill.receiptDiscount.mode, value: bill.receiptDiscount.value } : { mode: 'amt', value: 0 },
    tax_pct: bill.taxPct,
    adjustment: bill.adjustment,
    cash_received: bill.cash,
    comments: [bill.comments, bill.more]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join('\n'),
    totals: { gross_total: totals.grossTotal, net_total: totals.netTotal },
    lines: cart.lines.map((l) => ({
      code: l.code,
      name: l.name,
      generic: l.generic || '',
      unit: l.unit,
      pack: l.pack,
      qty: l.qty,
      rate: l.rate,
      discount: { mode: l.discount.mode, value: l.discount.value },
    })),
  };
}

const WORDS = {
  invalid: 'The invoice could not be accepted. Check the items and amounts.',
  device_unknown: 'This device is not registered yet. Check your connection and try again.',
  device_inactive: 'This device has been switched off by the manager. Ask the manager.',
  pin_required: 'Enter your PIN to save.',
  no_pin: 'No PIN has been set for you. Ask the owner to set one in Settings.',
  bad_pin: 'Wrong PIN.',
  locked: 'Too many wrong PINs. Try again in 15 minutes.',
  total_mismatch: 'The total does not match the items. Reload the page and try again.',
  discount_limit: 'The discount is above your limit. Reduce it or ask a manager.',
  id_conflict: 'This invoice id is already used by someone else. Start a new bill.',
};
/** One sentence for a refusal result. The server's own message wins when it sent one. */
export const refusalText = (r) => (r && (r.message || WORDS[r.code])) || 'The invoice was not saved.';
/** Refusals that mean "try the PIN again" rather than "give up on this attempt". */
export const isPinRetry = (r) => r?.code === 'bad_pin' || r?.code === 'pin_required';
