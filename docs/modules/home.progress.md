# Home 2.0 — implementation progress

> **Current status (21 Nov 2026):** Home 2.0 is integrated on `main`; latest verified CI run #444 and Pages deployment #244 succeeded on commit `18283f1`. It uses existing permission-filtered summaries and adds no migration. Real-device owner acceptance remains.

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

- Home-specific unit coverage exercises navigation helpers, search, daily progress, staff-only summary presentation, favourites and alert-link permissions.
- No Home schema or business-logic migration was added.
- Repository-wide CI run #401 passed app, database and functions jobs on main commit 96694979; Pages deployment #226 succeeded on the same commit.
- Real-device owner acceptance remains outstanding, especially checking layout and permission-filtered shortcuts with different staff permission sets.

The older 19 Nov paragraph was a historical pre-release note and is superseded by the 21 Nov CI result above.

## Operations redesign, Stage 2a (22 Nov 2026; migrations applied live, merged to `main`)

Owner-only additions, shown only when the person holds `ops.view` (admins at the second factor; no role preset carries it):
- **Action Centre** (after the snapshots): issues computed live by `ops_action_items()` from each module's own data and the Owner's rules in `ops_rules`. Priority and area filters; each issue shows priority, responsible person, explanation and an Open link to the module where it is fixed. There is no dismiss button: an issue clears only when its condition clears.
- **Recent Activity** (before Favourites): the latest 10 events from the categories the Owner has switched on (default: closing drafts and closing completed), read through Closing's own feed function. The audit log is never read or changed.
- **Shared refresh** (`js/shared/refresh.js`): loads on open, every 60 seconds while visible, when the tab returns and when the phone is back online; manual Refresh button; shows the last successful update time; keeps the last good data and warns it may be out of date when a refresh fails; stops by itself when the page is replaced.
- Database: `0219` (Closing-owned read functions), `0700` (rules, categories, permissions), `0701` (the two read functions). Procedure and rollback: `docs/ops/f8-stage2-apply-and-rollback.md`.

Not in 2a (still planned): the Staff dashboard variant, Business Intelligence periods (7/30/90 days), Staff & Team Overview (needs Task Master), the compact Dua AI Assistant, real-time updates for important events, Owner screens to edit the rules, and the "full activity history" link.
