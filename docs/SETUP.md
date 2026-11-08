# Setup: staging project (do this once, in order)

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
SQL editor → paste `supabase/migrations/0001_core.sql` → Run. (Later migrations: same, in number order.)

## 4. Edge Function secrets (Edge Functions → Secrets)
| Name | Value |
|---|---|
| `ALLOWED_ORIGIN` | exactly your site origin, e.g. `https://sysalmanyasin.github.io` (no trailing slash, no path) |
| `IP_HASH_SECRET` | a long random string (generate one, keep it private) |
| `STAFF_EMAIL_DOMAIN` | optional; default `staff.dua.invalid` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. Never copy the service-role key anywhere else.

## 5. Deploy functions
`supabase functions deploy staff-login request-access claim-account admin-users --no-verify-jwt` (or paste each folder in the dashboard editor, with "Verify JWT" off for all four; they check access themselves).

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
2. Staff tab: "Request access" → request appears for the owner → Approve as Junior → code shown once.
3. Staff: "I have a setup code" → set a 6-digit PIN → sign in → sees Home only (no Users & Access).
4. Try 5 wrong PINs → locked 15 minutes. Disable the user → they cannot sign in, and an open session loses access immediately.
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
