# Setup guide: provisioning a fresh staging project

> **Not the current live-project status.** This is a bootstrap procedure for creating a separate staging environment. The existing DuaPharmaPlus project is already live and has migrations, Edge Functions, backup jobs and owner configuration applied. For current live operations, use `docs/RUNBOOK.md` and `docs/PROJECT_STATUS.md`. Do not follow this guide against the live project as if it were empty.

## 1. Create the Supabase staging project
New project, Free plan, name `dua-staging`, region closest to Pakistan. Save the database password in your password manager, not in Git.

## 2. Dashboard settings (Authentication)
- Sign-ups: **disabled** (Providers → Email → turn off "Allow new users to sign up").
- Email: confirmation not needed (staff use hidden addresses; admins are added by you).
- Password minimum length: **6**.
- Multi-factor: **TOTP enabled** (enroll and verify).
- JWT expiry 3600 s; refresh-token rotation on.
- Site URL: your GitHub Pages address for staging.

## 3. Apply the database
Apply **every** file in `supabase/migrations/` in number order (136 files today, `0001` to `1403`), either with the Supabase CLI against the new project or by pasting each file into the SQL editor. Some migrations need extensions and Vault entries that must exist first (`pg_cron`, `pg_net`, and the Vault secrets listed in `docs/RUNBOOK.md` section 3), and a few create scheduled jobs. Apply them to a new, empty project only; never re-apply a migration to a project that already has it. Afterwards check RLS on every table, no `anon` grants and that the new functions work (`docs/RUNBOOK.md` section 4, step 4).

## 4. Edge Function secrets (Edge Functions → Secrets)
| Name | Value |
|---|---|
| `ALLOWED_ORIGIN` | exactly your site origin, e.g. `https://sysalmanyasin.github.io` (no trailing slash, no path) |
| `IP_HASH_SECRET` | a long random string (generate one, keep it private) |
| `PIN_PEPPER` | a long random string, **32 characters or more**. Required: without it staff cannot sign in and the owner cannot create logins. Keep it private and **never change it** once staff have PINs (every 4-digit PIN would stop working). |
| `STAFF_EMAIL_DOMAIN` | optional; default `staff.dua.invalid` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Never copy the service-role key anywhere else.

## 5. Deploy functions
Deploy all seven functions: `staff-login`, `admin-users`, `sync-inventory-from-dropbox`, `notify-ntfy`, `notify-push`, `widget-today`, `attendance-event`. Six of them have "Verify JWT" off (listed in `supabase/config.toml`; each checks its own credential). `notify-ntfy` is not listed there, so confirm its setting in the dashboard. Extra secrets are needed for the notification, inventory and Android functions (`NOTIFY_DRAIN_SECRET`, `OPS_REPORT_SECRET`, `FCM_SERVICE_ACCOUNT`, Dropbox and sync secrets; see `docs/RUNBOOK.md` section 3). If the old `request-access` and `claim-account` functions exist on the project, delete them.

## 6. Create the first owner
1. Authentication → Users → **Add user** → your email + strong password (tick auto-confirm).
2. Copy that user's UUID, then in the SQL editor run:
   `select public.bootstrap_first_admin('<uuid>', 'owner', 'Your Full Name');`
3. This works once; after that it refuses.

## 7. Point the app at it
Edit `js/core/config.js`: put the project URL and the **publishable** (anon) key under `staging`. Commit. Never put the service-role or secret key here; CI blocks it.

## 8. Host
Repo → Settings → Pages → deploy from `main`. For a separate staging site use a second repo or branch whose path contains "staging" (the app picks the staging config from the path or localhost).

## 9. First checks (acceptance for Phase 2)
1. Owner signs in with email + password → is forced to set up the authenticator → then sees Home and Users & Access.
2. Manager → Staff Registry → open a person → Login → choose a username, role and 4-digit PIN → Create login.
3. Staff tab: sign in with that username and PIN → sees Home only (no Users & Access). A PIN like 1234 or 1990 is refused.
4. Try 5 wrong PINs → locked 1 hour; the owner sees "locked" in Users & Access and taps Unlock. Disable the user → they cannot sign in, and an open session loses access immediately.
5. Confirm the hidden address style `username@staff.dua.invalid` was accepted when the first staff was approved. If Supabase rejects it, set `STAFF_EMAIL_DOMAIN` to another domain you do not own mail on and redeploy.

## Private defaults (not in Git)
The check list content is in the migration, but a few values are personal or private and are applied by SQL after the migration (never committed):
- the `prepared_by`, `designation` and `contact` shown on a new day (they carry over from the last saved day after the first save),
- the doctor name in the "Doctor visits" dropdown,
- the competitor names and figures (`checklist_competitor_defaults`).
Use `supabase/seed/private-checklist-defaults.example.sql` as the template, fill in the values, and run it in the SQL editor.

## Gmail sending (Sale Report and Daily Check List)
The app sends from the owner's own Gmail through Google sign-in. It asks only for the "send" permission, so it can never read mail. The Google client ID is in `js/core/config.js` (a client ID is public by design). One-time Google Cloud steps:
1. Google Cloud Console → the project that owns the client → **APIs & Services → Library → Gmail API → Enable**.
2. **OAuth consent screen**: add the scope `https://www.googleapis.com/auth/gmail.send`. If the app is in "Testing", add the sending Gmail address under **Test users**.
3. **Credentials → the OAuth client (Web application)** → **Authorized JavaScript origins** → add `https://sysalmanyasin.github.io` (no path, no trailing slash).
4. In the app press **Send via Gmail**: Google opens a small window the first time to allow sending.
If Google shows "origin_mismatch", step 3 is missing; "access blocked", step 2.
