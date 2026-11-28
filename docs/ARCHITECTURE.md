# Architecture (as built)

> **Re-verified against the code on 27 Nov 2026 (Audit 0, commit `07e87e4`).** The module registry `js/modules/index.js` lists 15 module ids; each module's `manifest.js` defines its routes. `js/core/config.js` maps both staging and production to the same Supabase project (`sdsynzsflubdxnelgthh`), so those labels are not environment isolation (KI-3). Statements about the live project in this file are recorded, not re-checked. See `docs/AUDIT_0_BASELINE.md`.



One static web app on GitHub Pages plus one Supabase project. No build step: the browser loads the same JavaScript files that are in the repository. `npm` is used only for development tools (lint, tests).

```
Phone / shop PC (browser)
  index.html ─ css/ ─ js/core ─ js/shared ─ js/modules/<name>/        vendor/ (Supabase client, Chart.js, fonts)
      │  HTTPS, publishable key only, the signed-in user's token
      ▼
Supabase project "DuaPharmaPlus"
  Postgres: tables + views + functions, row-level security on everything
  Auth:     owner (email + password + MFA), staff (hidden email + 4-digit PIN)
  Edge Functions (7): staff-login · admin-users · sync-inventory-from-dropbox · notify-ntfy · notify-push · widget-today · attendance-event
      ▲
GitHub: repository → Actions (lint, tests, database tests, function type-checks); Pages publishes the site from `main` separately (not gated by Actions)
Google: only when someone presses "Send via Gmail" (sign-in window + Gmail send)
```

## Layers of the front end
| Folder | Role |
|---|---|
| `index.html` | Page shell and the **Content Security Policy** (scripts only from this site and Google's sign-in file; no inline scripts or styles; connections only to this site, Supabase, Gmail). |
| `js/core/` | `app.js` (start-up, sign-in state), `auth.js`, `screens.js` (sign-in/MFA/request/claim screens), `shell.js` (status bar, header, tabs, page loading), `registry.js` (which modules and pages a person may open), `router.js`, `statusbar.js`, `config.js`, `supabase.js`, `gmail.js`, `prefs.js`, `logger.js` |
| `js/shared/` | `html.js` (escaping templates), `format.js`, `icons.js`, `ui.js` (hero banner), `chartjs.js` (lazy Chart.js), `mailDialog.js` |
| `js/modules/home/` | The Cover |
| `js/modules/access/` | Users & Access |
| `js/modules/sales/` | Dashboard, Index, Add Entry, Daily Data, Sale Report, Daily Check List, Diff Report, Cash to Deposit, Reports, Targets, Fields, Last Day |
| `js/modules/manager/` | Staff Registry, Credit, Salary, Incentive, Petty, Ledgers, Credit Inbox, Attendance and reports (14 routes) |
| `js/modules/closing/` | 14-section closing ledger, shared drafts, ledgers, Book/PDF, history, review and settings (12 routes) |
| `js/modules/inventory/`, `str/`, `candela-sales/`, `ebill/`, `audit/`, `invoice-desk/`, `workspace/`, `tasks/`, `inbox/`, `tools/` | The other registered modules; routes are in each `manifest.js` |
| `css/` | `tokens.css` (the original brand colours, light and dark), `fonts.css`, `base.css`, `components.css`, `sales.css`, `checklist.css` |
| `vendor/` | Third-party code copied into the repo and hash-checked: Supabase client 2.45.4, Chart.js 4.4.7, zxing-wasm 3.1.7 with its `.wasm` (barcode scanning; needs `'wasm-unsafe-eval'` in the CSP), Inter and IBM Plex Mono fonts, and `vendor/workspace/prosemirror-bundle-1.0.0.mjs` (nine ProseMirror packages bundled once for Workspace Notes; recipe and licences beside it). Nothing third-party is fetched at run time except Google's sign-in script when Gmail is used. |
| `supabase/` | `migrations/`, `functions/`, `tests/`, `seed/` (templates only) |
| `tools/` | `check-secrets.mjs`, `check-vendor.mjs`, `import/` (the check-only history importer), `backup/` (encrypted backup and restore verification) |
| `tests/unit/` | front-end tests |
| `docs/` | this documentation; `docs/MODULES.md` is the shared contract for module builders |

## A module
Each folder under `js/modules/<name>/` has `manifest.js` (id, title, icon, status pill, and its pages: path, title, description, who may open it), `domain/` (pure calculations: no screen, no database), `data/` (the only place that calls Supabase), `ui/` (pages), and tests in `tests/unit`. A module never reads another module's tables; the home page and the status bar ask each module through its manifest.

- **Page-level permissions:** a page lists `permission` or `anyOf`; people only get tabs for pages they may open, and a page they may not open is not routable. This is convenience: the database refuses the data regardless.
- **Lazy loading:** a module's page code is downloaded only when its tab is opened. Chart.js loads only on the Dashboard. Google's script loads only when Send via Gmail is pressed.
- **Isolation:** every page is mounted in a fresh container, so one page's handlers cannot run on the next page; a page that crashes shows a message and the app keeps working.

## Data flow for one action (saving a day)
Add Entry page → `domain/entry.js` parses what was typed → `data/api.js` calls `sales_save_day(date, header, lines, reason, key)` → the database function checks the permission, validates, keeps the old version if it is a correction, computes the total with the same rule the screen previewed, writes the day and its lines, logs it, and remembers the key so a retry is harmless → the page reloads the saved day.

## Safety rules that are enforced by tooling
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, `document.write` in app code (ESLint fails the build). All text goes through `html\`...\``, which escapes everything unless wrapped in `raw()`.
- No secrets in Git: `tools/check-secrets.mjs` fails on private keys, GitHub tokens, database URLs with passwords and any JWT that is not the public `anon` key.
- Vendored files must match their recorded SHA-256.
- Because the policy blocks inline styles, widths and positions are set from script (`style.width = …`), never as `style="…"` attributes.

## Inventory data flow
The Candela → Dropbox → Edge Function feed is live and integrated. Every hour the function checks Dropbox's content hash and, only when the file changed, sends it to the database in one request body (`inventory_apply_sync_body`, migration 0307), which compares row hashes and writes only changed rows (migrations 0301–0307, Edge Function v23). Phones read a changed-rows feed into a local copy, never the products table. All six Inventory screens and the Stock row on Home are integrated. See `docs/PROJECT_STATUS.md`, `docs/modules/inventory.md` and `docs/modules/inventory-sync-design.md`.

## Offline behaviour
Several features keep working through a dropped connection by saving to the phone and retrying: the Daily Check List, Emergency Billing (`ebill/data/localDb.js`), Audit counting and barcode (`audit/data/outboxStore.js`, `barcodeStore.js`), the shared outbox (`js/shared/outbox.js`) and the Inventory local copy (`inventory/data/idbStore.js`). The service worker (`sw.js`) serves the app shell offline; it never caches Supabase or Google traffic. Other screens need a connection and say so. Drafts are removed at sign-out. Workspace offline editing is not built.

## Environments
There is **one** Supabase project today, used as staging and as the live site (`production` in `js/core/config.js` points at the same project, marked TEMPORARY). A separate production project is planned before launch.

## Continuous checks (GitHub Actions)
`app` (lint, formatting, unit tests, secret scan, vendor hashes, workflow lint) · `database` (all migrations on an empty PostgreSQL 16, then the security tests) · `functions` (all 7 Edge Functions type-checked with Deno). Also `backup.yml` (daily encrypted backup) and `android-build.yml` (Android shell). **There is no deploy workflow:** GitHub Pages publishes from `main` through its built-in branch deployment, which starts in parallel with CI and is not gated by it (KI-4).
