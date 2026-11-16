// Excess Working maths, ported from the old app (js/inventory/excess-working.js: computeRows, summarize, applyRecalcFilters).
// Input is the Stock Ledger's 100-day Excess list (ledger.js `excess`). Pack-correction: only whole packs count, re-priced
// at the product's own average value per unit; each product is then Retained (on the owner's retain list), Loose (less than
// one whole pack of excess) or Excess. A pack size the feed marks unusable counts as 1 (INV-18).

/** Narrow the list to products old enough to trust and genuinely oversupplied (defaults on: 90 days old, 200 days of cover). */
export function applyRecalcFilters(rawExcess, { minAgeOn = true, minAgeDays = 90, minStockDaysOn = true, minStockDays = 200 } = {}) {
  return rawExcess.filter((r) => {
    if (minAgeOn && r.daysOld !== null && r.daysOld !== undefined && r.daysOld < minAgeDays) return false;
    if (minStockDaysOn && (r.stockDays === null || r.stockDays === undefined || r.stockDays < minStockDays)) return false;
    return true;
  });
}

/** @param {Set<string>} retainSet lower-cased trimmed product names */
export function computeExcessRows(rawExcess, retainSet) {
  return rawExcess.map((r) => {
    const qty = Number(r.excessQty) || 0;
    const value = Number(r.excessValue) || 0;
    let factor = Number(r.pack);
    const packUnreliable = r.packValid === false || !(factor && factor > 0 && Number.isFinite(factor));
    if (packUnreliable) factor = 1;
    const packQty = Math.floor(qty / factor);
    // Math.floor matches the spreadsheet's ROUNDDOWN
    const correctedValue = qty > 0 ? Math.floor((value / qty) * (packQty * factor)) : 0;
    const nameKey = String(r.name || '')
      .trim()
      .toLowerCase();
    const status = retainSet.has(nameKey) ? 'Retained' : packQty === 0 ? 'Loose' : 'Excess';
    return {
      code: r.code,
      name: r.name,
      company: r.company || r.supplier || '',
      qty,
      value,
      factor,
      packUnreliable,
      packQty,
      correctedValue,
      status,
      excessContribution: status === 'Excess' ? correctedValue : 0,
      daysOld: r.daysOld,
      stockDays: r.stockDays,
    };
  });
}

export function summarizeExcess(computed, misc, hoValue) {
  const totalRawValue = computed.reduce((s, r) => s + (r.value || 0), 0);
  const totalExcess = computed.filter((r) => r.status === 'Excess').reduce((s, r) => s + r.excessContribution, 0);
  const totalRetained = computed.filter((r) => r.status === 'Retained').reduce((s, r) => s + r.correctedValue, 0);
  // a residual, not a per-row sum: true loose items plus the fractional remainder rounded away from every other row
  const totalLoose = totalRawValue - totalRetained - totalExcess;
  const top10 = computed
    .filter((r) => r.status === 'Excess')
    .map((r) => r.excessContribution)
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((s, v) => s + v, 0);
  const hasHo = hoValue !== null && hoValue !== undefined && hoValue !== '' && !Number.isNaN(Number(hoValue));
  return {
    totalRawValue,
    totalExcess,
    totalRetained,
    totalLoose,
    top10,
    correctedExcessStockValue: totalExcess - (misc || 0),
    variance: hasHo ? Number(hoValue) - totalRawValue : null,
  };
}

export const topExcessRows = (rows, n = 20) =>
  rows
    .filter((r) => r.status === 'Excess')
    .sort((a, b) => b.correctedValue - a.correctedValue)
    .slice(0, Math.max(1, n || 20));

export const retainKey = (name) =>
  String(name || '')
    .trim()
    .toLowerCase();
