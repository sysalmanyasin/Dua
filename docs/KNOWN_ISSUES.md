# Known issues and remaining work

**As of:** 27 Nov 2026, commit `07e87e4` plus the Audit 0 branch. Source: `docs/AUDIT_0_BASELINE.md`.
Each item says how it was established. "Reproduced" means I ran it; "Read" means I read the code or config; "Not verified" means I could not check it.

## Defects

| ID | Severity | Issue | Evidence | Status |
|---|---|---|---|---|
| KI-1 | Low | Five `public` functions are executable by the visitor role (`anon`) through the built-in PUBLIC execute right: `invoice_desk_under_thousand`, `invoice_desk_amount_words` (pure helpers) and trigger functions `invoice_desk_validate_amount_words`, `invoice_desk_validate_line_product`, `app_devices_forget_attendance_secret`. None is SECURITY DEFINER and none reads or writes data. Cause: `0001_core.sql:5` revokes default function privileges from PUBLIC, but a schema-level default ACL cannot remove the built-in PUBLIC execute, so a function stays callable unless its migration revokes it explicitly. | Reproduced on a locally migrated PostgreSQL 16. **Live project: not verified** (Supabase may differ). | Open. Allow-listed in `supabase/tests/0999_global_exposure_test.sql`; a new function that is not revoked now fails that test. Fix is a separate, owner-approved migration (`revoke execute ... from public, anon`); remove the names from the allow-list in the same change. |
| KI-2 | Low | An invoice amount below one rupee is spelled with an empty leading word, e.g. `" Pakistani Rupees And Fifty Paisa Only"` (leading space, no rupee word). Browser (`js/modules/invoice-desk/domain/amount-in-words.js`) and database (`invoice_desk_amount_words`, migration 1002) behave the same, so the save guard does not reject it. | Reproduced in both. Marked by `it.fails` in `tests/unit/invoice-desk-known-defects.test.js`. | Open. Fix both together; the wording for sub-rupee amounts is an owner decision. |

## Risks and gaps in the release path

| ID | Issue | Evidence | Needed |
|---|---|---|---|
| KI-3 | "Production" and "staging" are the same Supabase project (`js/core/config.js:3-7`, marked TEMPORARY). | Read. | A separate production project before launch. |
| KI-4 | No workflow deploys the site. GitHub Pages publishes from `main` through GitHub's built-in branch deployment, which starts in parallel with CI and is not gated by it. | Read: `.github/workflows/` has no deploy job; the Actions API lists "pages build and deployment" runs beside each CI run. Branch protection and required checks: **not verified** (needs authentication). | Confirm repository settings; consider a protected `main` with required checks. |
| KI-5 | No real restore from a Drive backup into a separate empty Supabase project has been recorded. The local 39/39 round trip is not a substitute. | Documented in RUNBOOK §6; unchanged. | One recorded drill, then quarterly. |
| KI-6 | `backup.yml:21` only runs when `github.repository == 'sysalmanyasin/Dua'`. Renaming or transferring the repository stops backups silently. | Read; the canonical name was confirmed through the GitHub API. | Update the guard in the same change as any rename. |
| KI-7 | Database tests run on PostgreSQL 16 with a stub `auth` schema; the live project is documented as 17.11 and the backup job uses `pg_dump` 17. | Read. | Run the suite on 17 as well, or record why not. |
| KI-8 | Six development-only npm advisories (3 moderate, 1 high, 2 critical) in the vitest 2.1.9 chain (esbuild dev server, tinypool). `npm audit --omit=dev`: none. | Reproduced. | Upgrade vitest in a separate change. |

## Test gaps (what is not covered today)

- No browser end-to-end tests (Playwright) and no error monitoring (Sentry). Needs a non-production project.
- No coverage measurement before this audit; `npm run test:coverage` now reports it without enforcing a threshold.
- Edge Functions `sync-inventory-from-dropbox` and `notify-ntfy` have no handler tests; `notify-push` has only its secret gate tested, not delivery.
- Database tests do not exist for these migrations (some may be exercised indirectly by later tests; this has not been traced): 0003, 0004, 0005, 0011, 0016, 0207, 0212, 0213, 0214, 0215, 0216, 0221, 0223, 0224, 0310, 0405, 0413, 0419, 0634, 1000. (0014, 0226, 0505, 1002 were added in Audit 0.)
- Invoice Desk has domain tests only, no page tests and no end-to-end save/history/RLS test.
- Tasks has 3 unit-test files for 7 routes.
- Page tests mock the data layer, so they do not prove the RPC contracts.
- Android: `AttendanceLogicTest` and the APK build run only in GitHub Actions; not run in the audit sandbox.

## Not verified by Audit 0

Everything about the live Supabase project (migration registry, deployed function bodies, advisors, cron jobs, Vault secrets, Auth settings), real-device behaviour, Gmail delivery, Drive uploads, and owner acceptance statements in the older documents. These appear in the docs as "recorded", meaning someone wrote it down, not that it was re-checked.

## Remaining work

See `docs/ROADMAP.md` for the ordered list. Audit 0 adds: resolve KI-1 and KI-2; trace and close the migration-test gaps above; add handler tests for the two remaining Edge Functions; run the live read-only verification; add browser end-to-end tests once a non-production project exists.
