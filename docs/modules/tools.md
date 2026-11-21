# Tools — module brief

**Purpose:** give the owner a permission-gated operational overview of notifications, encrypted database backups and the Inventory feed.

## Current implementation

- Registered module id: `tools`; route: `/tools`; manifest permission: `tools.view` (owner only).
- The page reads the `tools_overview()` RPC and presents backup freshness/failure state, last restore-drill status, recent backup records, Inventory feed health and recent notifications.
- The owner can acknowledge pending/failed notifications through `notifications_ack`.
- Backup and notification execution is performed by GitHub Actions, Supabase Edge Functions and scheduled database jobs; the Tools page is a monitoring/acknowledgement surface, not a manual restore console.
- The domain helpers classify backup status (30-hour freshness threshold), restore-drill status (100-day reminder), Inventory feed status (3-hour threshold) and notification state.

## Code ownership

- `js/modules/tools/manifest.js`: route and owner permission metadata.
- `js/modules/tools/domain/tools.js`: pure status/age rules.
- `js/modules/tools/data/api.js`: `tools_overview` and `notifications_ack` calls.
- `js/modules/tools/ui/page.js`: operational status and notification page.
- `tests/unit/tools.test.js`: status-rule tests.
- Backup workflow, notification Edge Function, cron/Vault configuration and restore tooling are documented in [RUNBOOK](../RUNBOOK.md).

## Security and operational boundaries

- `tools_overview()` returns no data without the required owner/MFA authorization; the UI must not become a substitute for database authorization.
- Notification delivery secrets and backup credentials remain in GitHub environment secrets, Supabase Edge Function secrets or Vault, never in source or browser code.
- A local restore test and a successful upload checksum do not prove that a real encrypted Drive backup can be restored into a separate Supabase project.

## Remaining work

- Perform and record a real encrypted Drive restore into a separate empty Supabase project.
- Verify restored data counts, migration registry, RLS, grants, policies, users and function permissions.
- Continue monitoring scheduled backup success, alert delivery and Inventory feed health.
- Plan staging/production separation, including recreation and validation of Vault secrets, Edge Functions and cron jobs.

See [Tools progress](tools.progress.md), [Runbook](../RUNBOOK.md) and [Master Module Progress Register](../MODULE_PROGRESS_REGISTER.md).
