// Pure incentive rules. The database function mgmt_incentive_calc (0105_mgmt_incentive.sql) is the authority; this repeats it for
// live previews and is tested against the SAME fixture (tests/fixtures/manager-incentive-cases.json).
// Every typed figure is rounded to a whole rupee first, then:
//   commission = round(sale x sale rate) - pilferage - till short      generic part = round(generic sale x pool rate) - excess fine
//   grand = commission + cash-target bonus + generic part              net = grand - (plus fine + paper fine) - panel fine
//   owner's share = round(net x owner share) - tax
import { rup, rupTimes } from './salary.js';

export const INCENTIVE_FIELDS = [
  { key: 'sale', label: 'Sale value' },
  { key: 'generic_sale', label: 'Generic sale' },
  { key: 'pilferage', label: 'Less: pilferage' },
  { key: 'till_short', label: 'Less: till short' },
  { key: 'cash_target', label: 'Cash target bonus' },
  { key: 'excess_fine', label: 'Less: excess fine' },
  { key: 'plus_fine', label: 'Less: plus fine' },
  { key: 'paper_fine', label: 'Less: paper fine' },
  { key: 'panel_fine', label: 'Less: panel fine' },
  { key: 'tax', label: 'Less: tax (on the owner’s share)' },
];

const z = (n) => (n === 0 ? 0 : n);

// inputs: { sale, generic_sale, pilferage, ... } in rupees (missing = 0). rates: { sale_commission, generic_pool, owner_share } as fractions.
export function incentiveCalc(inputs, rates) {
  const v = Object.fromEntries(INCENTIVE_FIELDS.map((f) => [f.key, rup(inputs[f.key] ?? 0)]));
  const saleComm = rupTimes(v.sale, rates.sale_commission);
  const genInc = rupTimes(v.generic_sale, rates.generic_pool);
  const totalComm = saleComm - v.pilferage - v.till_short;
  const totalGen = genInc - v.excess_fine;
  const grand = totalComm + v.cash_target + totalGen;
  const pre = grand - (v.plus_fine + v.paper_fine);
  const net = pre - v.panel_fine;
  return {
    sale_comm: z(saleComm),
    gen_inc: z(genInc),
    total_comm: z(totalComm),
    total_gen: z(totalGen),
    grand_total: z(grand),
    pre_panel: z(pre),
    net_inc: z(net),
    owner_net: z(rupTimes(net, rates.owner_share) - v.tax),
  };
}
