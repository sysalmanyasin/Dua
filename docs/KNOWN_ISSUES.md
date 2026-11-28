# Known issues and remaining work

**As of:** 27 Nov 2026, commit `07e87e4` plus the Audit 0 branch. Source: `docs/AUDIT_0_BASELINE.md`.
Each item says how it was established. "Reproduced" means I ran it; "Read" means I read the code or config; "Not verified" means I could not check it.

## Defects

| ID | Severity | Issue | Evidence | Status |
|---|---|---|---|---|
| KI-1 | Low | **Closed 28 Nov 2026.** Five `public` functions were executable by the visitor role (`anon`) through the built-in PUBLIC execute right (`invoice_desk_under_thousand`, `invoice_desk_amount_words`, `invoice_desk_validate_amount_words`, `invoice_desk_validate_line_product`, `app_devices_forget_attendance_secret`). None was SECURITY DEFINER and none touched data. Cause: `0001_core.sql:5` revokes default function privileges from PUBLIC, but a schema-level default ACL cannot remove the built-in PUBLIC execute, so a function stays callable unless its own migration revokes it. | Reproduced locally and on the live project (28 Nov). | Fixed by `1004_invoice_desk_revoke_public_execute.sql` and `1405_app_devices_revoke_public_execute.sql`; applied to the live project on 28 Nov and registered as `1004` and `1405`. Live check afterwards: `anon` executes no function, the two helpers remain callable by signed-in people and the service role, all three triggers are enabled. `0999` is now strict (empty allow-list). Rule for new functions: revoke `execute` from `public, anon` in the migration that creates them. |
| KI-2 | Low | An invoice amount below one rupee is spelled with an empty leading word, e.g. `" Pakistani Rupees And Fifty Paisa Only"` (leading space, no rupee word). Browser (`js/modules/invoice-desk/domain/amount-in-words.js`) and database (`invoice_desk_amount_words`, migration 1002) behave the same, so the save guard does not reject it. | Reproduced in both. Marked by `it.fails` in `tests/unit/invoice-desk-known-defects.test.js`. | Open. Fix both together; the wording for sub-rupee amounts is an owner decision. |

## Risks and gaps in the release path

| ID | Issue | Evidence | Needed |
|---|---|---|---|
| KI-3 | "Production" and "staging" are the same Supabase project (`js/core/config.js:3-7`, marked TEMPORARY). The Supabase account lists exactly one project, `DuaPharmaPlus` (PostgreSQL 17.11). | Read; confirmed live 28 Nov. | A separate production project before launch. |
| KI-4 | No workflow deploys the site. GitHub Pages publishes from `main` through GitHub's built-in branch deployment, which starts in parallel with CI and is not gated by it. | Read: `.github/workflows/` has no deploy job; the Actions API lists "pages build and deployment" runs beside each CI run. Branch protection and required checks: **not verified** (needs authentication). | Confirm repository settings; consider a protected `main` with required checks. |
| KI-5 | No real restore from a Drive backup into a separate empty Supabase project has been recorded. The local 39/39 round trip is not a substitute. | Documented in RUNBOOK §6; unchanged. | One recorded drill, then quarterly. |
| KI-6 | `backup.yml:21` only runs when `github.repository == 'sysalmanyasin/Dua'`. Renaming or transferring the repository stops backups silently. | Read; the canonical name was confirmed through the GitHub API. | Update the guard in the same change as any rename. |
| KI-7 | Database tests run on PostgreSQL 16 with a stub `auth` schema; the live project is documented as 17.11 and the backup job uses `pg_dump` 17. | Read. | Run the suite on 17 as well, or record why not. |
| KI-8 | Six development-only npm advisories (3 moderate, 1 high, 2 critical) in the vitest 2.1.9 chain (esbuild dev server, tinypool). `npm audit --omit=dev`: none. | Reproduced. | Upgrade vitest in a separate change. |
| KI-9 | Two retired Edge Functions, `claim-account` and `request-access`, are still deployed and ACTIVE on the live project with `verify_jwt = false` (publicly callable). Their source is not in the repo, so what they do today cannot be reviewed here. `SETUP.md` already says to delete them. | Live function list, 28 Nov. | Review and delete both in the Supabase dashboard (no repo or MCP tool here can delete a function). |
| KI-10 | Live and `main` can differ for a while: on 28 Nov the live registry had `0113` and `1112` before they reached `main` (they arrived within hours). `notify-ntfy` is deployed with `verify_jwt = false` although `supabase/config.toml` does not list it. Whether the deployed function bodies equal the repo files is **not verified** (only version numbers and hashes are visible). | Live registry and function list, 28 Nov. | Add `notify-ntfy` to `config.toml`; compare deployed bodies with the repo when doing the next function deploy. |

## Test gaps (what is not covered today)

- No browser end-to-end tests (Playwright) and no error monitoring (Sentry). Needs a non-production project.
- No coverage measurement before this audit; `npm run test:coverage` now reports it without enforcing a threshold.
- All 8 Edge Function handlers now have tests against fake clients. Not covered: a real Supabase Auth round trip, real Dropbox and ntfy, and Firebase delivery inside `notify-push` (only its secret gate is tested).
- Migrations with no same-numbered database test, after Audit 0 follow-up: `0003` (replaced by `0004`, which is tested), `0005`, `0011`, `0016`, `0207`, `0213`, `0214`, `0215`, `0216`, `0221`, `0223`, `0224`, `0405`, `0413`, `0419`, `0634`, `0704`, `1206`. A trace of the objects each defines shows most are covered by name in later tests or only change data, cron or `search_path`. **Objects no test touches at all:** `closing_refresh_draft` (`0215`), `audit_alert_compiled` and `audit_alert_submitted` (`0413`), `audit_live_balances` (`0419`). Added by Audit 0: `0004`, `0014`, `0212` (also covers `0214` and `0216` book behaviour), `0226`, `0310`, `0505`, `1000`, `1002`.
- Invoice Desk has domain tests and database tests (`1000`-`1003`) but no page tests and no browser end-to-end save/history test.
- Tasks has 3 unit-test files for 7 routes.
- Page tests mock the data layer, so they do not prove the RPC contracts.
- Android: `AttendanceLogicTest` and the APK build run only in GitHub Actions; not run in the audit sandbox.

## Not verified by Audit 0

**Verified live on 28 Nov** (read-only, plus the KI-1 migrations): table, routine, RLS, `search_path` and visitor-role counts; migration registry against the repo files; the list of deployed Edge Functions and their `verify_jwt` flags. **Still not verified:** deployed function bodies, the security and performance advisors, cron jobs, Vault secrets, Auth settings, real-device behaviour, Gmail delivery, Drive uploads, and owner acceptance statements in the older documents. These appear in the docs as "recorded", meaning someone wrote it down, not that it was re-checked.

## Remaining work

See `docs/ROADMAP.md` for the ordered list. Audit 0 adds: resolve KI-2 (KI-1 is closed); trace and close the migration-test gaps above; add handler tests for the two remaining Edge Functions; run the live read-only verification; add browser end-to-end tests once a non-production project exists.
