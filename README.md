# Dua — Fazal Din's Pharma Plus

A modular pharmacy operations web app built with plain HTML and JavaScript ES modules, Supabase (Postgres, Auth and Edge Functions), and GitHub Pages.

**Live application:** https://sysalmanyasin.github.io/Dua/  
**Canonical status:** [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)  
**Full module register:** [docs/MODULE_PROGRESS_REGISTER.md](docs/MODULE_PROGRESS_REGISTER.md)  
**Repository:** https://github.com/sysalmanyasin/Dua

## Current project status (21 Nov 2026)

| Area | Status |
|---|---|
| Foundation, Access and Tools | Integrated; authentication/permissions and operational tooling recorded live |
| Home and Sales | Integrated; real-device acceptance and real Gmail send verification remain |
| Manager | Integrated; migrations 0101–0108 recorded live; owner phone acceptance and real Closing inbox check remain |
| Closing | Main UI and ledger/book/review/settings flows built; owner acceptance and migration-registry reconciliation remain |
| Inventory | Feed and six screens integrated/live; real-phone PDF check and sync cleanup remain |
| STR and Candela Sales | Integrated/live; owner phone acceptance remains |
| Audit | A1–C1 integrated/live; phone acceptance, C2 barcode (paused) and hardening remain |
| Emergency Billing | Phases 1–5 built; migrations 0633/0634/0640/0641/0642 live; Phase 6 automated testing done, real-device/printer acceptance and granting `ebill.*` rights remain |
| Invoice Desk | Integrated on main; migrations 1000–1003 recorded live; full test and physical-printer acceptance remain |
| Workspace | Notes integrated on main (editor, sharing, history, search, folders); 1100/1101/1110 recorded live; Sheets database `1102` applied live (21 Nov 2026), Sheets UI not built, no offline sync or attachments yet; Notes accepted by the owner after live testing |
| Unified Reports, assistant and Android | Future work |

The full module-by-module evidence, branch audit (`main` is the only branch) and remaining tasks are in [the Master Module Progress Register](docs/MODULE_PROGRESS_REGISTER.md).

**Important:** “integrated”, “live”, “tested” and “accepted” are different states. Live deployment statements are recorded in module progress files and have not all been freshly rechecked against Supabase during this documentation update. Old progress-file test counts are historical and must not be added together.

## Read this first

| If you are… | Read |
|---|---|
| using the app | `docs/USER_GUIDE.md` |
| the owner / administrator | `docs/ADMIN_GUIDE.md` |
| operating or fixing it | `docs/RUNBOOK.md`, `docs/SETUP.md` |
| building a module | `docs/MODULES.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_MODEL.md` |
| checking business rules | `docs/BUSINESS_RULES.md`, `docs/DECISIONS.md` |
| checking test evidence | `docs/TESTING.md` |
| checking module progress | `docs/MODULE_PROGRESS_REGISTER.md`, `docs/modules/*.progress.md` |
| planning work | `docs/PROJECT_STATUS.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `PROJECT_PROGRESS.md` |

## Local development

```sh
npm ci
npm run serve
npm run verify
bash supabase/tests/run.sh
```

The database test script needs a local PostgreSQL instance and `PGUSER`. Never push without the checks passing. Never commit secrets or real staff/business data.
