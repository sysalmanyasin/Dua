// Display helpers for the Inventory Audit card.

/** "14 Nov 2026, 4:39 pm" in Karachi time, or "" when there is no time. */
export function whenKarachi(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** A stock quantity with thousands separators; a fraction keeps up to two decimals. */
export const qtyText = (q) => (Number(q) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
