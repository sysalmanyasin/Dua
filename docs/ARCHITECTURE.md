# Architecture (Phase 1)

## Shape
One static web app (GitHub Pages) + one Supabase project. No build step. Each business area is a **module** loaded on demand.

```
Browser (phone/shop PC)
  index.html → js/core (router, registry, auth, supabase client, logger, outbox)
             → js/modules/<name>/ (lazy-loaded when route opens)
  IndexedDB (Dexie): outbox + cached assignments (closing drafts, audit counts)
        │ HTTPS, publishable key only, user JWT
Supabase: Postgres (RLS on every table) · Auth · Storage · Edge Functions
  Edge: staff-login (lockout), request-access, approve-access, reset-pin, drive-backup
GitHub Actions: lint, tests, migration checks, daily db export → Google Drive
```

## Module contract
Each folder `js/modules/<name>/` has:
- `manifest.js` → `{ id, title, icon, routes[], nav: {section, order}, permissions: [keys needed], enabled }`
- `domain/` pure functions, no DOM, no database. All money maths here. Unit tested.
- `data/` the only place that calls Supabase (table reads via views, writes via RPC).
- `ui/` pages and components. `tests/`.
Rules: modules never read another module's tables; they call its exported functions. The registry hides modules the user lacks permission for **and** the database refuses them anyway. A module can be switched off (settings flag) without breaking others.

## Single source of truth for calculations
Closing and daily-sales maths exist twice by design: JS `domain/` for live preview, SQL function for the saved result. A **parity test suite** feeds identical sample shifts (taken from your real data) to both and to the legacy formulas; build fails if any total differs by even 1 paisa.

## Writes
Critical writes (sale entry, closing submit, transfer, refund, audit submit) are Postgres functions (RPC) in one transaction with an idempotency key (client UUID). Reads use RLS-protected tables/views; sensitive aggregates (e.g. "yesterday's sale") only via functions.

## Offline
- Closing: draft stored locally and autosaved; submit only online (D-14).
- Audit: counts, including barcode scans, queue in an IndexedDB outbox, sent when online, idempotent.
- Outbox holds only the signed-in user's own work; cleared on logout.

## Performance (free-tier aware)
Egress and database size are limited on Free. Pull deltas (`updated_at > last_sync`), paginate, never fetch whole history, cache static lists, lazy-load module JS. Targets: first screen < 2.5 s, navigation < 1 s.

## Data jobs vs app code
One-time jobs (history import) and scheduled jobs (Candela snapshot import, backups) live outside `js/`, in `tools/` and `.github/workflows/`. The app contains only app code.

## Environments
`staging` and `production` Supabase projects; one repo, config chosen by hostname/branch. All schema changes are reviewed migration files; no manual production edits.

## Module build order (owner priority: Sales, Manager/admin, Closing)
Foundation → Sales + Dashboard → Closing → Management (staff, salary, petty cash) → Audit → Inventory/STR (per D-07) → POS (emergency) → Reports → Intelligence → Android widgets.
