# Dua — Fazal Din's Pharma Plus

A modular pharmacy operations web app: plain HTML and JavaScript ES modules (no build step), Supabase (Postgres, Auth, Edge Functions) and GitHub Pages, plus an Android shell (`android-app/`) for attendance, push alerts and a home-screen widget.

**Live site:** https://sysalmanyasin.github.io/Dua/
**Repository:** https://github.com/sysalmanyasin/Dua
**Current status:** [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) (verified 27 Nov 2026, commit `07e87e4`)
**Known issues:** [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)
**What is tested, and what is not:** [docs/TEST_ACCEPTANCE_MATRIX.md](docs/TEST_ACCEPTANCE_MATRIX.md)

## Status in one paragraph

Fifteen modules are on `main` and registered (home, sales, manager, access, tools, closing, inventory, str, candela-sales, ebill, audit, invoice-desk, workspace, tasks, inbox). Their automated checks pass: lint, formatting, unit tests, 141 migrations applied to an empty PostgreSQL 16 with the database security tests, Deno type-checks and handler tests of the 8 Edge Functions, secret and vendor scans. **That is not the same as accepted.** There are no browser end-to-end tests, no real restore of a Drive backup has been recorded, "production" and "staging" are the same Supabase project, and owner/device acceptance is outstanding for most modules. Statements about the live Supabase project in older documents were not re-checked. Do not infer that a feature is live because its code exists.

## Read this first

| If you are... | Read |
|---|---|
| using the app | `docs/USER_GUIDE.md` |
| the owner / administrator | `docs/ADMIN_GUIDE.md` |
| operating or fixing it | `docs/RUNBOOK.md`, `docs/SETUP.md` |
| building a module | `docs/MODULES.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_MODEL.md` |
| checking business rules | `docs/BUSINESS_RULES.md`, `docs/DECISIONS.md` |
| checking test evidence | `docs/TESTING.md`, `docs/TEST_ACCEPTANCE_MATRIX.md`, `docs/AUDIT_0_BASELINE.md` |
| planning work | `docs/PROJECT_STATUS.md`, `docs/KNOWN_ISSUES.md`, `docs/ROADMAP.md` |

Dated files (`PROJECT_PROGRESS.md`, `docs/CHANGELOG.md`, `docs/PROJECT_AUDIT_*`, `docs/modules/*.progress.md`) are history.

## Local development

```sh
npm ci
npm run serve              # http://localhost:8080
npm run verify             # lint, format check, unit tests, secret scan, vendor hashes
npm run test:coverage      # coverage report (measured, not enforced)
bash supabase/tests/run.sh # needs a local PostgreSQL and PGUSER/PGPASSWORD/PGHOST; creates and drops its own database
```

CI (`.github/workflows/ci.yml`) runs the same app checks, the database suite on PostgreSQL 16, Deno type-checks of every Edge Function, and `actionlint`. **CI does not gate deployment:** GitHub Pages publishes from `main` on its own (see `docs/KNOWN_ISSUES.md`, KI-4). Never push without the checks passing. Never commit secrets or real staff or business data.
