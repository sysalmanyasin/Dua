# Dua documentation index

> Current verified snapshot: [Audit 0 baseline, 27 Nov 2026](AUDIT_0_BASELINE.md). The 21/22 Nov audits are historical. Historical session notes remain useful but are not the source of truth for current state.

Start with these documents; dated history is not a substitute for current status.

## Project status and planning

- [Canonical project status](PROJECT_STATUS.md) — current verified snapshot (rewritten in Audit 0).
- [Known issues and remaining work](KNOWN_ISSUES.md) — defects, risks, test gaps, what was not verified.
- [Test acceptance matrix](TEST_ACCEPTANCE_MATRIX.md) — per module: tests, results, missing coverage, acceptance criteria.
- [Audit 0 baseline](AUDIT_0_BASELINE.md) — commands run and results.
- [Master module progress register](MODULE_PROGRESS_REGISTER.md) — all registered modules, non-registered work, branches, evidence and outstanding work.
- [22 Nov 2026 code and live Supabase audit](PROJECT_AUDIT_2026-11-22.md) — historical; live findings not re-checked.
- [21 Nov 2026 repository and live-system audit](PROJECT_AUDIT_2026-11-21.md) — historical snapshot, superseded for current state.
- [Roadmap](ROADMAP.md) — remaining work ordered by risk and dependency.
- [Changelog](CHANGELOG.md) and [project progress history](../PROJECT_PROGRESS.md) — historical milestones; older entries are not current status.

## Building and design

- [Shared module contract](MODULES.md) — required before changing code.
- [Architecture](ARCHITECTURE.md)
- [Database design](DATABASE_DESIGN.md)
- [Security model](SECURITY_MODEL.md)
- [Business rules](BUSINESS_RULES.md)
- [Owner decisions](DECISIONS.md)

## Operations and verification

- [Testing and verification](TESTING.md)
- [Runbook](RUNBOOK.md)
- [Setup](SETUP.md)
- [Admin guide](ADMIN_GUIDE.md)
- [User guide](USER_GUIDE.md)

## Module specifications and progress

Each module has a brief and, where applicable, a `*.progress.md` file under [modules/](modules/). Use the progress file for detailed session evidence and handoff. Use the Master Module Progress Register for the cross-module view.

Workspace has three extra files: [workspace.next-session.md](modules/workspace.next-session.md) (start here), [workspace.design.md](modules/workspace.design.md) (design for the parts not built yet) and [workspace.progress.md](modules/workspace.progress.md) (evidence).

**Status rule:** distinguish source integrated on `main`, migration/function recorded live, tests run, real-device acceptance and owner sign-off. Never collapse them into a single “complete” label.
