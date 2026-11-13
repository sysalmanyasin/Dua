# Closing — progress

| Date | Slice | Done | Tested | Failed / not done | Next |
|---|---|---|---|---|---|
| 2026-11-09 | C1 maths + tables | `domain/compute.js` (integer paisa); `0201_closing_tables.sql` (15 tables, RLS, lock triggers, `closing_calc`, `closing_compute`, internal `closing_build_input` / `closing_write_result`); shared fixture `tests/fixtures/closing-cases.json` (9 hand-worked cases) | 16 unit tests; 0201 DB tests (formula parity on all 9 cases, build-from-rows parity on case B, read isolation between staff, anon, no direct writes, locked submitted rows, append-only results, one live closing per slot); 3 deliberate breaks caught by the tests; `npm run verify` 226 pass | Period roll-up (`agg`) for **Shift** closings is empty until C4 (exact for Final closings); not tried on a phone (no screens yet) | 0202: slot creation, `closing_save_draft`, `closing_submit`, `closing_correct`, carry-forward |
| 2026-11-10 | C2–C4 database part | `0202_closing_flow.sql`: `closing_save_draft` (creates slot + draft, idempotent on key, strict validation, carry-forward, open misc charges carried with stable ids), `closing_submit` (responsible staff, audit gate, one result, logged, owner notice when F4 exists), `closing_correct` (new revision, original kept, line/charge ids stable, reason logged) | `0202_closing_flow_test.sql`: idempotency, isolation between staff, 10 validation refusals, hand-worked result (grand 54600 / liquid 9600), carry Night→Morning, Evening Final, next-day Night, handover slots, correction, internals not callable; 3 deliberate breaks caught; verify 226 pass | No screens, no `closing_period_agg` (Shift roll-up still empty), no thermal print, no ledgers, no settings RPCs, no audit card, no Manager feed; CLS-6/7/8 need the owner | Register the module and build screens C2 (entry form, JS live preview using `domain/compute.js`), then C5 ledgers/feed |
| 2026-11-11 | Review and plan | Re-read `main` (`e635e23`) and the branch; merged locally (clean); wrote `closing.next-session.md` and the Handoff | merged code: `npm run verify` 258 pass, all database tests pass | nothing built; plan not yet approved by the owner; not pushed (no GitHub access in the session) | owner answers CLS-6…14, then Session A |
| 2026-11-12 | Session A1–A2 | `0203_closing_hardening.sql`: machine refusal codes, CLS-6 no skipped slots, CLS-10 opening closing (admin), draft versions + conflict (CLS-13), carry guard (CLS-12), reopen as draft revision (CLS-7), staff choices (CLS-14), `closing_my_recent`; `0204_closing_period.sql`: `closing_period_agg` ("since last Final" roll-up) feeding `closing_build_input`; fixtures `closing-period-cases.json` (5 hand-worked cases) | 0203 and 0204 DB tests (every refusal code, gaps, versions, carry guard, permissions; roll-up end-to-end + fixtures + Final empty); mutation-tested (breaking CLS-6, CLS-12, CLS-13 and the roll-up each fail the tests); JS reference of the roll-up checked against the same fixtures | Submit screen, ledgers, feed, settings screens, print (later sessions) | A3–A5 |
| 2026-11-12 | Session A3–A5 | Module registered (`manifest.js`, `MODULE_IDS`, `css/closing.css` link). `data/api.js` (only Supabase caller). Start page (continue draft, new closing, admin opening closing). Guided ledger: progress bar, 14-section jump bar, save chip, local copy + server autosave with version, conflict dialog, responsible-staff choice, opening figures panel. Sections 1–5: POS, MEDIQ, Shift (with overrides), HS, Strips. Domain: `errors.js` (every refusal code in plain words), `form.js`, `sections.js`, `slots.js`, `store.js` | 14 page tests (jsdom), form/errors/slots unit tests, form totals checked against `computeClosing`; `npm run verify` 351 pass; all DB tests pass on the tree merged with main | **No Submit button** (by design in Session A). Sections 6–14 show "built next session". Not yet tried on a phone | Owner's phone try-out #1 |
| 2026-11-13 | Session B1–B3 | `ui/sections-late.js`: sections 6–14 (Inventory Audit placeholder + owner switch for the audit requirement, Misc, Card with override, Till and Vault denomination counts, Credit with named / 3 tier slots / aux rows and ± adjustment, Deposits, Final Audit with ▲ Plus / ▼ Less / ✓ Variance, Final aggregation from `closing_period`). Submit: responsible-staff check, flush of the pending save, confirm dialog with the totals, `closing_submit` (idempotent, `already` shown), success screen; refusals in plain words, `carry_changed` reloads the draft. Form model carries counts, misc, deposits, credit lines (stable `charge_id` / `line_id`) | form and page tests (till total, credit/tier/aux rows, submit refused without staff, success screen, refusal toast); `npm run verify` 417 pass. No migration in this session | Owner notice on submit is server side (unchanged). Inventory Audit card itself is Session E: until then every non-opening submit is refused unless an owner switches the requirement off (control is in section 6, needs `settings.manage`). Reserve and pre-date figures are derived from the server preview, not computed from `till_float` in the browser | Owner's phone try-out #2 |
| 2026-11-13 | Session C1–C4 | `0206_closing_ledgers.sql` (read-only; no money rule touched; applied live by hand and registered as `0206`): `closing_credit_feed(p_after)` (needs `credit.view`; lines only; stable `line_id`; `changed_after_first`, `removed`; credit adjustment as a line; opening closing and drafts excluded), `closing_credit_ledger(from, to, limit)` (one stored snapshot per submitted closing), `closing_misc_ledger()` (open / closed charges aged by stable `charge_id`). Pages `/closing/credit` (grouped by date, date range, 3\" thermal receipt via a module-local `ui/print.js`) and `/closing/misc` (oldest first, \"since\" date and days open); links on the start page for people who may see every closing; `domain/ledgers.js` | DB test `0206_closing_ledgers_test.sql` (feed before and after a real correction, `p_after`, struck / opening / draft exclusion, who may call what for cashier, nobody, `closing.view_all`, `credit.view`, anon, read-only check); 6 deliberate DB breaks and 4 JS breaks each caught; 19 new JS tests; `npm run verify` 436 pass; whole DB suite passes; live function bodies hash-identical to the tested ones, anon has no execute, a call with no signed-in user is refused | Not tried on a phone. Carry-forward display, Handover slots and Final-mode screens were already built in Sessions A and B (checked, no change). The opening-balance admin screen is the existing opening closing (CLS-10), so no separate screen. Misc and Credit ledgers are for `closing.view_all` / `closing.review` / `closing.correct` only (a cashier sees only their own closings under C10, so a ledger built from them would mislead); no aging thresholds exist in the rules, so none were invented | Owner's phone try-out #3, then Session D |

## Notes for whoever continues

- The expected figures in `closing-cases.json` were worked out by hand from `BUSINESS_RULES.md` §4–6, not generated from the code. The old `calc()` is DOM-bound, so it could not be run directly; the fixtures are the reference (C12: old suites are not).
- Slot positions: night 10, morning 20, handovers 21–9998 (first one 30), evening 9999 (same idea as the old `getSeq`).
- A submitted closing can only move to `superseded` (trigger `closing_lock_closing`); every child row follows its closing's status (`closing_lock_children`).
- `closing_results` stores the `till_float` and `per_customer_charge` used, so a later settings change never rewrites history.
- The 31 audit codes are not seeded yet (slice C9 seeds them from the old `AUDIT_CODES`; item codes are not sensitive).

## Session A handoff (read before Session B)

### Owner decisions now in the code (CLS-6 to CLS-15 are in `closing.md` §8)
No skipped slots (Final exempt); later submitted closings never change, a correction is made by reopening the original as a draft revision and resubmitting; audit gate on with a logged switch-off; print layout for the PDF; opening closing entered once by admin/owner; any slot may be Final (cash and deposits start at 0, credit/card/open misc carry); stale carry refused at submit; older save refused with a conflict message; any active staff member can be chosen by name.

### Things the owner should confirm (builder's choices, not money rules)
1. The opening closing skips the audit and responsible-staff gates.
2. The opening's own POS figures (System Cash Sales Total, Last Bill Number) matter: the next closing measures its shift sale and customers from them, so the screen asks for them. Typed opening *cash* does not change what the next slot carries (the carry uses Liquid); opening cash comes from the Till/Vault counts (sections 9–10, Session B).
3. A correction to an earlier closing that is not the immediately previous slot changes the roll-up silently at submit (the carry guard covers the four carried figures only; the roll-up is informational).
4. The old app had a "Last Bill Amount" field; Dua has no column for it, so it is omitted rather than invented.

### Foundation requests (not done here; Foundation files are off limits)
- A ledger icon in `js/shared/icons.js` (the module uses 'shield' for now).
- Vendoring JetBrains Mono / Source Serif if the owner wants the original fonts (Inter and IBM Plex Mono are used).
- The toast and dialog styles come from `css/sales.css`; if Sales CSS is ever split, Closing needs its own copy.

### Try-out #1 checklist for the owner (phone)
Submit is not built yet, so the opening cannot be submitted and staff cannot start a shift closing (they will see "The opening closing has not been entered yet", which is the correct refusal). What can be tried now, as admin:
1. Closing → Opening closing → fill sections 1–5 and the four opening figures; the chip should read "Saved ✓".
2. Leave the page and come back through Continue: everything typed is still there.
3. Switch the phone to aeroplane mode, type, see "Offline, draft kept", switch back on, tap the chip.
4. Open the same draft on two phones, change both: the older save is refused with a "changed on another device" message.
5. Typing a wrong number (a letter in an amount) turns the box red and nothing is sent until it is fixed.
Please say if the layout, colours or wording differ from the original Closing app.

### Try-out #2 checklist for the owner (phone)
1. As admin (two-step sign-in): Closing → Opening closing → all 14 sections → Submit. Then in section 6 switch the audit requirement off with a reason (until the Inventory Audit card exists).
2. As a junior: start the Night closing; the carried card, credit, deposits and cash appear in amber. Fill every section, choose the responsible person, Submit.
3. Check Section 13: the reconciliation shows ▲ Plus, ▼ Less or ✓ Variance; red only for Less.
4. Start the next Morning: the values carried from the Night are there.
5. Submit twice quickly or tap Submit again after a bad connection: the second answer is "Already submitted", nothing doubles.

## Session C handoff (read before Session D)

### What the feed returns (Manager can wire it now)
`closing_credit_feed(p_after timestamptz default null)`, needs `credit.view`, columns exactly as in the work order section 7: `line_id, business_date, slot_kind, slot_seq, kind (named|tier|free|adjustment), label, amount, closing_id, revision, submitted_at, changed_after_first, removed, account_id`.
- A line that was live in any submitted or superseded revision is in the feed; `removed` is true when the latest revision no longer has it live (its label and amount are then the last live ones).
- `p_after` filters on the latest revision's `submitted_at`, so a correction re-emits **all** lines of that closing (a superset of the ones it touched). Manager keeps one filing row per `line_id`, so a repeat is harmless.
- The opening closing is excluded on purpose (its credit is a starting balance, not something that happened at the counter). Drafts never appear.

### Owner decisions needed (builder's choices, not money rules)
1. **Who may open the ledgers.** Built for `closing.view_all`, `closing.review` and `closing.correct` (admin has all). A cashier sees only their own closings (C10), so a cashier ledger would be partial. If cashiers should see the whole Credit Ledger, say so: it needs a permission decision, not just a screen.
2. **Aging.** Shown as the date first seen and plain days open, oldest first. The rules define no thresholds (no 7 / 30 day bands), so none were invented. Tell me if the old app had bands you want kept.
3. **The Misc Ledger starts counting from the first date a charge appears in a submitted closing**, which for charges typed on the opening closing is the opening date.

### Try-out #3 checklist for the owner (phone)
1. As admin: Closing start page now has a **Ledgers** card (Credit Ledger, Misc Ledger). As a cashier it must not appear.
2. Credit Ledger: after the Night and Morning closings are submitted, each shows Carried in, the credit lines typed in that shift, any Adjustment, and the Total credit. The total must be the figure the closing screen showed.
3. Use the From / To dates; a later start than end must give a message, not a list.
4. Print receipt: the print preview should show only a narrow receipt (title, date and slot, lines, TOTAL CREDIT). Try your 3-inch printer if you have it, otherwise Save as PDF.
5. Misc Ledger: a charge added in one shift and still open in the next shows its first date and days open; strike it in a later closing and it moves to Closed.
6. Correct an earlier closing (reopen, edit, resubmit): the Credit Ledger shows the corrected revision as "(corrected)" and the original is not listed twice.

### For Session D
Closing Book (print layout and browser Save as PDF per CLS-9, ranges, jump to date), Register Book, CC / RBD / MEDIQ history tabs; then Review and corrections UI; then Settings screens (strips, credit accounts, tiers, thresholds, `till_float` and `per_customer_charge` through a narrow wrapper if Foundation does not provide one). Session E needs `inventory_balances`, which **already exists live** (migration `0301`, applied by the Inventory session; its source file is not on `main` yet).
