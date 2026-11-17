# Home 2.0 — implementation progress

**Branch:** `main`  
**Scope:** Replace the existing Home page in place. No new module, database migration, business table, or dependency.

## Implemented

- Responsive navy/teal welcome panel with the signed-in person's greeting, branch and Pakistan business date.
- Business snapshot from the existing `cover_summary()` RPC; the database remains the authority for which sales figures are returned.
- Inventory snapshot from `inventory_cover_summary()`, requested only when the person has `inventory.view`.
- Universal search across the page routes supplied by the permission-filtered module registry.
- Quick actions derived from accessible create/entry routes.
- Expandable module explorer with page-level shortcuts.
- Daily progress based only on checklist and sales facts returned by the existing summary.
- Existing attention signals, with action links gated by the permissions needed for their destination.
- Per-device favourites, capped at 12 and revalidated against the current user's accessible routes.
- Home-specific responsive styles, light/dark token support and service-worker precaching.

## Permission and data boundaries

- Home receives the same `modules` list already filtered by `resolveModules()`; it does not import or enumerate other module manifests itself.
- Search, quick actions, module cards and favourite links are built only from those filtered routes.
- Sales snapshot values are never computed from raw tables in the browser. `cover_summary()` controls sales fields by permission.
- Stock summary is not requested without `inventory.view`.
- Owner notifications are not requested without `notifications.view`; the review shortcut is shown only when both `notifications.view` and `tools.view` are present.
- Missing-sales actions require `sales.enter` or `sales.edit`; checklist links require checklist access.
- No raw `activity_log` query, staff record query, new database permission, or database migration was added.

## Deliberately not fabricated

The current Home data contracts do not provide a permission-safe business activity feed or a verified branch-operational-status signal. Therefore, a Recent Activity feed and an online/open business status indicator are not displayed. Adding those requires an explicit, permission-checked data contract; the Home page must not read the raw audit log or invent status.

Favourites are stored on the current device, not synchronized between devices. Recently visited pages are not recorded because the existing shell does not expose a page-visit hook and changing the foundation shell is outside this module's approved scope.

## Verification

- Added unit coverage for Home navigation helpers, search, daily progress, staff-only summary presentation, favourites and alert-link permissions.
- No schema or business-logic changes.
- Full `npm run verify`, database suite, browser/device acceptance and final CI result remain to be confirmed after this implementation.
