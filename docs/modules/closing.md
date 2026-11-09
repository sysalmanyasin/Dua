# Closing — brief

Status: **Briefed** (awaiting owner approval) · Owner approval: no
Branch: `module/closing` · Migration range: `0200–0299` · Prefix: `closing_` · Permissions: `closing.*` · Route prefix: `/closing` · Nav order: 30

> Read `docs/MODULES.md` first. The calculation rules are **already written** in `docs/BUSINESS_RULES.md` §3–7 and the table design in `docs/DATABASE_DESIGN.md` ("closing"). This brief does not repeat them; it tells the session how to build them and what is new.

## 1. Scope

**Closing is for staff.** A cashier closes a shift, counts cash, records credit, deposits and other items, and submits. The owner reviews.

In scope:

- Shift closing (Night → Morning → Evening, plus Handover slots) and Final closing
- Carry-forward between slots
- Cash counts (till and vault), strips, HS rows, MEDIQ orders, misc charges, deposits
- Credit entries (named accounts, tier slots, free-label rows)
- Responsible closing person, submit gate, corrections by revision
- Credit Ledger and Misc/Ongoing Ledger views
- Closing Book (flip-through, multi-page PDF), Register Book, CC / Returns-Book-Deposit / MEDIQ history tabs
- Closing settings (strips, credit accounts, the 31 inventory-audit codes, per-customer charge, till float)
- Owner alert on submit (through Foundation F4, ntfy)
- **Credit feed for Manager** (`closing_credit_feed`, MODULES.md §8.2)

Out of scope: salary, staff credit ledgers, petty cash (Manager); stock data (Inventory); Android widgets (later); Google Drive backup (Dua's own backup plan); the old sync engine, PIN login and PWA cache.

## 2. Old-app source

- Closing repo: `js/actions.js` (`calc()`, ledger lifecycle), `js/state.js` (constants, shift order), `js/ledger-engine.js`, `js/ledger-nav.js` (guided flow), `js/closing-book.js`, `js/cc-history.js`, `js/rbd-history.js`, `js/mediq-history.js`, `js/inventory-audit.js`, `js/pages.js`, `js/components.js`, `SCHEMA.md`, `tests/`.
- BT-Sale-Data2 `js/closing/` (closing summaries, bridge) for context only.

## 3. Rules

**The formulas are in `BUSINESS_RULES.md` §3–7. Re-read them and the old `calc()` before coding.** Additional points for this build:

| # | Rule | Tag |
|---|---|---|
| C1 | Shift order is **Night → Morning → Evening**; Night starts the day. Never assume Morning-first | KEEP |
| C2 | A closing belongs to its slot's date, not the typing time. Business day cutoff 00:00 Asia/Karachi | KEEP |
| C3 | Submit requires: responsible person chosen; inventory audit card synced and verified; saved; online. **Checked inside the database** (`closing_submit`), never by the browser or by a notification | IMPROVE |
| C4 | A failed owner notification must **never block** a submit; it is recorded and shown (MODULES.md §6.4) | IMPROVE |
| C5 | Submitted closings are locked; corrections create a new revision with a mandatory reason, original kept (D-12) | KEEP |
| C6 | Struck-through (deleted) rows are excluded from totals and carry-forward but kept for audit | KEEP |
| C7 | Each shift stores **its own** variance (net cash − net sale); cumulative figures are derived (old data once saved a cumulative figure by mistake) | IMPROVE |
| C8 | Misc charges get a **stable charge id** so aging does not depend on label text | IMPROVE |
| C9 | **Credit lines must be per-shift new amounts, never carried balances.** The Credit Ledger shows running totals, but the Manager feed returns only the lines recorded in that shift (named entries, tier slots, free rows, credit adjustment). Confirm in the old `calc()` how each is entered and write the answer here before building the feed | **ASK / verify** |
| C10 | Staff see and edit only their own drafts and submissions; `closing.view_all` sees everyone's; `closing.review` and `closing.correct` are owner/senior tools | KEEP (SECURITY_MODEL) |
| C11 | Cash-count denominations: 5000, 1000, 500, 100, 50, 20, 10, coins/loose (confirm against old `DENOMS`) | KEEP |
| C12 | Old test suites `e2e-handover` and two others **fail in the old repo today.** Do not use them as the reference; use the formulas and invented samples | NOTE |

## 4. Structure

Start from `DATABASE_DESIGN.md` ("closing"): `closing_slots`, `closings`, child tables (`closing_hs_rows`, `closing_strip_lines`, `closing_cash_counts`, `closing_credit_lines`, `closing_deposits`, `closing_mediq_orders`, `closing_misc_rows`, `closing_inventory_audit`), `closing_results`, config tables (`closing_strips`, `closing_credit_accounts`, `closing_audit_items`), and the ledger/book views. Functions: `closing_save_draft`, `closing_submit(key)`, `closing_correct(id, reason, changes)`, `closing_compute()`.

Additions in this brief:

- Every `closing_credit_lines` row has a **stable id** that survives a correction (or a "superseded by" link), because Manager stores it in `mgmt_credit_filings`.
- `closing_credit_feed(p_after timestamptz)`: read-only; requires `credit.view`; returns submitted-closing credit lines (line id, business date, slot, kind, label, amount, revision) and marks lines whose closing was later corrected. It returns lines only, never opening balances.
- **Opening balances instead of import:** an admin-only, logged function to set the first slot's carried values (CC, credit, deposits, cash, misc rows). Without it the first closing would start from zero.
- Settings (till float, per-customer charge, thresholds) come from core `settings`; module-only settings use the `closing.` prefix.

## 5. Permissions

Existing, reserved here: `closing.enter_own`, `closing.view_all`, `closing.review`, `closing.correct`, `closing.settings`. Role presets already give junior/senior `closing.enter_own`. The feed uses core `credit.view` (owner only). New keys only if needed, with owner approval.

## 6. Screens (layout)

Follow the old guided flow and phone conventions (text ≥ 0.8 rem, buttons ≥ 44 px, status never colour-only, safe-area padding).

- `/closing` — start/continue today's slot (Night/Morning/Evening/Handover), list of own recent closings.
- `/closing/ledger/<slot>` — **one section at a time**, with progress bar and jump-nav. Section order: POS → MEDIQ → Shift → HS → Strips → Inventory Audit → Misc → Card → Till → Vault → Credit → Deposit → Audit → Final. End-of-shift summary before submit. Variance shown with ▲ / ▼ / ✓.
- Save status chip: Saved ✓ · Saving… · Offline, draft kept · Failed, tap to retry. Drafts autosave every 3 s on the device; **submit needs a connection** (D-14).
- `/closing/book` — Closing Book (range shortcuts: last 10 closings, last 3/7 days, last month; swipe/keyboard paging; jump to date; PDF export). Owner/senior only.
- `/closing/credit`, `/closing/misc` — Credit Ledger (snapshot history by date, print to a 3" thermal receipt) and Misc/Ongoing Ledger with aging.
- `/closing/history/cc`, `/rbd`, `/mediq` — report tabs (CC is Evening-only).
- `/closing/settings` — strips, credit accounts, tiers, audit codes, thresholds, opening balances (admin).
- `/closing/review` — owner review and corrections (`closing.review` / `closing.correct`).

## 7. Interfaces

- **Consumes:** `inventory_balances(p_codes)` from Inventory (Inventory Audit card; read-only; the card freezes a verified snapshot inside the closing); core `staff` for the responsible person; Foundation F4 `notify_owner(...)`.
- **Provides:** `closing_credit_feed` to Manager.
- **Until F3/F4 exist:** build the audit card and the notification call against stubs in your own tests, and leave a clear TODO.
- **Foundation requests:** PDF export and thermal-print helpers if Sales does not already expose them (MODULES.md §3.3).

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| CLS-1 | Closing records credit; the owner files it in Manager by hand (feed, no auto-matching) | Accepted (owner, 9 Nov 2026) |
| CLS-2 | No import of old closings; opening balances only | Accepted (owner, 9 Nov 2026) |
| CLS-3 | Submit rules checked in the database; notifications never block | Accepted (BUSINESS_RULES §7) |
| CLS-4 | Per-shift credit lines vs running balances (C9) | **Open: verify in old code, then confirm with owner** |
| CLS-5 | Does the 3" thermal receipt print stay in v1? | **Open: ask the owner** |

## 9. Slices

1. **C1** Tables, RLS, `closing_compute()`, DB security tests, and the **parity test** (JS `domain/` vs SQL vs old `calc()` on invented shifts).
2. **C2** Draft + guided ledger screens (POS to Final), autosave, no submit yet.
3. **C3** Submit, responsible person, gate, lock; owner alert through F4.
4. **C4** Carry-forward, handover slots, Final closing, opening balances.
5. **C5** Credit Ledger, Misc Ledger, `closing_credit_feed`.
6. **C6** Closing Book, PDF, history tabs, Register Book.
7. **C7** Review and corrections (`closing_correct`).
8. **C8** Settings screens.
9. **C9** Inventory Audit card (needs Inventory F3).
10. *Later:* Android Closing widgets.

## 10. Handoff

_(empty — the session fills this in at the end)_
