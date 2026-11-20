# Home 2.0 — implementation progress

**Branch:** `main`  
**Scope:** Replace the existing Home page in place. No new module, database migration, business table, or dependency.

## Implemented

- Responsive navy/blue welcome panel with the signed-in person's greeting, branch and Pakistan business date.
- Branded all-time cumulative-sales hero above the snapshot cards. It reads `v_monthly_full` only for `sales.view_history`, includes monthly-only history without double-counting, and totals from April 2020 through the current Pakistan month. A failed history read hides only the hero.
- Business snapshot from the existing `cover_summary()` RPC; the database remains the authority for which sales figures are returned.
- Inventory snapshot from `inventory_cover_summary()`, requested only when the person has `inventory.view`.
- Navigation search is not duplicated on Home; global navigation is the primary route to modules.
- Module exploration moved into the persistent, permission-filtered application navigation.
- Daily progress based only on checklist and sales facts returned by the existing summary.
- Existing attention signals, with action links gated by the permissions needed for their destination.
- Per-device favourites, capped at 12 and revalidated against the current user's accessible routes.
- Home-specific responsive styles, light/dark token support and service-worker precaching.

## Permission and data boundaries

- Home receives the same `modules` list already filtered by `resolveModules()`; it does not import or enumerate other module manifests itself.
- Favourite links are built only from those filtered routes.
- Sales snapshot values are never computed from raw tables in the browser. `cover_summary()` controls sales fields by permission.
- Stock summary is not requested without `inventory.view`.
- Owner notifications are not requested without `notifications.view`; the review shortcut is shown only when both `notifications.view` and `tools.view` are present.
- Missing-sales actions require `sales.enter` or `sales.edit`; checklist links require checklist access.
- No raw `activity_log` query, staff record query, new database permission, or database migration was added.

## Deliberately not fabricated

The current Home data contracts do not provide a permission-safe business activity feed or a verified branch-operational-status signal. Therefore, a Recent Activity feed and an online/open business status indicator are not displayed. Adding those requires an explicit, permission-checked data contract; the Home page must not read the raw audit log or invent status.

Favourites are stored on the current device, not synchronized between devices. Recently visited pages are not yet recorded; this redesign keeps the Home focused on business information rather than module discovery.

## Verification

- Added unit coverage for Home navigation helpers, search, daily progress, staff-only summary presentation, favourites and alert-link permissions.
- No schema or business-logic changes.
- Full `npm run verify`, database suite, browser/device acceptance and final CI result remain to be confirmed after this implementation.


## Main verification update (19 Nov 2026)

The Audit handover records the merged main tree passing `npm run verify` with 1,562/1,562 unit tests and the full local database suite. This is a repository-wide result, not a Home-only test count. Deno and workflow lint were not run locally; inspect a fresh GitHub Actions run. Real-device acceptance of Home 2.0 remains outstanding.
