# Project status — canonical snapshot

**Snapshot date:** 13 November 2026  
**Repository:** [sysalmanyasin/Dua](https://github.com/sysalmanyasin/Dua)  
**Live application:** https://sysalmanyasin.github.io/Dua/  
**Supabase project:** DuaPharmaPlus (`sdsynzsflubdxnelgthh`)

This file is the current status summary. Older dated entries in `PROJECT_PROGRESS.md` and `docs/CHANGELOG.md` are historical snapshots, not statements of today's status. When status differs, use this file plus the module's latest progress file.

## Status vocabulary

- **Integrated** — implementation is present on `main`.
- **Live** — migration/function or operational change has been applied to the named Supabase project and checked, as recorded by the responsible session.
- **In progress** — some implementation exists, but the module or slice is incomplete.
- **Pending** — not yet implemented, not yet integrated, or awaiting owner action; the exact blocker is stated.

## Module status

| Area | Repository status | Live status | Remaining work |
|---|---|---|---|
| Foundation / authentication / permissions | Integrated | Live and owner-accepted | Operational hardening and separate production environment remain |
| Sales | Integrated; core pages, reports, targets, fields, Cover and Gmail-send flow are implemented | Sales migrations and imported history are live | Owner's full real-device try-out; Google Cloud origin / real Gmail send verification; remaining dependent features below |
| Manager | Integrated on `main`; staff registry and staff-credit screens are implemented | Migrations 0101–0103 applied and checked on 13 Nov | Phone try-out; remaining Manager slices (payslips, petty cash and other planned items) |
| Closing | Integrated on `main`; module shell and partial guided ledger are present | Database work through the documented 020x slices is in the repository; verify exact live registry before further apply | Sections 6–14, submit flow, ledgers/feed, print and remaining screens; owner phone try-out |
| Inventory feed | Base Candela/Dropbox feed is integrated | Feed is live; hourly sync and inventory data were checked | Enhanced changed-row feed/interface migrations 0301–0304 and Edge Function v14 are recorded as applied live by the Inventory session, but their source branch is not yet integrated into `main`; reconcile and merge before treating repository as reproducible |
| Inventory screens / local copy / reports | In progress on `module/inventory` | Feed is live; screen work is not complete | I-B local copy and reorder maths, I-C reports, I-D Home numbers and egress review |
| STR | Specification and decisions recorded in Inventory progress/brief | Existing STR source tables arrive through the feed | Separate STR module (0500–0599) is planned; not complete |
| Audit Hub, Emergency Billing, unified Reports, assistant, Android widgets | Planned | Not live as Dua modules | Future roadmap |

## Operational status

| Capability | Current evidence | Remaining caveat |
|---|---|---|
| GitHub Actions CI | Main workflow runs lint, formatting, unit tests, secret/vendor checks, database tests and workflow lint; Deno checks cover Edge Functions | A green current run should be checked before each release |
| GitHub Pages | Deploys from `main` | UI acceptance on current real devices remains incomplete |
| Daily encrypted backup | Workflow and monitoring are implemented; first good Drive backup was recorded 13 Nov 2026 | A restore drill from an actual Drive backup into a separate real Supabase project is still outstanding |
| Local restore verification | Local round-trip reported 39/39 checks passing | Does not prove the real Drive-to-Supabase restore path |
| Migration registry | D-35 reconciliation was performed; RUNBOOK records repo-numbered migrations | Inventory 0301–0304 are live but absent from main at this snapshot; verify registry and source parity before future applies |
| Owner notifications / Tools tab | Implemented and live according to Foundation close-out | Keep monitoring delivery and retry behaviour |
| Security controls | RLS, permission checks, MFA gate, append-only activity log, secret scanning and hardened functions are implemented | Separate production project, Sentry, Playwright and remaining advisor findings are open |

## Test status

The latest main-branch project progress entry (13 Nov) reports **357 unit/jsdom tests** and a full database suite including Closing, Manager and Inventory. Module progress files contain counts from different branch snapshots (for example Manager's 294 and Closing's 351); do not add those numbers together or present them as one current total. Run the current main CI and `bash supabase/tests/run.sh` to establish the exact reproducible counts before release.

## Branch integration status at this snapshot

- `main` is the documentation and integration baseline.
- `module/closing` and `module/manager` have no commits ahead of main in the checked comparison.
- `module/inventory` is ahead of main and contains the enhanced inventory feed implementation and progress evidence. It must be reviewed and integrated.
- `foundation/inventory-feed`, `docs/session-plans` and `design/inventory-delta-sync` are divergent branches; compare and selectively reconcile rather than blindly merging.
- `foundation/operations-hardening` has no commits ahead of main in the checked comparison.

Branch divergence can change; re-check before merging. A migration being live does not mean its source is already on main.

## Immediate priorities

1. Reconcile and integrate Inventory source (0301–0304, Edge Function v14, tests and progress docs) with current main without re-applying already-live migrations.
2. Confirm a clean CI run and a clean full database test run on the resulting main.
3. Perform a restore drill using a real encrypted Drive backup into a separate empty Supabase project.
4. Complete the owner phone try-outs for Sales, Manager and Closing; verify real Gmail sending.
5. Finish Closing and Inventory screens, then proceed to STR and the later planned modules.
6. Create a separate production Supabase project before launch; complete Playwright, Sentry, accessibility and low-end-device checks.

## Source-of-truth documents

- `PROJECT_PROGRESS.md` — dated project history and milestones.
- `docs/ROADMAP.md` — remaining work, ordered by dependency and risk.
- `docs/TESTING.md` — test scope, evidence and untested areas.
- `docs/SECURITY_MODEL.md` — implemented security controls and accepted risks.
- `docs/RUNBOOK.md` — live operations, migrations, backup and restore procedures.
- `docs/modules/*.progress.md` — module-specific progress and handoffs.

Do not infer that a feature is live merely because a screen, migration file, or plan exists. Confirm the status from the relevant progress record and live checks.
