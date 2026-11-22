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
| Closing | 14-section ledger, shared drafts/live sync, ledgers, Book/PDF, history, review and settings integrated; owner try-out #5 and audit-gate decision remain |
| Inventory | Six screens and feed integrated; live migrations through 0309 and sync Edge Function v24; phone PDF check and sync cleanup remain |
| STR and Candela Sales | Screens and live database workflows integrated; owner phone acceptance and sync monitoring remain |
| Audit | A1–C2 integrated/live, including expiry and barcode; Individual Audit rounds compile themselves on submit (0412, 22 Nov 2026); phone, print/CSV acceptance and hardening remain |
| Emergency Billing | Phases 1–6 automated work integrated; live partial refunds, receipt settings, reports and exports; real-device/printer acceptance and granting `ebill.*` rights remain |
| Invoice Desk | Three business templates, create/history/product screens integrated; migrations 1000–1003 live and registered by repo number; E2E and physical-printer acceptance remain |
| Workspace | Notes integrated on main (editor, sharing, history, search, folders); 1100/1101/1110 recorded live; Sheets database `1102` applied live (21 Nov 2026), Sheets UI not built, no offline sync or attachments yet; Notes accepted by the owner after live testing |
| Unified Reports, assistant and Android | Future work |

The full module-by-module evidence, live migration-registry audit, deployment findings and remaining tasks are in [the Master Module Progress Register](docs/MODULE_PROGRESS_REGISTER.md) and [the 21 Nov code audit](docs/PROJECT_AUDIT_2026-11-21.md).

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
