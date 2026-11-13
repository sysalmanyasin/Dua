# Business Rules (Phase 0) — Fazal Din's Pharma Plus

Source: read directly from the old code (Closing `actions.js` calc(), `state.js`; BT-Sale-Data2 `platform/config.js`, `shared/summary-calc.js`; READMEs; Audit Hub blueprint).
Status: Sales rules are implemented (see §11). Closing has database/domain implementation and a partial guided-ledger UI; its remaining screens and workflows are still in progress. Inventory feed rules are implemented in the live feed, while Inventory screens and STR remain incomplete. Audit Hub and Emergency Billing remain planned. See `docs/PROJECT_STATUS.md` and the module progress files for current delivery status. Formulas below are **exactly as the old code computes them today**. V2 must reproduce them before anyone may change them.
Tags: KEEP / IMPROVE / DROP / ASK.

## 1. Time and dates
- Timezone Asia/Karachi (UTC+5, no DST). **Business day changes at 00:00.** (owner, 4 Nov 2026)
- Shift order in a day: **Night → Morning → Evening**. Night starts the day. Extra mid-day slots: Handover1, Handover2… (each has its own seq).
- A closing belongs to the date of its *slot*, not the time it was typed. [KEEP]
- Store UTC timestamps + a separate business_date. [IMPROVE]

## 2. Daily sales (Sales module)
- TOTAL = Σ(add fields, absolute value) − Σ(subtract fields, absolute value), rounded to whole rupee. Official sale = TOTAL. [KEEP]
- Add fields: Cash Sale, Meezan Bank (Paysa), Bank Alfalah, Bank Al Habib, HBL, MCB, Askari Bank, PSO, NESPAK, PARCO, TEPA, LDA, Gourmet, Wapda Hospital, BTH, Berger Paints, Ecolean PK, Style Textile, Syed Babar Ali Foundation, Rahnuma NGO, Health Pass, Nisar Spinning Mills, Food Panda, F/Issue.
- Subtract fields: Cash Returns, Askari Returns, PSO Returns, NESPAK Returns, PARCO Returns, TEPA Returns, LDA Returns.
- Owner-defined custom fields can be add / subtract / none (informational). [KEEP, becomes a payment_methods table]
- Information-only: COMP SALE, Customers, FDPP POS, FDPP Consumer, Amount Received, Load Sale, Cash to be Deposited, Low Sale Reason.
- COMP SALE = comparison figure from the POS. DIFF = TOTAL − COMP SALE (rounded; stored empty when 0). [KEEP]
- Monthly TOTAL = Σ daily TOTAL; monthly DIFF = monthly TOTAL − monthly COMP SALE. [KEEP]
- Alerts (briefing): cash DIFF ≥ Rs 10,000; sale ≥ 30% below same weekday last week; month projection < 90% of target (from day 10); incoming STR unreceived 3+ days. [KEEP as configurable thresholds]

## 3. Shift closing — inputs
POS: sys cash (`inSysCash`), last bill number, COMP SALE, Alfalah card, Keenu card. Returns: manual 1/2/3, system return. Book bills 1 and 2. Extra cash. Credit adjustment. Previous MEDIQ (manual). Final-mode extra system returns. HS rows. Strips (qty × price, configured + ad-hoc). Till and Vault counts by denomination (5000, 1000, 500, 100, 50, 20, 10, coins/loose). Credit: named accounts (multiple entries), 3 tier slots, free-label rows. Deposits. MEDIQ COD orders (bill no, cash collected, pharmacy bill). Misc rows. Inventory audit snapshot (31 fixed item codes). Responsible staff (required to submit).
Rows can be marked deleted (struck through): excluded from totals and carry-forward, but kept for audit. [KEEP]

## 4. Shift closing — calculation (shift mode)
1. HS total = Σ HS rows.
2. Strips A = Σ(price × qty) over configured + ad-hoc strips.
3. Total returns = manual1 + manual2 + manual3 + system return.
4. MEDIQ extra I = previousMediq + Σ(cash collected − pharmacy bill) per order. Gross COD is NOT counted.
5. Shift sale = sysCash if (Final mode OR day changed vs previous slot OR no previous slot); else sysCash − previous slot's sysCash. May be overridden by hand.
6. Customers = max(0, lastBillNum − previous lastBillNum); 0 if no previous. May be overridden.
7. **Net Sale = shiftSale + book1 + book2 + (customers × per_customer_charge) − totalReturns + I.** Customers are charged Rs 1 each (confirmed by owner; setting `per_customer_charge`, default 1).
8. Current CC = (Alfalah + Keenu) − COMP SALE (overridable). CC total B = previous CC + current CC.
9. Till C = Σ count × denomination; Vault D likewise.
10. Debt E = previous credit + named entries + 3 tier slots + free rows + credit adjustment.
11. Deposits F = previous deposits + Σ deposit rows. Misc G = Σ misc rows.
12. **Grand = HS + A + G + B + C + D + E + F.**
13. **Liquid = Grand − till_float.** till_float = Rs 45,000, the owner's extra cash in hand kept in the pharmacy (confirmed). Hard-coded in the old app; a setting in V2.
14. **Net Cash = Liquid − previous cash − extra cash.** (previous cash = previous slot's Liquid)
15. **Shift variance = Net Cash − Net Sale.** Positive = Plus (surplus), negative = Less (shortage).

## 5. Final Closing (period roll-up since last Final)
Period = all slots after the last Final record. Part 1 — Net Final Sale = same-date POS shift sales (incl. last Final if same date) + all book bills + same-date customers + all MEDIQ extra − all manual returns − same-date system returns − extra final system returns.
Part 2 — Net Final Cash = Liquid − preDate total − all extra cash − Net Final Sale, where preDate total = earlier-date POS sale + customers − system returns.
**Final variance = Net Final Cash.** In Final mode the "period" figures use this closing's own values only (plus rules above for earlier slots).
Known trap in old data: a shift record's saved `finalDiff` was once the *cumulative* period figure; correct rule is each shift's own variance (netCash − netSale). V2 stores each shift's own variance; cumulative is derived. [IMPROVE]

## 6. Carry-forward between slots
- CC: Night takes previous Evening's (prevCC + currCC). Morning and Evening reuse the same base Night carried (they do not add Night's/Morning's currCC).
- Credit: previous slot's total E. Deposits and previous cash: previous slot's F and Liquid (both reset to 0 in Final mode).
- Misc rows: all non-deleted previous rows carry forward in both modes.
- First slot with no history: all carried values 0.

## 7. Saving and locking
- Draft autosave every 3 s; submitted = locked. Submit requires: responsible staff chosen; Inventory Audit synced and verified; saved to cloud; online. [KEEP; IMPROVE: checked in the database, no dependency on a push notification]
- Closing alerts go to the owner on submit. [KEEP, via V2 notifications]
- Credit Ledger snapshot written for every submitted shift. Misc/Ongoing ledger derived live from misc rows; aging matched by label text (old limitation). [IMPROVE: stable charge IDs]
- Retention: nothing auto-deletes; archive is a PIN-gated admin action. [KEEP, archive not delete]
- Settings changes are versioned and restorable. [KEEP]

## 8. Inventory / STR / Audit (from READMEs; code details to be confirmed in Phase 4/7)
- Stock, products, STR and "Sale Payments" come **read-only from the Candela POS → Dropbox → Supabase pipeline**. Candela stays the source of truth (D-07, confirmed). V2 stores dated snapshots.
- Never Sold: has stock, no sale record, received > 60 days ago. Dead Stock: has a sale record, none in 60 days, received > 60 days ago. Pack down-rounding by conversion factor. Excess = stock − (net 90-day qty ÷ 90 × 100), only if net90 > 0 and stock ≥ 4 (old Excess Working default view: 90+ days cover). Reorder windows 30/60/90 days; inbound STR = In Transit.
- STR lifecycle derived from dispatch/receive state: Awaited / Dispatched / Received; Zero Dispatch = STR qty > 0 and dispatch qty = 0.
- Audit: Engagement → Round (Draft → Locked → Counting → Compiled → Final) → Assignment → Submission. Round 1 by company; Round 2+ by company + item (differences only / full recount / random spot-check). Merge key Company + Item. Compile blocked unless all submitted or explicitly overridden. Final snapshot locks everything. Staff see only their own assignments.

## 9. Emergency Billing (break-glass)
Cart search by name/generic/code; add blocked if stock cannot be verified. Discount flat or percent, resolved to one rupee amount. Held bills. Refund validated in database: invoice+line exist, qty > 0, minus earlier refunds, no over-refund, stock restored. Receipts 58 mm/80 mm. Must be reconciled against normal sales entry. [KEEP; fix open anon access]

## 10. Feature checklist (Keep / Improve / Drop)
| Feature | Verdict |
|---|---|
| Daily sales, payments, DIFF, targets, cash deposit report, daily checklist | KEEP |
| Shift closing, Final closing, Closing Book, Register Book, CC/RBD/MEDIQ history, Credit and Misc ledger | KEEP |
| Audit Hub (engagements, rounds, counting, variance, final snapshot, barcode, expiry, racks) | KEEP |
| Staff registry, salary, payslip, petty cash, ledger, incentive, credit | KEEP |
| Attendance + geofencing | ASK (owner: later, Android last) |
| Emergency billing | KEEP, secure |
| Notes and Sheets, PDF library, activity log | KEEP |
| BT Intelligence / Dua assistant, forecast game, voice | DEFER to Phase 9, read-only, deterministic numbers stay authoritative |
| Herald headlines, in-app briefing | KEEP |
| Email briefing (Gmail read) | ASK |
| Android widgets (22) | LAST phase, repoint to V2 |
| Browser-held AI provider keys, anon-open tables, committed keystores, ntfy topics in repo | DROP |

## 11. Rules as built (Sales), confirmed by the owner
- **TOTAL (decided 5 Nov):** adds every *add* field **with its sign** (a negative amount in a client or bank column reduces the day) and subtracts every *deduct* field whatever sign was typed; info-only fields are ignored; rounded to a whole rupee like JavaScript `Math.round`. This reproduces 2,378 of the 2,379 stored totals. DIFF = TOTAL − COMP SALE, always computed.
- **Cash to be Deposited** = Cash Sale − Cash Returns + FDPP POS + FDPP Consumer, worked out fresh for each day.
- **Customers charge:** Rs 1 per customer is added to Net Sale in the closing (setting `per_customer_charge`); **till float:** Rs 45,000 extra cash in hand (setting `till_float`). Used by the Closing phase.
- **Sale Report:** Net Cash Sale = cash and bank fields (and your own non-credit fields) with returns negative; Net Credit Sale likewise for Credit Clients; Grand Total = both, equal to the TOTAL rule. "COMP SALE" and "Difference" rows appear only when a COMP SALE figure exists. Till Short and Patty Cash are typed by hand. Row visibility never changes totals.
- **Daily Check List:** opening stock = (closing + cash sale + credit sale) − receive; returns are shown negative; net total = cash sale + credit sale; total customers = cash + panel; a section is complete when every required box is filled (optional boxes, dates, notes and sign-off do not count); 19 sections.
- **Dashboard:** the running month is compared with the previous month's and last year's **same days**; year to date against last year to the same point; forecast = daily average × days in month; branch score = average of target achievement, growth against last year (50 + 2.5 × % change, limited to 0–100) and customer growth; CAGR = first 12 months to latest 12 months per year (needs 24 months); cumulative difference counts only months with a COMP SALE. Heat map shades each day by quartile among that year's own sale days.
- **Months and years:** a month belongs to the date of its days; two old April months were corrected (30 days typed with the wrong year); April 2021 exists only as a monthly figure (11,182,353).
- **Corrections:** a saved day is never deleted or silently overwritten; a correction needs a reason and keeps the earlier version.
- **Staff view:** a basic staff member sees only the latest closed day's total.
