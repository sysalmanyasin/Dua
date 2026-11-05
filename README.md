# Dua — Fazal Din's Pharma Plus

One web app, many modules. Plain HTML + JavaScript (ES modules), no build step. Supabase for database, login and server functions. Hosted on GitHub Pages.

- Docs: `docs/` (business rules, decisions, architecture, database design, security model, setup).
- Run locally: `npm ci && npm run serve` → http://localhost:8080 (needs `js/core/config.js` filled in, see `docs/SETUP.md`).
- Check everything: `npm run verify` (lint, format, unit tests, secret scan, vendor hashes) and `npm run test:db` (needs a local Postgres).
- Safety rules: no `innerHTML` (use `html` from `js/shared/html.js`), no secrets in Git, every table has row-level security, all access rules live in the database.

Status: Phase 2 (foundation). See `PROJECT_PROGRESS.md`.
