# Sales — progress

Updated: 22 November 2026  
Branch: integrated on `main`.

## Implemented source

The Sales manifest registers twelve routes: Dashboard, monthly Index, Add Entry, Sale Report, Sale Book (`/sales/reports`), Targets (`/sales/targets`) and Manage Fields (`/sales/fields`) (the last three routed 26 Nov 2026, D-70), Daily Data, Daily Check List, Diff Report, Cash to Deposit and Last Day. The module source includes the dashboard/Cover flow, target and field configuration, daily sales entry/correction, checklist, history and Gmail-send path. Six Sales-related unit-test files are present in the repository.

## Live / deployment evidence

Core Sales migrations and the one-time historical import are part of the live project baseline. The audited main commit `9669497` passed CI run #401 (app, database and functions jobs) and Pages deployment #226.

## Remaining

- Owner acceptance on the actual pharmacy phone(s), including entry, checklist, reports and permissions.
- Confirm the deployed origin is authorized in Google Cloud and perform one real Gmail send using the intended account.
- Review old-dashboard extras (for example payment/checklist auto-fill) as explicit scope decisions; do not treat every old-app feature as an implicit requirement.

## Verification boundary

A green automated CI run confirms the configured test suites, not real Gmail delivery or real-device usability. See `docs/TESTING.md` and `docs/PROJECT_AUDIT_2026-11-21.md`.
