# Architecture (as built)

One static web app on GitHub Pages plus one Supabase project. No build step: the browser loads the same JavaScript files that are in the repository. `npm` is used only for development tools (lint, tests).

```
Phone / shop PC (browser)
  index.html ─ css/ ─ js/core ─ js/shared ─ js/modules/<name>/        vendor/ (Supabase client, Chart.js, fonts)
      │  HTTPS, publishable key only, the signed-in user's token
      ▼
Supabase project "DuaPharmaPlus"
  Postgres: tables + views + functions, row-level security on everything
  Auth:     owner (email + password + MFA), staff (hidden email + 6-digit PIN)
  Edge Functions: staff-login · request-access · claim-account · admin-users · inventory sync · owner notifications / backup reporting
      ▲
GitHub: repository → Actions (lint, tests, database tests, function type-checks) → Pages (the site)
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
| `js/modules/sales/` | Dashboard, Index, Add Entry, Daily Data, Sale Report, Daily Check List, Diff Report, Cash to Deposit, Reports, Targets, Fields, Last Day |\n| `js/modules/manager/` | Staff Registry and Staff Credit (further Manager slices remain planned) |\n| `js/modules/closing/` | Partial guided closing ledger; remaining sections and submit/ledger flows are in progress |
| `css/` | `tokens.css` (the original brand colours, light and dark), `fonts.css`, `base.css`, `components.css`, `sales.css`, `checklist.css` |
| `vendor/` | Third-party code copied into the repo and hash-checked: Supabase client 2.45.4, Chart.js 4.4.7, Inter and IBM Plex Mono fonts. Nothing third-party is fetched at run time except Google's sign-in script when Gmail is used. |
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

## Inventory data flow\nThe base Candela → Dropbox → Edge Function feed is live. The enhanced changed-row feed and interfaces (migrations 0301–0304, Edge Function v14) are recorded as live by the Inventory session, but their source changes remain on `module/inventory` and are not yet integrated into `main` at the 13 Nov 2026 status snapshot. Inventory screens and the phone-local copy are still in progress. See `docs/PROJECT_STATUS.md` and `docs/modules/inventory.progress.md` on that branch.\n\n## Offline behaviour
Only the Daily Check List keeps working through a dropped connection: it saves a copy on the phone and retries. Everything else needs a connection and says so. The copy is removed at sign-out. A general offline queue for closing and audit counting is planned (see the roadmap).

## Environments
There is **one** Supabase project today, used as staging and as the live site (`production` in `js/core/config.js` points at the same project, marked TEMPORARY). A separate production project is planned before launch.

## Continuous checks (GitHub Actions)
`app` (lint, formatting, unit tests, secret scan, vendor hashes, workflow lint) · `database` (all migrations on an empty Postgres, then the security tests) · `functions` (Edge Functions type-checked with Deno). A push to `main` also publishes the site to GitHub Pages.
