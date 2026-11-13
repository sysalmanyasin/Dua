# Security Model (as built)

## Identity
| Who | Sign-in | Notes |
|---|---|---|
| Owner / manager | email + password + **authenticator code (MFA)** | Without MFA the database grants **no** permission (`has_perm` requires aal2). Created only in the Supabase dashboard, then made owner once. |
| Staff | **username + 6-digit PIN** | Supabase needs an e-mail, so a hidden address `username@staff.dua.invalid` is used. Repeated/sequence PINs are refused. Login runs through the `staff-login` function: 5 wrong PINs lock the account 15 minutes (30 per address). |
| New people | request → owner approves → **one-time setup code** | Codes: 10 characters, hashed with a salt, 5 tries, 24 h, single use. Requests are rate-limited (5 per address per hour, 30 pending) and answer the same whether or not a username exists. |
No public sign-up exists. A disabled person loses access immediately (database check) and cannot refresh a session.

## Authorisation
Roles are **templates**; real access is a set of named permissions with per-person *Allow* / *Deny* (deny wins). `has_perm(key)` is used inside every row-level-security policy and every function, so hiding a menu is only a convenience. The list of 29 permissions is in `docs/ADMIN_GUIDE.md`.

What a **basic staff member** can reach, by design: their own sign-in, the Last Day total (one function that returns only the latest *closed* day), and whatever the owner explicitly grants. They cannot read sales history, targets, credit, salaries or other people's data; the tests prove each of those is refused.

## Database rules
1. RLS on every table; `anon` has no table or function grants; browsers have no direct write access to business tables.
2. Writes go through functions that check the permission, validate, and log. Corrections keep the old version and a reason. The activity log is append-only (a trigger refuses changes, even for the owner of the database).
3. `security definer` functions have a fixed `search_path` and execute only for the roles that need them.
4. Idempotency keys make retried saves safe.
5. Views run with the caller's permissions (`security_invoker`).

## Browser
Strict Content Security Policy (see `index.html`), vendored libraries with recorded hashes, escaped templates, no inline handlers or styles, only the public publishable key in the code, the service-role key only inside Edge Function secrets. Sign-out removes unsent drafts and page hand-offs from the phone.

## Gmail
Google sign-in is used **only to send mail from the owner's own Gmail** (scope `gmail.send`: it cannot read mail). The access token is kept in memory only and never stored. Message headers cannot be injected (line breaks in subjects/addresses are removed; addresses are validated; up to 10 recipients).

## Own-phone (BYOD) controls
The owner can disable any person at once. Check-list drafts on a phone are cleared at sign-out. No sales totals, credit or salary data are cached on a staff phone.

## What is tested to fail
Anonymous reads nothing · a basic staff member cannot read sales history, salaries, credit, targets, monthly or client summaries, or another person's preferences · cannot enter, correct or set targets without the permission · cannot forge the activity log · cannot promote themselves · an owner without MFA has no permissions · disabled and expired logins stop · second use of an idempotency key by another person is refused · the check-list and field functions refuse people without the matching permission. (195 database checks; see `docs/TESTING.md`.)

## Known gaps and accepted risks
| Item | Status |
|---|---|
| **Automatic backups** | **Live since 13 Nov 2026**; first good encrypted Drive backup recorded and checksum verified. Passphrase mode (D-38a). **Still unproven:** restore from an actual Drive backup into a separate real Supabase project (RUNBOOK §6). Local 39/39 restore is not a substitute. |
| Backup credential | The database password is a GitHub environment secret limited to `main`. A leak would allow reading the database. Rotate it by resetting the database password and updating the secret. |
| Public ntfy topic | Anyone who learns the topic can read the pushes (generic text only) or post fake ones. Rotate by changing `NTFY_TOPIC` and re-subscribing. |
| `public.rls_auto_enable()` | **Hardened 13 Nov 2026.** Execute revoked from `PUBLIC` and `anon`; automatic RLS behaviour was checked. `authenticated` still holds execute because of the platform event-trigger constraint; re-check the advisor and platform behaviour before changing it. |
| Leaked-password protection | Off in Supabase Auth (advisor). Dashboard toggle; staff sign in with PINs so exposure is low. |
| Separate production project | Not yet; staging and live share one project. |
| Error monitoring (Sentry) | Not yet. |
| End-to-end browser tests (Playwright) | Not yet; checked in a simulated browser and by the owner by hand. |
| Real-device and real-Google verification of the newest pages | Owner try-out pending. |
| 6-digit PIN | Weaker than a password; mitigated by lockout, rate limits and instant disable. |
| Public repository | Business rules are visible to anyone; no secrets or real figures are in it. |
| Free-plan limits | Storage, egress and a pause after a week of inactivity; the app reads small summaries to stay within them. |
| Staff sign-in shares Supabase's per-address limit | Fine for one shop; a flood of bad attempts could briefly block logins. |
| GitHub tokens pasted in chat | Treated as exposed; **revoke after each session**. |


## Status note (13 Nov 2026)
Manager migrations 0101–0103 and Inventory migrations 0301–0304 are recorded as live in their module progress evidence. Inventory's enhanced source is still on `module/inventory`, not yet integrated into `main`; this creates a source/live parity task, not permission to reapply the migrations. See [PROJECT_STATUS.md](PROJECT_STATUS.md).