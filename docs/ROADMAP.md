# Roadmap — remaining work

**Status snapshot:** 13 November 2026. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the integrated/live/branch distinction. Items below are remaining work, not a list of all planned features.

## P0 — Reconcile live state with Git before more releases

1. **Integrate Inventory's live source changes.** Review `module/inventory` against current `main`; bring in migrations 0301–0304, Edge Function v14, tests and current progress docs. The progress file says these changes are already applied live. Do not re-apply them; verify source hashes, registry versions and deployed function before merging.
2. **Run current main checks** after integration: `npm run verify`, `bash supabase/tests/run.sh`, and confirm the GitHub Actions run is green.
3. **Real backup restore drill.** Download a real encrypted Drive backup and restore into a separate empty Supabase project. The local 39/39 restore test is not a substitute for this.
4. **Owner security housekeeping:** revoke any GitHub token pasted into chat or otherwise exposed; rotate any credential that may have been exposed. Confirm the backup environment secrets are current.

## P1 — Before relying on the app day to day

1. **Real-device acceptance:** owner try-out of the newest Sales, Manager and Closing screens on the actual phones used in the pharmacy; record issues and resolve them.
2. **Gmail verification:** add the deployed origin in Google Cloud, then test actual Gmail sending from the owner's account. The app requests send-only access.
3. **Separate production Supabase project:** staging and live currently share DuaPharmaPlus. Create a separate production project and plan a controlled data/config migration before broader launch.
4. **Operational checks:** confirm scheduled backups continue, owner alerts arrive, and the Tools tab reports backup health.

## P2 — Finish active modules

### Inventory
- I-B: phone-local product copy, feed paging/recovery and reorder maths with shared golden fixtures.
- I-C: Inventory reports/screens (Stock Ledger, Excess, Reorder, Health) and exports.
- I-D: Home summary numbers, permission review and egress review.
- Complete source integration first; the live feed is not the same thing as completed Inventory screens.
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
