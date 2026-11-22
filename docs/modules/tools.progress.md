# Tools — progress

Updated: 22 November 2026  
Status: integrated operations module on `main`.

## Implemented source and operations

The Tools manifest registers the owner-facing operations page for alerts, backup status and feed health. The repository contains the daily encrypted backup workflow, notification/operations functions and restore-test tooling. The live project has the `notify-ntfy` Edge Function active (v12); backup scheduling and monitoring are documented in `docs/RUNBOOK.md`.

## Remaining

- Restore a real encrypted Drive backup into a separate empty Supabase project using the documented restore procedure.
- Record the restore drill result and verify row counts, hashes, migration registry, users, RLS, grants, policies and function permissions.
- Continue monitoring daily backup success and alert delivery; keep the backup environment restricted to `main`.
- Plan a production/staging project split and document how Vault, Edge Function secrets and cron jobs are recreated.

## Verification boundary

The documented local 39/39 restore round trip and upload checksum do not prove a real Drive-to-Supabase restore. That drill remains open.
