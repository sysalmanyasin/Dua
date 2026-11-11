# Runbook (how to operate, fix and change things)

## 1. Where things are
| Thing | Where |
|---|---|
| The app | https://sysalmanyasin.github.io/Dua/ (GitHub Pages, branch `main`, root folder) |
| Code | https://github.com/sysalmanyasin/Dua |
| Database, login, server functions | Supabase project **DuaPharmaPlus** (`sdsynzsflubdxnelgthh`, region ap-south-1, free plan) |
| Gmail sending | Google Cloud client ID in `js/core/config.js` |
| Old apps | `BT-Sale-Data2`, `Closing`, `Random` repos: untouched, still running |

## 2. Deploying
Push to `main`. GitHub Actions runs the checks; if they pass, Pages publishes the site in about a minute. The Supabase GitHub integration is meant to apply new migrations and deploy functions on the same push **but is currently blocked for migrations (see §4)**. Never push a red build: run `npm run verify` and `bash supabase/tests/run.sh` first.

## 3. Secrets and keys
| Secret | Lives in | Never in |
|---|---|---|
| Service-role key | Supabase (Edge Functions get it automatically) | Git, the browser, chat |
| `IP_HASH_SECRET`, `ALLOWED_ORIGIN` | Supabase → Edge Functions → Secrets | Git |
| GitHub token | the person pushing; short-lived, one repo, Contents read/write | the repo, chat (if pasted, revoke) |
| Publishable key and Google client ID | `js/core/config.js` (public by design) | — |
To rotate `IP_HASH_SECRET`, set a new value and save (old lockout history becomes irrelevant). To rotate the publishable key, create a new one in Supabase, update `config.js`, push, then disable the old one.

## 4. Changing the database
1. Write `supabase/migrations/00NN_name.sql` using the **next number in the Sales/Foundation range** (`docs/MODULES.md` §5.1). Never edit an applied migration.
2. Add or extend a SQL test in `supabase/tests/`. Run `bash supabase/tests/run.sh`.
3. Push. If the live registry shows the migration did not apply (check `select version from supabase_migrations.schema_migrations`), apply it **by hand**: run the file's SQL in the SQL editor (or the connected tool's SQL runner), then record it under its repo version:
   `insert into supabase_migrations.schema_migrations (version, name, statements) values ('00NN','name', array['applied by hand from supabase/migrations/00NN_name.sql']);`
   Do **not** use a tool that invents a timestamp version for the file's content; that creates the mismatch described below.
4. Check afterwards: RLS on every table, no `anon` grants, the new function works.

**Open problem (10 Nov 2026):** the inventory feed was applied with timestamp versions (`20261109102531 inventory_feed`, `20261109104257 enable_cron_and_net`) while the repo has `0009_inventory_feed.sql` (without the cron step). Supabase's automatic apply therefore refuses newer-numbered repo files. Fix (needs the Foundation owner): make the registry match the repo — rename the first row to `0009`, and put the cron/net step into a repo file (`0011` or into 0009) before removing the second row. Until then step 3 is the procedure. `0010_manage_fields` was applied this way.

## 5. Adding a module or page
Copy the pattern of `js/modules/sales/`: `manifest.js`, `domain/`, `data/`, `ui/`; list the module id in `js/modules/index.js`; add its permissions in a migration; write tests; read `docs/MODULES.md` first. Pages that draw bars or positions must set widths from script (the security policy blocks inline styles).

## 6. Backups and restore — NOT YET AUTOMATED
**Status: no automatic backup exists.** The free plan keeps no guaranteed copies. Until the daily Google Drive export is built (roadmap item 1), do this by hand **weekly** and before any risky change:
1. From any computer with `pg_dump` and the project's database connection string (Supabase → Project Settings → Database → Connection string; keep the password out of chat and Git): `pg_dump --no-owner --format=custom "<connection string>" -f dua-YYYY-MM-DD.dump`.
2. Store the file somewhere private (encrypted drive). It contains real business data.
3. **Restore test** (do this once, soon): create an empty Supabase project, `pg_restore --no-owner -d "<new connection string>" dua-….dump`, sign in to a copy of the app pointed at it, and confirm the Dashboard totals.
The one-off history source is the old app's backup file `BT_backup_2026-11-05.json` (keep it private; it also holds salaries).

## 7. Local development
`npm ci` · `npm run serve` (http://localhost:8080; `localhost` uses the same Supabase config) · `npm run verify` · `bash supabase/tests/run.sh` (needs `PGUSER` and a running Postgres; the script builds `dua_test` from scratch).

## 8. Troubleshooting
| Symptom | Likely cause | Fix |
|---|---|---|
| Page shows "Not configured" | `config.js` empty | Fill URL and publishable key |
| Staff cannot sign in, "Too many attempts" | 5 wrong PINs | Wait 15 minutes, or clear the person's `login_attempts` rows |
| Staff sign-in fails for everyone | Edge Function secrets missing / `ALLOWED_ORIGIN` wrong | Check Supabase secrets; the value must equal the site origin exactly |
| New page shows an error or "Could not load" for data that exists | A migration did not apply | §4 step 3; compare registry with `supabase/migrations/` |
| Send via Gmail: "origin_mismatch" | Site address not in the Google client's authorized origins | `docs/SETUP.md` Gmail section |
| Send via Gmail: "access blocked" | Sending address not a test user / scope missing | same |
| Charts missing | `vendor/chart-…` blocked or offline | Reload; check the browser console |
| CI red on lint | an unsafe DOM call or unused variable | fix the line; never push red |
| Everything slow / paused | Free project paused after inactivity | Open the Supabase dashboard to resume |

## 9. Incident log
| Date | What happened | Cause | Result |
|---|---|---|---|
| 5 Nov | GitHub refused automated browsing of the old repos' code pages | site rules | Cloned the public repos instead (no token needed) |
| 5 Nov | Sales history import | one-time, token-protected function | 2,379 days; 79/80 months exact; helper removed by migration 0004 |
| 7 Nov | A push went out with a lint error in a test file (red CI for a few minutes) | push was not gated on the checks | Fixed within minutes; pushes are now gated on `npm run verify` |
| 7 Nov | The Cover page would have crashed for everyone | built every card body eagerly | Caught by the test before release |
| 10 Nov | New migrations did not apply automatically | Registry mismatch (§4) | Applied by hand and registered; fix needs the Foundation owner |
| 10 Nov | Two sessions changing the same repo | parallel work | Rebased onto the other session's commit; shared contract in `docs/MODULES.md` |
