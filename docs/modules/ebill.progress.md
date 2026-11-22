# Emergency Billing — progress

Updated: 22 November 2026  
Status: integrated on `main`; Phase 6 automated stabilisation/testing documented complete.

## Implemented

- POS with product search, bill calculation, hold/resume and PIN-checked save.
- Staff PINs, discount limits and registered devices.
- Offline billing queue, retry and server sync.
- History, held bills, corrections and manager refunds.
- Partial refunds by item and quantity, with exact fractional money handling.
- Receipt settings and print variants; Search receipt.
- Reports and CSV, Excel and PDF exports with pending/failed invoice warnings.
- Phase 6 money fuzz tests, exact preview/database cross-check, large-catalogue and large-report tests, and real browser print-to-PDF layout inspection.

## Live evidence

The live migration registry contains the Emergency Billing schema and feature migrations through `0642_ebill_receipt_slip`: 0601, 0602, 0610–0612, 0620–0622, 0630–0634 and 0640–0642. Phase 6 test file `0650_ebill_money_fuzz_test.sql` is a test artifact, not a deployed migration.

## Owner actions remaining

1. Grant the intended `ebill.*` permissions to the staff who should use Emergency Billing; current owner/project notes say these grants have not yet been made live.
2. Complete Settings > Receipt with the real shop details/logo and confirm print variants.
3. Run the checklist in `docs/modules/ebill-phase6.md` on the actual Android/Windows devices.
4. Test physical 58 mm and 80 mm printers and confirm browser print dialogs, paper width, clipping and copies.
5. Decide separately whether to add counter-side Return bills and the optional Device Settings panel.

Automated CI passing does not count as owner/device/printer acceptance.
