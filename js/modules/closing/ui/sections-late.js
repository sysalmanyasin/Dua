// Sections 6-14 of the ledger: Inventory Audit, Misc, Card, Till, Vault, Credit, Deposits, Final Audit, Final aggregation.
// Pure markup plus one function that turns the server's preview into display figures. All money rules stay in the database
// (closing_compute / closing_period); nothing here invents a figure the server did not give, except two plain identities noted below.
import { html } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { DENOMINATIONS } from '../domain/compute.js';

const DENOM_LABELS = [
  'Rs. 5,000 notes',
  'Rs. 1,000 notes',
  'Rs. 500 notes',
  'Rs. 100 notes',
  'Rs. 50 notes',
  'Rs. 20 notes',
  'Rs. 10 notes',
  'Coins / loose change',
];
const amber = (label, value) =>
  html`<div class="cls-row">
    <label>${label}</label
    ><input class="cls-in is-carried" readonly value="${money(value ?? 0, { decimals: true })}" aria-label="${label}" />
  </div>`;
const add = (list, text) =>
  html`<div class="actions"><button type="button" class="btn btn-sm" data-act="add" data-list="${list}">${text}</button></div>`;

/** h: helpers from the ledger (S, field, total, textCell, numCell, strike, canManage). Returns one render function per section index. */
export function lateSections(h) {
  const { S, field, total, textCell, numCell, strike } = h;

  const countRows = (area) =>
    DENOMINATIONS.map(
      (d, i) =>
        html`<div class="cls-row">
          <label for="f-${area}.${i}">${DENOM_LABELS[i]}</label>
          <input
            class="cls-in"
            id="f-${area}.${i}"
            data-f="${area}.${i}"
            inputmode="numeric"
            autocomplete="off"
            value="${S.form[area][i]}"
            aria-invalid="${h.bad(`${area}.${i}`)}"
          />
        </div>`,
    );

  const rowsTable = (list, cols, cells) =>
    html`<div class="cls-table" style="--cols: ${cols}">
      ${h.listOf(list).map((r) => html`<div class="cls-trow ${r.deleted ? 'is-struck' : ''}" style="--cols: ${cols}">${cells(r)} ${strike(list, r)}</div>`)}
    </div>`;

  const invaudit = () => {
    const req = S.auditRequired;
    return html`<h2>6 · Inventory Audit</h2>
      ${
        req === false
          ? html`<p class="cls-meta">The inventory audit requirement is switched off, so a closing can be submitted without it.</p>`
          : html`<div class="cls-soon">
              The inventory audit card arrives with the Inventory feed and is not connected yet. While the requirement is on, submitting a
              closing is refused with “The inventory audit has not been verified”.
            </div>`
      }
      ${
        h.canManage
          ? html`<div class="actions">
                <button type="button" class="btn btn-sm" data-act="audit-toggle" data-to="${req === false ? 'on' : 'off'}">
                  ${req === false ? 'Switch the requirement back on' : 'Switch the requirement off…'}
                </button>
              </div>
              <p class="cls-meta">Owner only. The change is recorded with your reason.</p>`
          : ''
      }`;
  };

  const misc = () =>
    html`<h2>7 · Ongoing / Miscellaneous Charges (C)</h2>
      <p class="cls-meta">Charges still open from earlier closings carry over here. Strike a row out when it is settled.</p>
      ${rowsTable('misc', 1, (r) => html`${textCell('misc', r, 'label', 'Charge')} ${numCell('misc', r, 'amount', 'Amount')}`)}
      ${add('misc', '＋ Add Row')} ${total('Total Misc (C)', 'misc')}`;

  const cc = () =>
    html`<h2>8 · Credit Card Summary (D)</h2>
      ${amber('Carried CC from Previous', S.carry?.cc)}
      ${field('overrides.curr_cc', 'Card Sales This Shift (D)', { note: 'Leave empty to use Bank Alfalah + Keenu − Computer Card Sale. A typed 0 counts.' })}
      ${total('Total CC', 'ccTotal')}`;

  const till = () =>
    html`<h2>9 · Till Cash (E)</h2>
      ${countRows('till')} ${total('Total Till Cash (E)', 'till')}`;
  const vault = () =>
    html`<h2>10 · Draw Cash (F)</h2>
      ${countRows('vault')} ${total('Total Draw Cash (F)', 'vault')}`;

  const credit = () =>
    html`<h2>11 · Credit Detail (G)</h2>
      <p class="cls-meta">Enter this shift's NEW credit only. What was carried in is shown separately.</p>
      ${amber('Carried Debt from Previous Shift', S.carry?.credit)}
      <div class="cls-row">
        <label for="f-credit_adj">Credit Adjustment<small>Use ± for a reduction, for example −500.</small></label>
        <div class="cls-signed">
          <button type="button" class="btn btn-sm" data-act="sign" data-f="credit_adj" aria-label="Toggle positive or negative">±</button>
          <input
            class="cls-in"
            id="f-credit_adj"
            data-f="credit_adj"
            inputmode="decimal"
            autocomplete="off"
            value="${S.form.credit_adj}"
            aria-invalid="${h.bad('credit_adj')}"
          />
        </div>
      </div>
      ${
        S.form.credit.named.length
          ? html`<h3 class="sec-label">Named accounts</h3>
              ${rowsTable('credit.named', 1, (r) => html`<span class="cls-name">${r.label}</span> ${numCell('credit.named', r, 'amount', r.label)}`)}`
          : ''
      }
      <h3 class="sec-label">Tier / Staff Credit</h3>
      <div class="cls-table" style="--cols: 1">
        ${S.form.credit.tier.map(
          (r, slot) =>
            html`<div class="cls-trow" style="--cols: 1">
              ${
                S.tierNames[slot].length
                  ? html`<select class="cls-in cls-text" data-list="credit.tier" data-id="${r.id}" data-k="label" aria-label="Group">
                      <option value="">— Group —</option>
                      ${S.tierNames[slot].map((t) => html`<option value="${t}" ${t === r.label ? 'selected' : ''}>${t}</option>`)}
                    </select>`
                  : textCell('credit.tier', r, 'label', 'Group')
              }
              ${numCell('credit.tier', r, 'amount', 'Amount')}<span></span>
            </div>`,
        )}
      </div>
      <h3 class="sec-label">Aux / Other Credit</h3>
      ${rowsTable('credit.free', 1, (r) => html`${textCell('credit.free', r, 'label', 'Name')} ${numCell('credit.free', r, 'amount', 'Amount')}`)}
      ${add('credit.free', '＋ Add Aux Row')} ${total('Total Credit Detail (G)', 'debt')}`;

  const deposits = () =>
    html`<h2>12 · Cash Deposit Details (H)</h2>
      ${amber('Carried Deposits from Previous', S.carry?.deposits)}
      ${rowsTable('deposits', 1, (r) => html`${textCell('deposits', r, 'label', 'Deposit')} ${numCell('deposits', r, 'amount', 'Amount')}`)}
      ${add('deposits', '＋ Add Row')} ${total('Total Cash Deposits (H)', 'deposits')}`;

  const banner = (title, sub, k) =>
    html`<div class="cls-banner">
      <div class="cls-banner-title">${title}</div>
      <div class="cls-meta">${sub}</div>
      <div class="cls-banner-row"><span>Target Net Sales</span><strong data-total="${k}Target">–</strong></div>
      <div class="cls-banner-row"><span>Net Cash Available</span><strong data-total="${k}Cash">–</strong></div>
      <div class="cls-banner-row"><span data-total="${k}VarLabel">Variance</span><strong data-total="${k}Var">–</strong></div>
    </div>`;

  const audit = () =>
    html`<h2>13 · Final Audit</h2>
      <div class="cls-row"><label>Grand Total (A+B+C+D+E+F+G+H)</label><strong class="cls-val" data-total="grand">–</strong></div>
      <div class="cls-row">
        <label>Less: Cash Reserve (held in till)</label><strong class="cls-val cls-neg" data-total="reserve">–</strong>
      </div>
      <div class="cls-row"><label>Net Cash Available</label><strong class="cls-val" data-total="liquid">–</strong></div>
      ${amber("Previous Shift's Cash Position (carried)", S.carry?.cash)}
      ${field('overrides.prev_cash', "Less: Previous Shift's Cash Position", { note: 'Leave empty to use the carried figure. A typed 0 counts.' })}
      <div class="cls-total cls-total-net"><span>Net Committed Cash (this shift)</span><strong data-total="netCash">–</strong></div>
      ${field('extra_cash', 'Extra Cash Added to Pharmacy', { note: 'Taken off Net Cash, applied at the next Final.' })}
      ${banner('Reconciliation', S.mode === 'final' ? 'Whole period since the last Final' : 'This shift only', 'b')}`;

  const final = () =>
    html`<h2>14 · Final Closing — Period Aggregation</h2>
      <div class="cls-row"><label>Shifts since last Final</label><strong class="cls-val" data-total="shifts">–</strong></div>
      <h3 class="sec-label">Part 1 — Net Final Sale (POS)</h3>
      <div class="cls-row">
        <label>＋ POS Sale — same-date shifts &amp; this closing</label><strong class="cls-val" data-total="pSale">–</strong>
      </div>
      <div class="cls-row">
        <label>＋ Book Bills — all periods ＋ prev. final</label><strong class="cls-val" data-total="pBooks">–</strong>
      </div>
      <div class="cls-row"><label>＋ Customers — same-date (count)</label><strong class="cls-val" data-total="pCust">–</strong></div>
      <div class="cls-row">
        <label>＋ Extra MEDIQ Collected — all periods ＋ prev. final</label><strong class="cls-val" data-total="pMediq">–</strong>
      </div>
      <div class="cls-row cls-return">
        <label>－ Manual Returns — all periods ＋ prev. final</label><strong class="cls-val" data-total="pManRet">–</strong>
      </div>
      <div class="cls-row cls-return">
        <label>－ System Returns — same-date</label><strong class="cls-val" data-total="pSysRet">–</strong>
      </div>
      ${field('final_sys_returns', 'Additional Sys Returns (entered here)', { cls: 'cls-return' })}
      <div class="cls-total cls-total-net"><span>＝ Net Final Sale</span><strong data-total="finalNetSale">–</strong></div>
      <h3 class="sec-label">Part 2 — Net Final Cash Available</h3>
      <div class="cls-row">
        <label>Net Cash Available (after the cash reserve)</label><strong class="cls-val" data-total="liquid">–</strong>
      </div>
      <div class="cls-row cls-return">
        <label>－ Pre-date Total (earlier-date sales ＋ customers － system returns)</label
        ><strong class="cls-val" data-total="pPre">–</strong>
      </div>
      <div class="cls-row cls-return">
        <label>－ Extra Cash Added to Pharmacy (period)</label><strong class="cls-val" data-total="pExtra">–</strong>
      </div>
      <div class="cls-row cls-return">
        <label>－ Target Net Sales (this Final)</label><strong class="cls-val" data-total="finalNetSale">–</strong>
      </div>
      <div class="cls-total cls-total-net"><span>＝ Net Final Cash Available</span><strong data-total="finalNetCash">–</strong></div>
      ${banner('Aggregated Final Closing', 'Always the full period since the last Final Closing', 'f')}`;

  return { 5: invaudit, 6: misc, 7: cc, 8: till, 9: vault, 10: credit, 11: deposits, 12: audit, 13: final };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const m = (v) => money(v, { decimals: true });

/**
 * Display figures from the server's preview `p` (closing_compute, rupees) and `period` (closing_period), plus the typed form.
 * Two plain identities are used, both documented in docs/BUSINESS_RULES.md: reserve = grand − liquid, and
 * pre-date total = liquid − final cash − period extra cash − final sale (rearranging final_net_cash).
 * Returns { key: { text, neg } }. Variance is red only when it is a deficit (CLS-15).
 */
export function previewFigures(p, period, form, mode) {
  if (!p || p.grand === undefined) return {};
  const a = period && typeof period === 'object' ? period : {};
  const manual = ['0', '1', '2'].reduce((t, i) => t + num(form.ret_manual[i]), 0);
  const books = num(form.book[0]) + num(form.book[1]);
  const extra = num(a.total_extra_cash) + num(form.extra_cash);
  const out = {};
  const put = (k, v, neg = false) => (out[k] = { text: m(v), neg });
  put('netSale', p.net_sale, p.net_sale < 0);
  out.shiftInfo = { text: `${m(p.shift_sale)} · ${p.customers}`, neg: false };
  put('grand', p.grand);
  put('reserve', p.grand - p.liquid);
  put('liquid', p.liquid);
  put('netCash', p.net_cash, p.net_cash < 0);

  const variance = (prefix, target, cashGross, diff) => {
    put(`${prefix}Target`, target);
    put(`${prefix}Cash`, cashGross);
    out[`${prefix}VarLabel`] = { text: diff === 0 ? '✓ Variance' : diff > 0 ? '▲ Plus' : '▼ Less', neg: false };
    out[`${prefix}Var`] = { text: m(Math.abs(diff)), neg: diff < 0 };
  };
  if (mode === 'final') variance('b', p.final_net_sale, p.final_net_cash + p.final_net_sale, p.final_net_cash);
  else variance('b', p.net_sale, p.net_cash + p.net_sale, p.shift_variance);
  variance('f', p.final_net_sale, p.final_net_cash + p.final_net_sale, p.final_net_cash);

  out.shifts = { text: mode === 'final' ? '—' : String(num(a.closings_in_period) + 1), neg: false };
  put('pSale', num(a.same_date_shift_sale) + num(a.lf_same_date_sale) + p.shift_sale);
  put('pBooks', num(a.total_book_bills) + books);
  out.pCust = { text: String(num(a.same_date_customers) + num(a.lf_same_date_cust) + p.customers), neg: false };
  put('pMediq', num(a.total_mediq_extra) + p.mediq_extra);
  put('pManRet', num(a.total_manual_returns) + manual);
  put('pSysRet', num(a.same_date_sys_returns) + num(a.lf_same_date_sys_ret) + num(form.ret_system));
  put('finalNetSale', p.final_net_sale);
  put('finalNetCash', p.final_net_cash, p.final_net_cash < 0);
  put('pPre', p.liquid - p.final_net_cash - extra - p.final_net_sale);
  put('pExtra', extra);
  return out;
}
