# Dua Audit 2.0 — landing page and navigation specification

Status: Approved direction; implementation branch `feature/audit-2.0`. **The navigation and landing page are superseded by `audit-tabs.md` (four tabs: Overview, Team Audit, Individual Audit, Tools).**
Owner decisions: role-based dashboard, grouped navigation, complete UI/UX redesign.
Scope: presentation and navigation redesign only. Existing audit business rules and database contracts remain authoritative.

## 1. Goals

Replace the directory-style Audit Hub with a role-aware operational command centre. A signed-in person should see the work they are authorized to do, the most relevant current audit activity, and direct navigation to the appropriate existing workflow.

The redesign is not a rewrite of the Audit engine. It must not change stock snapshots, assignment rules, count events, offline outbox semantics, compile/variance maths, corrections, conflict resolution, immutable final snapshots, expiry locking, barcode ownership, permissions, or activity logging.

## 2. Architectural constraints

- Plain HTML and ES modules; no framework, build step, new runtime dependency, CDN, inline style, or inline event handler.
- UI markup uses `html` and `render()` from `js/shared/html.js`; data access stays exclusively in `js/modules/audit/data/api.js`.
- Domain helpers remain pure and contain no DOM, database, or network calls.
- CSS is scoped under `.aud` in `css/audit.css`; use shared design tokens and preserve light/dark mode.
- Routes remain the existing manifest routes. No router or shell changes are part of this slice.
- Database authorization/RLS remains the security boundary. Hiding a dashboard card or navigation item is not authorization.
- Preserve the module's sign-out guard and manifest outbox registration.
- No migration or database write function is required for the landing-page redesign.

## 3. Role-aware dashboard model

Build dashboard sections from the user's effective permissions, not from the display name of their role template. This respects personal Allow/Deny overrides and delegated permissions.

### Counting access (`audit.count`)
Show "My work" using the existing `audit_my_assignments()` API:
- assignment / engagement name and round number
- state and assignment status
- counted / assigned item totals
- progress percentage only when item count is non-zero
- Continue Counting link to the existing counting route (preserve current selected-assignment handoff if required by the counting page)

Do not expose another counter's assignments, names, counts, or notes.

### Engagement visibility (`audit.view` or `audit.manage`)
Show the engagements returned by `listEngagements()` (RLS remains authoritative), with concise status and scope. Use existing `audit_engagement_overview()` for a bounded number of recent open engagements to show their rounds and lifecycle state. Avoid loading full round item lists or historical reports on the landing page.

Use available facts only. Do not invent a global counted-progress percentage, discrepancy value, near-expiry count, or pending-review count unless an existing authorized read returns the necessary exact data.

### Individual audit access (`audit.individual`)
Show a direct start action and the existing templates route. If the user also has `audit.count`, show personal assignments in the same "My work" section. Since migration 0412 (22 Nov 2026) an Individual Audit compiles itself on submit, so a submitted self-pick shows its result and a **Start another audit** action on the counting screen; the hub needs no change.

### Expiry access (`audit.expiry_log`, `audit.expiry_manage`, or `audit.manage`)
Show the expiry register shortcut; show rack management only to users whose effective permissions allow the route. Do not claim a near-expiry count: the existing `audit_expiry_overview()` returns racks and assignments, not entry totals.

### Barcode access
Show the Barcode Centre shortcut only when the corresponding barcode route is allowed. Do not surface incomplete or unavailable barcode functions as active actions.

### Administration
Show Team & Permissions only when `users.manage` is present. This is the existing owner-only page and must retain its current permission check.

## 4. Grouped navigation

The landing page owns a compact grouped navigation panel because the application shell intentionally hides most module routes when `manifest.hub` is true. Build groups from existing manifest routes and their permission declarations; do not duplicate route permission rules in a second hard-coded authorization system.

Proposed groups:

1. **Stock audits** — Audits, Engagement, Round & assignments, Review & reconciliation, Final snapshot.
2. **My counting** — Counting, Individual Audit, Templates.
3. **Reports** — Reports and audit trail (existing Reports page).
4. **Expiry management** — Expiry register, Rack management.
5. **Barcode centre** — Barcode Centre (only when available and authorized).
6. **Administration** — Team access (requires `users.manage`).

Hidden workflow routes (engagement, round, compile, final, racks) may have explicit display labels/descriptions in the navigation metadata, but their access must still be checked against the corresponding manifest route's `permission` or `anyOf`.

The Overview is the default landing page, not a duplicate item in its own menu.

## 5. Visual and responsive requirements

- Replace the oversized decorative hero and long ungrouped page list with a compact heading, clear primary action, role-relevant work, active audits and grouped navigation.
- Retain Dua's shared typography, tokens, card conventions and Audit crimson accent; do not introduce a competing brand palette.
- Phone-first layout; one-column cards on narrow screens and balanced grids at larger widths.
- Touch targets at least 44px; status labels always include text and never rely on colour alone.
- Support light and dark themes, keyboard focus, semantic headings and accessible labels.
- Avoid charts unless the page has a trustworthy, correctly scoped dataset and a useful decision to support.

## 6. Data loading and performance

- Use existing API functions only for this redesign.
- Fetch only the data relevant to the current user's permissions.
- Keep engagement detail reads bounded (recent open engagements only); use `Promise.allSettled` or equivalent so one inaccessible/failed detail does not blank the whole dashboard.
- Keep personal assignment reads separate from engagement-wide reads.
- Do not query raw audit tables from UI code to bypass the API layer.
- Show clear loading, empty, partial-error and retry states.
- No periodic polling or new realtime subscription is introduced.

## 7. Out of scope

- New database tables, migrations, RPCs, permission keys or role bundles.
- Rewriting audit engagement, round, counting, compile, final, expiry or barcode screens.
- Replacing or changing the IndexedDB outbox, barcode scan queue or sign-out guard.
- Global shell/sidebar/router changes.
- Charts and cross-round financial aggregation.
- Barcode feature completion or changes to its migration.
- Changes to attendance or unrelated modules.

## 8. Acceptance criteria

1. The Overview is visibly and functionally different from the current directory-style hub.
2. Every dashboard section is permission-aware and all links point to existing routes.
3. A counter sees only their own assignments and can resume the existing count workflow.
4. A user without `audit.view` cannot see engagement-wide details.
5. A deputy sees only engagements already returned to them by RLS.
6. Team access is absent without `users.manage`.
7. Expiry and barcode links appear only when their existing routes are permitted.
8. Empty, loading, partial failure and total failure states are understandable.
9. No database schema, business logic, offline queue or final snapshot behavior changes.
10. Existing tests plus new hub/navigation tests pass; `npm run verify` and `bash supabase/tests/run.sh` pass on the handoff commit.
11. Real-device phone acceptance remains explicitly pending until the owner tests the deployed branch.

## 9. Implementation files

Expected initial scope:
- `js/modules/audit/ui/hub.js`
- `css/audit.css`
- `tests/unit/audit-pages.test.js` or a focused new hub test
- This specification and `docs/modules/audit.progress.md`

No changes to shared Foundation files or database migrations are planned.
