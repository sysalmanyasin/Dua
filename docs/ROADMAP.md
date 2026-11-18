# Roadmap — remaining work

**Status snapshot:** 13 November 2026 (Inventory entries updated 17 November 2026). See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the integrated/live/branch distinction. Items below are remaining work, not a list of all planned features.

## P0 — Reconcile live state with Git before more releases

1. **Run current main checks:** `npm run verify`, `bash supabase/tests/run.sh`, and confirm the GitHub Actions run is green.
2. **Real backup restore drill.** Download a real encrypted Drive backup and restore into a separate empty Supabase project. The local 39/39 restore test is not a substitute for this.
3. **Owner security housekeeping:** revoke any GitHub token pasted into chat or otherwise exposed; rotate any credential that may have been exposed. Confirm the backup environment secrets are current.

## P1 — Before relying on the app day to day

1. **Real-device acceptance:** owner try-out of the newest Sales, Manager and Closing screens on the actual phones used in the pharmacy; record issues and resolve them.
2. **Gmail verification:** add the deployed origin in Google Cloud, then test actual Gmail sending from the owner's account. The app requests send-only access.
3. **Separate production Supabase project:** staging and live currently share DuaPharmaPlus. Create a separate production project and plan a controlled data/config migration before broader launch.
4. **Operational checks:** confirm scheduled backups continue, owner alerts arrive, and the Tools tab reports backup health.

## P2 — Finish active modules

### Inventory
- Done and live (17 Nov 2026): phone-local copy, delta feed, Stock Ledger, Reorder, Excess Working, Health, Sync, Home stock row, Excel / PDF / CSV exports.
- Left: real-phone check of the PDF print dialog; remove the old-call fallback in the sync function after a few clean days; check the failed-sync count after a few days at minute 0; consider an owner alert after repeated failed syncs (today the feed watchdog alerts after 3 hours without a success).
- STR is a separate module (route `/str`, migration range 0500–0599) and follows the Inventory interfaces.

### Closing
- Complete guided ledger sections 6–14.
- Implement submit/reopen/correction UX and remaining database/UI integration as specified by the Closing brief.
- Complete ledgers/feed, settings, print/PDF and remaining owner acceptance.
- Closing's current progress file records a partial ledger; it is not a complete Closing product.

### Manager
- Owner phone try-out of Staff Registry and Staff Credit.
- Continue remaining Manager slices: payslips, petty cash and other scope in the Manager brief.
- Confirm sign conventions for Expense, Jazz Cash and Petty before implementing those ledgers.

### Candela Sales
- Owner phone try-out of the four screens and the staff pill; give `candela.today_total` to the staff who should see it.
- Confirm the next hourly sync adds new days to `candela_daily_payments`.
- Ask whether Candela's export can send a customer ID (today only a name arrives; same name is merged).
- Optional: one-time import of days before 11 Nov 2026 if an older source exists.

### Sales
- Real Gmail send verification and owner phone acceptance.
- Payments summary and Daily Check List auto-fill depend on Inventory data/interfaces.
- Credit status pill depends on the credit ledger.
- Bar Race animation, briefing email and other old-dashboard extras remain unported / decision-dependent.

## P3 — Later modules and quality

- STR module, then Audit Hub (including offline counting), Emergency Billing and unified Reports.
- Read-only assistant only after deterministic data interfaces are stable; calculations remain in trusted code/database.
- Android widgets are a later phase, not part of the current web-app completion.
- Playwright end-to-end tests, Sentry error reporting, accessibility review, low-end-phone performance review and broader security review.
- Quarterly restore drills after the first successful real restore.

## Decisions still requiring the owner

- Senior vs Junior permission differences.
- Whether to port Bar Race, briefing email and other dashboard extras.
- Sign conventions for the remaining Manager ledgers (see Manager brief).
- Whether Attendance/geofencing returns in the Android phase.
- Timing and ownership for separate production project cutover.

Do not mark a roadmap item complete because a design or migration file exists. Require integrated code, passing tests and live verification where applicable.
