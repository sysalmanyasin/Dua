**Current status (21 Nov 2026):** Closing's 14-section ledger, submit/reopen, shared drafts/live sync, Credit and Misc ledgers, Manager credit feed, Closing Book/PDF, CC/RBD/MEDIQ history, Review, Settings and Inventory Audit card are integrated on `main`. Live registry confirms 0201–0214 by repo version; `closing_refresh_existing_drafts` and 0216/0217 are timestamp-registered. Migration 0214 exists in the repository and live registry; older notes saying its source was missing are incorrect. Owner phone try-out #5, formal acceptance and the audit-gate decision remain. Earlier session entries below are historical.

Status: **Built; owner acceptance pending** · Owner approval: yes (9 Nov 2026, "go")
Branch history: `module/closing` · Migration range: `0200–0299` · Prefix: `closing_` · Permissions: `closing.*` · Route prefix: `/closing` · Nav order: 30

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
| C9 | **Credit lines are per-shift new amounts, never carried balances** (owner, 9 Nov 2026). The Credit Ledger shows running totals, but the Manager feed returns only the lines recorded in that shift (named entries, tier slots, free rows, credit adjustment). **Checked in the old `calc()`:** the carried balance is a separate input (`out-prev-credit`, taken from the previous slot's total) and the typed lines are separate from it; the old snapshot (`clBuildSnapshot`) stores `lines`, `openingCredit` and `creditAdj` apart. So the feed returns lines only. The credit adjustment is a line too: it keeps a stable `credit_adj_line_id` on `closings` | **Decided** |
| C13 | **Customers charge in the period roll-up.** The old code adds the customer *count* straight into Net Sale and Net Final Sale (it only works because the charge is Rs 1). Dua multiplies by `per_customer_charge` in both places. With the charge at 1 the figures are identical to the old app; the fixture case "I" proves the fractional case | IMPROVE |
| C14 | **Stored variance:** `closing_results.shift_variance` = this shift's own `net_cash − net_sale` in every mode; `final_variance` is filled only in Final mode (= Net Final Cash). The old app saved one absolute value plus a "Plus/Less" label; Dua stores a signed number | IMPROVE |
| C10 | Every regular draft is shared with every user who can enter closings (`closing.enter_own`); they can read, edit and submit it. A submitted closing stays visible only to its author, except through the saved-closings list (0214). The owner (`closing.review` or `closing.correct`) can always save any draft, author or not. Opening and correction drafts stay with their own author (and the owner). `closing.view_all` sees everyone's; `closing.review` and `closing.correct` are owner/senior tools | **Amended (owner, 20 Nov 2026)** (was: staff see and edit only their own drafts) |
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
| CLS-4 | Per-shift credit lines vs running balances (C9) | Accepted (owner, 9 Nov 2026): **new amounts for that shift**; verified in the old code |
| CLS-5 | Does the 3" thermal receipt print stay in v1? | Accepted (owner, 9 Nov 2026): **yes, keep it** (Credit Ledger snapshot print, 3" thermal). Needs a print helper: reuse Sales' `print.js` through a Foundation request, or build a small one inside the module |
| CLS-6 | Skipped slots | **Accepted (owner, 11 Nov 2026):** a slot may not be skipped. Starting or submitting a closing is refused until the slot before it is submitted. Exception: a **Final** closing after a gap carries credit, card and open misc from the last submitted closing and zeroes only cash and deposits (builder's reading of CLS-6 + CLS-11; owner said "your choice") |
| CLS-7 | Correcting an earlier closing | **Accepted (owner, 11 Nov 2026):** later *submitted* closings never change. The owner wants to **reopen the original and edit it**. Built as: "Edit" opens the original's figures as a new draft revision (reason required); on resubmit it replaces the original, which is kept as superseded (D-12, MODULES rule 5 forbid overwriting a submitted row). Later drafts pick up the corrected figures on next save |
| CLS-8 | `closing.require_inventory_audit` ships on | **Accepted (owner, 11 Nov 2026):** keep on in code; may be switched off with a logged reason in Settings during rollout |
| CLS-9 | Closing Book PDF | **Accepted (owner, 11 Nov 2026):** print layout, browser Save as PDF, no new library. Same answer for Manager MGR-11 |
| CLS-10 | Opening balances | **Accepted (owner, 11 Nov 2026):** the first closing is an **opening Final closing** entered by owner/admin, not a separate fake. Cash and deposits **may be typed** for this opening closing only. Carry reads it like any submitted Final |
| CLS-11 | Final | **Accepted (owner, 11 Nov 2026):** any slot may be Final; Final starts cash and deposits at 0, keeps credit, card and open misc |
| CLS-12 | Carried figures changed before submit | **Accepted (owner, 11 Nov 2026):** refuse: "opening figures changed, review and submit again" |
| CLS-13 | Two devices on one draft | **Accepted (owner, 11 Nov 2026):** refuse the older save with a conflict message and reload, like the Daily Check List. **Amended (20 Nov 2026, CLS-16):** that rule now covers the list sections only; single boxes are saved on their own with no version check |
| CLS-14 | Responsible person | **Accepted (owner, 11 Nov 2026):** any active staff member by name, via a small function (juniors read only their own `staff` row) |
| CLS-16 | Live sync between devices | **Accepted (owner, 20 Nov 2026), steps A and B:** a draft updates on every open device without a reload (Supabase Realtime on `closings`, plus a safety-net check every 3 s while the live connection is down and every 15 s while it is up). Single boxes (amounts, returns, books, overrides, responsible person) are saved on their own through `closing_patch_draft` after 0.8 s; last write per box wins, as in a shared sheet. A box typed here and not yet saved, and the box the person is in, are never overwritten by another device. List sections (rows, cash counts, credit, opening figures) are still saved whole with the version check, and are refreshed from other devices only when nothing in them was typed here. Per-row merging of lists is step C, not built |
| CLS-17 | Owner-only mode change (Shift ↔ Final) | **Built on branch `feature/owner-closing-mode-change`, not yet applied live or accepted by the owner (21 Nov 2026).** Only the Owner (an active **admin** profile at MFA level aal2; not `has_perm`, so a senior granted `closing.correct` is not the Owner) may change a closing's type, through `closing_change_mode(closing, new_mode, reason, key)` (migration `0218`). A trigger on `closings` refuses any change of `mode` made any other way, including `closing_save_draft`. A **draft** (also an open revision) changes in place: figures and child rows stay, carried-in figures are re-derived for the new type, `draft_version` goes up. A **submitted** closing is reopened through the existing `closing_reopen` (new draft revision, original stays submitted until the revision is submitted, CLS-7) and the revision gets the new type; the Owner edits and resubmits with the ordinary `closing_submit`. CLS-6 holds: a closing may become Shift only if the slot before it is submitted. The opening is always Final. Each change writes a `closing.mode_changed` row to the activity log (old/new type, Owner, reason, revision, original). Later submitted closings never change (CLS-7) |
| CLS-15 | Look and feel | **Accepted (owner, 11 Nov 2026):** keep the original Closing app's layout, design and colours (teal `#0D8C78`, navy `#0E241F`, amber = carried-forward values, red = deficits only, shift dots Night/Morning/Evening, 14-section guided flow). Scoped in `css/closing.css`; vendored Inter and IBM Plex Mono replace the original's Google fonts |

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

**Read `docs/modules/closing.next-session.md` first: it is the work order (state, owner questions, review gaps, slice plan, payload and function reference, start prompt).**

- Done: pure maths, tables and RLS (`0201`), draft / submit / correct and carry-forward (`0202`), hardening and the owner decisions CLS-6 to CLS-14 (`0203`), the period roll-up (`0204`), trigger grants (`0205`), the credit feed and ledger functions (`0206`). Screens: start page, guided ledger sections 1–14, submit and success screen, Credit Ledger, Misc Ledger. All of `0201`–`0206` are applied to the live project.
- Remaining: the Register Book still has no agreed definition. The Inventory Audit card is implemented (0211); the owner must test it and decide whether to re-enable the requirement. Books, history, review and settings still need owner phone acceptance.
- Read `docs/modules/closing.progress.md` (Session C handoff) for the open owner questions and the try-out checklists.

## Familiar-to-the-old-app additions (branch `feature/closing-familiar-ux`)

- **Strips:** catalogue items show a fixed name and price under their group header; staff type only the quantity. Extra items stay editable.
- **± on every credit row** (named, tier, free), as well as Credit Adjustment.
- **Named credit accounts** can have several entries, each with an optional description. Saved as the label `Account — description`, so no schema change.
- **Submit review:** target, net cash and Plus/Less (up to Rs. 100 fine, up to Rs. 1,000 warning, above that bad), responsible person, sections not opened. If the audit is required and not verified, it jumps to Inv Audit.
- **Previous closing card** under every section, **View all**, **Save as Draft**, select-all on focus.
- **Start page:** month calendar with shift dots, the day's closings, Saved records (Continue / Open / PDF).
- **Read-only saved closing** (`/closing/view`) and PDF / print after Submit, for staff too.
- **Needs migration `0212_closing_own_book.sql`** (read-only RPCs `closing_book_own`, `closing_prev_page`). Without it the previous-closing card, Open and PDF show nothing or an error; everything else works.
- **Historical note:** `0216_closing_prev_page_draft.sql` is already applied live and registered under timestamp version `20261118123221`. Do not reapply it. It fixed the previous-closing card and shift/customer comparisons.
- **Reopening a draft** loads every child table the form reads (cash counts for Till and Draw Cash, credit lines, deposits as well as HS, strips, MEDIQ and misc). `tests/unit/closing-api-select.test.js` fails if one is left out of the query, because the next autosave would replace the saved rows with the blank form.

## Last Bill Amount and Closing-only view
- Migration 0213 adds `closings.last_bill_amt` (typed on the POS section, shown on the printed sheet and the previous-shift card; never used in a calculation). `closing_apply_payload`, `closing_correct` and `closing_reopen` carry it.
- Home is a launcher: one tile per module the person may use (every current and future module, by permission). Someone with a single module lands inside it with no Home link. Inside a module a "‹ Home" link replaces the module tab row; a module with `hub: true` (Closing) shows only "← Closing" on inner pages because its start page lists the rest. The status bar shows on Home only.
- The entry screen has "‹ Back to days", which saves the draft first.
- Migration 0214: every user with closing access may read every submitted closing (start-page list, Open, PDF, previous-shift card). Drafts stay private to their author.

## Shared drafts and live sync (migration 0217, 20 Nov 2026)
- Applied to the live project (DuaPharmaPlus) on 20 Nov 2026 as `0217_closing_shared_drafts_live`. It changes: the `closings_read` policy, `closing_can_edit`, `closing_compute`, `closing_period`, `closing_prev_page`, `closing_audit_verify`, `closing_refresh_draft`, `closing_my_recent` (adds `mine` and `staff`); adds `closing_patch_draft`, `closing_is_owner`, `closing_is_shared_draft`; adds `closings` to the `supabase_realtime` publication.
- Client: `data/api.js` (`patchDraft`, `loadSync`, `watchDraft`), `domain/form.js` (`SIMPLE_PATHS`, `patchFields`, `listPayload`, `mergeSimple`, `simpleTexts`), `ui/ledger.js` (dirty tracking per box, the live-sync block), `ui/start.js` (shared drafts listed with a "shared" note). `index.html` CSP now also allows `wss://*.supabase.co`.
- Tests: `tests/unit/closing-sync.test.js`; `supabase/tests/0217_closing_shared_drafts_test.sql` (new) and the privacy assertions in 0201, 0202, 0203 and 0211 changed to the shared rule. The SQL tests were written but not run in a local database; the same checks were run against the live schema inside a rolled-back transaction.
- Not built (step C): per-row saving of list sections, so two people adding rows at the same moment still get the conflict dialog.

## Accessibility conventions (audit of Nov 2026)
- Every input has a name a screen reader can tell apart: a real `<label for>`, or an `aria-label` with the row ("Amount, row 2"; a fixed strip uses its item name). A text span, not a `<label>`, is used where nothing is being labelled.
- A page that is drawn again keeps keyboard focus on the same control (`keepFocus` in `ui/parts.js`); a new section, the success screen and filtered lists move focus to their heading or summary line (`focusHeading`).
- The save chip is a real button inside a live region; it is enabled only when there is something to retry. Errors are `role="alert"`; the fields to fix are named in `#cls-errors`, never by a red border alone.
- Calendar days say their date, which closings are saved, whether a draft is open and whether it is today; the next-month button stops at the current month.
- Colours: teal and amber text/backgrounds are at least 4.5:1 (`--cls-teal-text` for text on the dark theme); the evening dot is at least 3:1.
- Do not put `"` inside an interpolated attribute string in `html```...```: it is escaped. Write `aria-current="${cond ? 'date' : 'false'}"`.
- Bill numbers and counts of notes must be whole numbers (`payloadFromForm`); coins / loose change may have paisa.

## Owner-only mode change (migration 0218, branch `feature/owner-closing-mode-change`)
- **Not applied to the live project.** Apply `0218_closing_mode_change.sql` only after review; it adds `closing_is_admin_owner()` (internal), `closing_mode_guard()` + trigger `closings_mode_guard`, and `closing_change_mode(uuid, text, text, uuid)` (signed-in callable; checks the Owner itself). It changes no existing function, table or policy.
- Screens: Review → **Change to Final / Shift** (Owner only, submitted closings; makes the revision and opens it in the ledger); ledger title bar → **Type: Shift / Final** (Owner only, drafts and open revisions). Another open device follows a change through the live-sync read (`mode` is now in `SYNC_SELECT`).
- Tests: `supabase/tests/0218_closing_mode_change_test.sql`, `tests/unit/closing-mode-change.test.js`.
- Direct `UPDATE closings SET mode` by anyone (including maintenance sessions with no signed-in Owner) is refused by the trigger; change a mode only through the function.
