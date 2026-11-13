# Dua — Fazal Din's Pharma Plus

A modular pharmacy operations web app built with plain HTML and JavaScript ES modules, Supabase (Postgres, Auth and Edge Functions), and GitHub Pages.

**Live application:** https://sysalmanyasin.github.io/Dua/  
**Canonical status:** [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)  
**Repository:** https://github.com/sysalmanyasin/Dua

## Current project status (13 Nov 2026)

| Area | Status |
|---|---|
| Foundation, authentication, permissions and Sales | Integrated; live |
| Manager | Integrated; migrations 0101–0103 applied and checked live; owner phone try-out pending |
| Closing | Integrated; guided ledger is partially implemented; submit, remaining sections and ledgers still pending |
| Candela / Dropbox inventory feed | Base feed live; enhanced feed 0301–0304 and Edge Function v14 are live according to Inventory progress, but their source changes are not yet integrated into `main` |
| Inventory screens and local product copy | In progress on `module/inventory` |
| Daily encrypted backups | Workflow live; first successful Drive backup recorded 13 Nov; real Drive-to-separate-Supabase restore drill still pending |
| STR, Audit Hub, Emergency Billing, unified Reports, assistant and Android widgets | Planned / later phases |

**Important:** a feature can be live in Supabase while its latest source is still on a feature branch. See [Project status](docs/PROJECT_STATUS.md) and [module progress files](docs/modules/).

## Read this first

| If you are… | Read |
|---|---|
| using the app | `docs/USER_GUIDE.md` |
| the owner / administrator | `docs/ADMIN_GUIDE.md` |
| operating or fixing it | `docs/RUNBOOK.md`, `docs/SETUP.md` |
| building a module | `docs/MODULES.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_MODEL.md` |
| checking business rules | `docs/BUSINESS_RULES.md`, `docs/DECISIONS.md` |
| checking test evidence | `docs/TESTING.md` |
| planning work | `docs/PROJECT_STATUS.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `PROJECT_PROGRESS.md` |

## Local development

```sh
npm ci
npm run serve
npm run verify
bash supabase/tests/run.sh
```

The database test script needs a local PostgreSQL instance and `PGUSER`. Never push without the checks passing. Never commit secrets or real staff/business data.
