# Dua — Fazal Din's Pharma Plus

One web app, many modules, for the pharmacy's sales, daily operations and (planned) closing, audit and inventory. Plain HTML + JavaScript modules (no build step), Supabase for the database, sign-in and server functions, hosted on GitHub Pages.

**Live:** https://sysalmanyasin.github.io/Dua/

## Status (10 Nov 2026)
| Part | State |
|---|---|
| Foundation: sign-in (owner + MFA, staff PIN), roles and per-person permissions, activity log | Done, accepted by the owner |
| **Sales:** Dashboard, Index, Add Entry, Daily Data, Sale Report, Daily Check List, Diff Report, Cash to Deposit, Reports / Sale Book, Targets, Fields, Cover | Built and tested; 2,379 real days imported and checked |
| Send via Gmail | Built; Google Cloud step pending |
| Candela inventory feed | Built in a separate session (`docs/modules/inventory.md`) |
| Manager, Closing, Audit, Inventory screens, Emergency billing | Planned (`docs/MODULES.md`, `docs/ROADMAP.md`) |
| **Automatic backups** | **Not built yet. Highest open risk** |

## Read this first
| If you are… | Read |
|---|---|
| using the app | `docs/USER_GUIDE.md` |
| the owner/administrator | `docs/ADMIN_GUIDE.md` |
| operating or fixing it | `docs/RUNBOOK.md`, `docs/SETUP.md` |
| building a module | `docs/MODULES.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_MODEL.md` |
| checking the rules | `docs/BUSINESS_RULES.md`, `docs/DECISIONS.md` |
| wondering what is verified | `docs/TESTING.md` |
| planning | `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `PROJECT_PROGRESS.md` |

## Working on it
`npm ci` · `npm run serve` · `npm run verify` · `bash supabase/tests/run.sh`. Never push without both checks passing. Never commit secrets or real figures: the secret scan will fail the build.
