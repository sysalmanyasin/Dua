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
| `NTFY_TOPIC` (works like a password), `NOTIFY_DRAIN_SECRET`, `OPS_REPORT_SECRET` | Supabase → Edge Functions → Secrets | Git, chat |
| Vault: `notify_drain_secret` (same value as `NOTIFY_DRAIN_SECRET`), `ops_function_base_url` (a plain `https://…/functions/v1`, no Markdown link), `inventory_sync_secret` | Supabase → Database → Vault | Git, chat |
| GitHub environment `backup`: secrets `SUPABASE_DB_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `OPS_REPORT_SECRET`, and either `BACKUP_PASSPHRASE` (no-computer mode) or the variable `BACKUP_AGE_RECIPIENT` (public key); variable `OPS_FUNCTION_URL` | GitHub → Settings → Environments → backup (restricted to `main`) | Git, chat |
| age **private** key (decrypts backups; key mode only) or the backup **passphrase** | offline, two places (password manager + a second copy). The private key is **never** on GitHub, Supabase or this repo; the passphrase also lives in the GitHub secret. Losing it makes every backup unreadable | Git, chat |
To rotate `IP_HASH_SECRET`, set a new value and save (old lockout history becomes irrelevant). To rotate the publishable key, create a new one in Supabase, update `config.js`, push, then disable the old one.

## 4. Changing the database
1. Write `supabase/migrations/00NN_name.sql` using the **next number in the Sales/Foundation range** (`docs/MODULES.md` §5.1). Never edit an applied migration.
2. Add or extend a SQL test in `supabase/tests/`. Run `bash supabase/tests/run.sh`.
3. Push. If the live registry shows the migration did not apply (check `select version from supabase_migrations.schema_migrations`), apply it **by hand**: run the file's SQL in the SQL editor (or the connected tool's SQL runner), then record it under its repo version:
   `insert into supabase_migrations.schema_migrations (version, name, statements) values ('00NN','name', array['applied by hand from supabase/migrations/00NN_name.sql']);`
   Do **not** use a tool that invents a timestamp version for the file's content; that creates the mismatch described below.
4. Check afterwards: RLS on every table, no `anon` grants, the new function works.

**Resolved (12 Nov 2026, D-35):** the registry now matches the repo (`0001`–`0013`, plus the Inventory session's `0301+`). Details and the exact SQL are in `docs/ops/f6-registry-reconciliation.md`. Keep applying by hand (step 3) until Supabase's automatic apply is confirmed to work on a pushed migration. **Never use a tool that registers a timestamp version** (such as `apply_migration`); that is exactly how D-35 happened.

## 5. Adding a module or page
Copy the pattern of `js/modules/sales/`: `manifest.js`, `domain/`, `data/`, `ui/`; list the module id in `js/modules/index.js`; add its permissions in a migration; write tests; read `docs/MODULES.md` first. Pages that draw bars or positions must set widths from script (the security policy blocks inline styles).

## 6. Backups and restore
**What runs:** `.github/workflows/backup.yml` at 18:00 Pakistan time (13:00 UTC) from `main`. It takes one consistent snapshot, dumps `public`, `auth` and `supabase_migrations` (grants and RLS included), fingerprints the same snapshot, encrypts everything with the **public** age key, uploads to Google Drive (`Dua Backups/daily`, a Sunday copy to `weekly`), verifies size and checksum, then prunes to 30 daily and 12 weekly. Each result is recorded in `backup_log` through `notify-ntfy` and shows on the Tools tab. A failure sends a push; so does 30 hours without a good backup (`ops_check_backups`, 07:00 UTC daily; it starts after the first good backup). Anything saved after 18:00 is covered by the next day's backup.

**One-time setup (needs a computer for step 1 only; the rest works from a phone browser in "desktop site" mode):**
1. **Choose how backups are locked.**
   - *Best (needs a computer once):* make an age key pair with `age-keygen -o dua-backup-key.txt`, keep the file offline in two places, and set the GitHub variable `BACKUP_AGE_RECIPIENT` to the `age1…` public key. The runner can then never read old backups.
   - *Phone-only fallback (what is used while there is no computer):* in your password manager generate a random passphrase of **30+ characters**, save it in **two** places, and set it as the GitHub environment secret `BACKUP_PASSPHRASE`. Leave `BACKUP_AGE_RECIPIENT` unset. Files are named `.tar.gpg` (AES-256, authenticated). Weaker than a key pair because the runner holds the passphrase, which is why the environment is locked to `main`. Lose the passphrase and every backup is unreadable. Restoring needs someone with a computer (`gpg` or `tools/backup/restore-test.sh`), so line one up before you need it.
2. **Google Drive access** (Google Cloud Console → your project): enable the **Google Drive API**; under the consent screen set the app to **In production** (in "Testing" the token dies after 7 days). Open the OAuth client, add the redirect URI `https://developers.google.com/oauthplayground`, and add a client secret (copy it at once). Then open the OAuth Playground → gear → *Use your own OAuth credentials* (client ID + secret) → Step 1: type the scope `https://www.googleapis.com/auth/drive.file` → Authorize with the Gmail that will hold the backups (continue past the "unverified" warning) → Step 2: *Exchange authorization code for tokens* → copy the **Refresh token**.
3. **GitHub:** repo → Settings → Environments → New `backup` → deployment branches: `main` only. Add the secrets and variables listed in §3. `SUPABASE_DB_URL` is the **Session pooler** string (Supabase → Connect), with the database password filled in (GitHub runners cannot use the IPv6-only direct host).
4. Merge the branch to `main`, then Actions → *Daily backup* → *Run workflow* once. Check the Tools tab shows "Last good backup", and that a file appears in Drive → Dua Backups → daily.

**Restore drill (do it after the first good backup, then quarterly; needs a computer):**
1. Download the newest `dua-YYYY-MM-DD.tar.age` (or `.tar.gpg`) from Drive.
2. Make a **separate, empty** target: a spare Supabase project, or a local Postgres (`MODE=local`). The script refuses the live project and any target whose `public` schema is not empty.
3. `MODE=supabase bash tools/backup/restore-test.sh dua-….tar.age dua-backup-key.txt "<target connection string>"` (use `MODE=local` for a plain Postgres). For a `.tar.gpg` file pass `-` instead of the key file and set the passphrase in the environment variable `BACKUP_PASSPHRASE`.
4. It prints `PASS`/`FAIL` per item and `RESTORE VERIFIED` only if every table's row count and content hash, the registry, the users, and the **security shape** (RLS flags, grants, policies, function permissions) match what was backed up. It prints names only, never values.
5. Record a good drill so the Tools tab shows it: `curl -X POST "$OPS_FUNCTION_URL/notify-ntfy" -H "x-ops-secret: $OPS_REPORT_SECRET" -H 'Content-Type: application/json' -d '{"action":"backup_report","kind":"restore_drill","status":"ok","day":"YYYY-MM-DD"}'` (the secret from your own terminal, never pasted into chat).
6. Local result (12 Nov 2026): a real round trip passed 39 of 39 items. The `MODE=supabase` path (auth rows first, then app schemas) and a real Drive upload are **not yet proven**; the first real runs are the test.

**Emergency restore:** same steps into a fresh Supabase project, then point `js/core/config.js` at it, re-create Vault and Edge secrets from the offline secrets list, and re-create the cron jobs by running migrations `0011`, `0012`, `0013` (they skip anything that exists). Vault values are not in a dump.

**If backups stop:** the Tools tab and Needs attention say so. Common causes: Google refresh token revoked (re-do step 2 and replace the secret), database password changed (update `SUPABASE_DB_URL`), GitHub paused scheduled runs after 60 days of repo inactivity (run the workflow once by hand).

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
| 12 Nov | Registry reconciled (D-35); owner alerts went live | planned work | Registry backed up, `0009` renamed, timestamp row removed, `0011`–`0013` applied by hand; cron job untouched |
| 12 Nov | First alert test did not send | the Vault secret `ops_function_base_url` had been pasted as a Markdown link (`[https://…](https://…)`), so the URL was invalid; visible in `cron.job_run_details` as "Bad scheme" | Value corrected to a plain URL; the alert then sent. Always save URLs as plain text |
| 10 Nov | Two sessions changing the same repo | parallel work | Rebased onto the other session's commit; shared contract in `docs/MODULES.md` |
