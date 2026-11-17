export function validateInvoiceHeader(header) {
  const errors = {};
  if (!['bs-mart','safari-book-land','best-choice-store'].includes(header.businessId)) errors.businessId = 'Select a business.';
  if (typeof header.invoiceNumber !== 'string' || header.invoiceNumber.length < 1 || header.invoiceNumber.length > 120) errors.invoiceNumber = 'Enter an invoice number (1–120 characters).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.invoiceDate ?? '')) errors.invoiceDate = 'Enter a valid invoice date.';
  return errors;
}
export function validateLine(line) {
  const errors = {};
  if (typeof line.description !== 'string' || !line.description.trim() || line.description.length > 500) errors.description = 'Description is required (maximum 500 characters).';
  try { const q = String(line.quantity); if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(q) || Number(q) <= 0) errors.quantity = 'Quantity must be greater than zero (up to 3 decimals).'; } catch { errors.quantity = 'Enter a valid quantity.'; }
  try { const p = String(line.unitPrice); if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(p)) errors.unitPrice = 'Enter a valid non-negative price.'; } catch { errors.unitPrice = 'Enter a valid price.'; }
  return errors;
}
