# Phase 3 — Sales: design (for approval)

Source studied: BT-Sale-Data2 `js/sales/*` (21 files, ~6,900 lines), its README, and your real backup of 5 Nov 2026 (2,379 days, 80 months, Apr 2020 → 4 Nov 2026).

## 1. What stays, what improves
| Old feature | V2 | Notes |
|---|---|---|
| Entry (daily form, sections Cash / Banks / Credit Clients / Summary, live TOTAL preview, prefill) | KEEP, IMPROVE | Same sections and look. Total computed by the database; the live preview uses the same rule (parity-tested). Mobile-first big inputs. |
| Manage Fields (add your own bank/client column, hide columns) | KEEP | Becomes a real `payment_methods` table: add / hide / order, with add / subtract / info-only. |
| Data page (all days, edit, delete) | KEEP, IMPROVE | Edits create a correction revision with a reason; nothing is overwritten. |
| Index (month cards grouped by year, target bar, yearly print) | KEEP | Months are derived from days, never typed twice. |
| Dashboard KPIs: latest month, YTD, CAGR since 2020, avg bill, customers, cash+bank, credit, forecast vs target, Branch Performance Score | KEEP | Calculated in SQL views, so the phone downloads a few numbers, not 2,379 rows. |
| Charts: Total (presets + compare), Year-on-Year, Customers, Cash vs Bank, Credit clients | KEEP | Chart.js, vendored (no CDN). |
| Insights: Target Pace, Best Day comparison, Month-on-Month, rotating insight strip, "since you last looked", rule alerts | KEEP | Deterministic rules, no AI needed. |
| Top 10 days, Day-of-week, Best/Worst month per year, Calendar heatmap, Race the Forecast, Bar Race | KEEP | Same visuals; heatmap quartiles per year as before. |
| Reports: day report / Sale Book, monthly and yearly print, PDF, Diff report, Cash Deposit report | KEEP, IMPROVE | PDF via vendored jsPDF; same layouts first, then polish. |
| Daily Check List | KEEP, IMPROVE | Old one kept drafts only on the phone. V2 stores ticks in the database per day. |
| Targets | KEEP | Monthly targets table, `targets.manage` permission. |
| Sale Payments (from Candela) | LATER | Comes with the Candela snapshot import (Phase 4). |
| Credit Details and Petty cash blocks on the dashboard | LATER | They read Management data (Phase 8). Placeholders hidden until then. |
| AI Forecast Game, voice, assistant | Phase 9 | |

**Design**: your brand colours are now the design tokens (navy `#101B2D`, teal `#18A999`, AA-safe teal `#0E8074` light / `#14998B` dark, amber `#F2B84B`, slate `#465166`). Light and dark. Amber is used for aggregates and highlights, as before.

## 2. Security for Sales (answers "best structure and security")
- Staff see **only the last closed day's total** through one database function; no table access to history (`sales.view_history` is a separate permission).
- Entering, correcting and viewing history are three separate permissions (`sales.enter`, `sales.edit`, `sales.view_history`), assignable per person.
- Saving a day is one database function (idempotent). Corrections keep the old version and the reason. Every change is in the activity log.
- No raw table writes from the browser.

## 3. Database (migration 0002)
`payment_methods` (code, label, section, sign add|sub|none, sort, active) · `daily_sales` (business_date, comp_sale, customers, fdpp_pos, fdpp_consumer, amount_received, load_sale, cash_to_deposit, low_sale_reason, total, diff, revision, source) · `daily_sale_lines` (day, method, amount) · `daily_sales_revisions` (full copy of each superseded version + reason + who) · `monthly_history` (months that only exist as monthly figures) · `sales_targets` · `daily_checklist_*`. Views: `v_daily`, `v_monthly` (derived from days + monthly_history), `v_year_summary`. Functions: `sales_save_day()`, `sales_last_closed_day()`, `sales_dashboard()`.
Settings stay in the existing `settings` table.

## 4. Decisions needed from your real data
The import checker (below) found these. They are choices only you can make.
1. **110 old days where a client column holds a negative number** (PSO 44 times, LDA 41, PARCO 20, NESPAK 6, others). The old app's *stored* totals treat that as a reduction (a credit return typed in the client's column), but the old app's *current* formula flips it to an addition (it uses the absolute value). So re-saving any of those days in the old app would silently raise its total. I recommend **signed**: a negative in a client or bank column reduces the day; Returns columns always subtract. This reproduces 2,378 of 2,379 stored totals exactly.
2. **April 2022**: 30 days are typed with the year 2021 (`01/Apr/2021` …) but labelled "April 2022". Their sum equals the monthly April 2022 figure (7,847,467) and fits between March and May 2022, so I believe the typed year is the mistake. April 2021 then becomes a monthly-only month (11,182,353). I will correct the dates to 2022 only if you confirm.
3. **25 Sep 2026**: stored TOTAL 437,288 but its fields add up to 431,614 (difference 5,674). Probably a field edited after the total was saved. Which is right?
4. **5 days (19–23 Jun 2026)** have a COMP SALE but an empty DIFF in the old data. V2 always computes DIFF, so they will show values.
5. **Rounding**: TOTAL rounds to a whole rupee as before.

## 5. Import (not part of the app)
`tools/import/sales-import.mjs` reads your backup file, checks every day against the formula and writes a clean file plus a findings list; it contacts no database and the backup never enters Git. Applying it to the database is the second step, after migration 0002 exists and you have answered section 4. To apply it I need either a computer with Node and the project's service key, or I use a one-time admin-only Edge Function that I delete afterwards (works from your phone). Tell me which.

## 6. Build order (each part tested, then your approval)
- **3a Data and entry**: migration 0002, payment methods, Entry page, Data page (history, edit with reason), staff "last day" view, import applied. *Accept when 2,378 imported totals match the old totals and the live preview equals the saved total.*
- **3b Dashboard**: KPI cards, five charts, insights, top days, weekday, best/worst, heatmap.
- **3c Reports**: day report / Sale Book, month and year reports, Diff report, Cash Deposit report, print and PDF.
- **3d Targets and Daily Check List**, then the two fun widgets (Race the Forecast, Bar Race).
