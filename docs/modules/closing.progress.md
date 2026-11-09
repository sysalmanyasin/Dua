# Closing — progress

| Date | Slice | Done | Tested | Failed / not done | Next |
|---|---|---|---|---|---|
| 2026-11-09 | C1 maths + tables | `domain/compute.js` (integer paisa); `0201_closing_tables.sql` (15 tables, RLS, lock triggers, `closing_calc`, `closing_compute`, internal `closing_build_input` / `closing_write_result`); shared fixture `tests/fixtures/closing-cases.json` (9 hand-worked cases) | 16 unit tests; 0201 DB tests (formula parity on all 9 cases, build-from-rows parity on case B, read isolation between staff, anon, no direct writes, locked submitted rows, append-only results, one live closing per slot); 3 deliberate breaks caught by the tests; `npm run verify` 226 pass | Period roll-up (`agg`) for **Shift** closings is empty until C4 (exact for Final closings); not tried on a phone (no screens yet) | 0202: slot creation, `closing_save_draft`, `closing_submit`, `closing_correct`, carry-forward |
| 2026-11-10 | C2–C4 database part | `0202_closing_flow.sql`: `closing_save_draft` (creates slot + draft, idempotent on key, strict validation, carry-forward, open misc charges carried with stable ids), `closing_submit` (responsible staff, audit gate, one result, logged, owner notice when F4 exists), `closing_correct` (new revision, original kept, line/charge ids stable, reason logged) | `0202_closing_flow_test.sql`: idempotency, isolation between staff, 10 validation refusals, hand-worked result (grand 54600 / liquid 9600), carry Night→Morning, Evening Final, next-day Night, handover slots, correction, internals not callable; 3 deliberate breaks caught; verify 226 pass | No screens, no `closing_period_agg` (Shift roll-up still empty), no thermal print, no ledgers, no settings RPCs, no audit card, no Manager feed; CLS-6/7/8 need the owner | Register the module and build screens C2 (entry form, JS live preview using `domain/compute.js`), then C5 ledgers/feed |

## Notes for whoever continues

- The expected figures in `closing-cases.json` were worked out by hand from `BUSINESS_RULES.md` §4–6, not generated from the code. The old `calc()` is DOM-bound, so it could not be run directly; the fixtures are the reference (C12: old suites are not).
- Slot positions: night 10, morning 20, handovers 21–9998 (first one 30), evening 9999 (same idea as the old `getSeq`).
- A submitted closing can only move to `superseded` (trigger `closing_lock_closing`); every child row follows its closing's status (`closing_lock_children`).
- `closing_results` stores the `till_float` and `per_customer_charge` used, so a later settings change never rewrites history.
- The 31 audit codes are not seeded yet (slice C9 seeds them from the old `AUDIT_CODES`; item codes are not sensitive).
