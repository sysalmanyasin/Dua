# Security Model (as built)

> **Re-verified on 27 Nov 2026 (Audit 0).** Checked on a locally migrated PostgreSQL 16 database built from all 131 migrations: 140 public tables, all with RLS (30 have no policy, so they are closed to browsers); 365 SECURITY DEFINER functions, none without a pinned `search_path`; 8 views, all `security_invoker`; no grant to `anon` on any table, view or sequence; **five non-definer functions are executable by `anon` (KI-1, low severity)**. These are guarded by `supabase/tests/0999_global_exposure_test.sql`. **Statements about the live project below (counts, advisor findings, applied migrations) are recorded from earlier sessions and were not re-checked.** The 22 Nov live figures (124 tables, 283 definer functions) pre-date later migrations and are not comparable with the local count.





## Identity
| Who | Sign-in | Notes |
|---|---|---|
| Owner / manager | email + password + **authenticator code (MFA)** | Without MFA the database grants **no** permission (`has_perm` requires aal2). Created only in the Supabase dashboard, then made owner once. |
| Staff | **username + 4-digit PIN** | Supabase needs an e-mail, so a hidden address `username@staff.dua.invalid` is used. The stored password is derived from the PIN, username and the server secret `PIN_PEPPER` (Auth needs 6+ characters). Repeats, runs, pairs and years are refused. Login runs through the `staff-login` function: 5 wrong PINs lock the account 1 hour (30 per address per hour); the owner can unlock. Older 6-digit PINs still work until reset. |
| New people | owner creates the login from the Staff Registry | No self sign-up. Only `users.manage` (owner, with MFA) can create a login, set a PIN, unlock or disable. The PIN is chosen by the owner, never shown back and never written to the activity log. |
No public sign-up exists. A disabled person loses access immediately (database check) and cannot refresh a session.

## Authorisation
Roles are **templates**; real access is a set of named permissions with per-person *Allow* / *Deny* (deny wins). `has_perm(key)` is used inside every row-level-security policy and every function, so hiding a menu is only a convenience. The live catalog contained 70 permission keys on 21 Nov 2026; see the full catalog in `docs/ADMIN_GUIDE.md`.

What a **basic staff member** can reach, by design: their own sign-in, the Last Day total (one function that returns only the latest *closed* day), and whatever the owner explicitly grants. They cannot read sales history, targets, credit, salaries or other people's data; the tests prove each of those is refused.

## Database rules
1. RLS on every table; `anon` has no table grants and, with five low-risk exceptions (KI-1: two pure helpers and three trigger functions that keep the built-in PUBLIC execute right), no function grants; browsers have no direct write access to business tables.
2. Writes go through functions that check the permission, validate, and log. Corrections keep the old version and a reason. The activity log is append-only (a trigger refuses changes, even for the owner of the database).
3. `security definer` functions have a fixed `search_path` and execute only for the roles that need them.
4. Idempotency keys make retried saves safe.
5. Views run with the caller's permissions (`security_invoker`).
6. Internal functions that only other `security definer` functions call have every execute grant revoked (`public`, `anon`, `authenticated`). Example: `audit_compile_round_core` (0412) lets an Individual Audit compile itself on submit without giving staff the `audit.compile` permission; a test proves a counter gets "permission denied" on it and still cannot compile by hand.

## Browser
Strict Content Security Policy (see `index.html`; it allows `'wasm-unsafe-eval'` for the barcode scanner's WebAssembly reader, Google's sign-in script and frame, and connections to Supabase, Gmail and Google sign-in only), vendored libraries with recorded hashes, escaped templates, no inline handlers or styles, only the public publishable key in the code, the service-role key only inside Edge Function secrets. Sign-out removes unsent drafts and page hand-offs from the phone.

## Gmail
Google sign-in is used **only to send mail from the owner's own Gmail** (scope `gmail.send`: it cannot read mail). The access token is kept in memory only and never stored. Message headers cannot be injected (line breaks in subjects/addresses are removed; addresses are validated; up to 10 recipients).

## Own-phone (BYOD) controls
The owner can disable any person at once. Check-list drafts on a phone are cleared at sign-out. No sales totals, credit or salary data are cached on a staff phone.

## What is tested to fail
Anonymous reads nothing · a basic staff member cannot read sales history, salaries, credit, targets, monthly or client summaries, or another person's preferences · cannot enter, correct or set targets without the permission · cannot forge the activity log · cannot promote themselves · an owner without MFA has no permissions · disabled and expired logins stop · second use of an idempotency key by another person is refused · the check-list and field functions refuse people without the matching permission. (Database suite: 3,000+ checks across 119 files; see `docs/TESTING.md`. The PIN lockout, the owner-only login management and the device-secret endpoints are also covered at handler level in `tests/unit/edge-*.test.js`.)

## Known gaps and accepted risks
| Item | Status |
|---|---|
| **Automatic backups** | **Live since 13 Nov 2026**; first good encrypted Drive backup recorded and checksum verified. Passphrase mode (D-38a). **Still unproven:** restore from an actual Drive backup into a separate real Supabase project (RUNBOOK §6). Local 39/39 restore is not a substitute. |
| Backup credential | The database password is a GitHub environment secret limited to `main`. A leak would allow reading the database. Rotate it by resetting the database password and updating the secret. |
| Public ntfy topic | Anyone who learns the topic can read the pushes (generic text only, except the closing push, which carries the closing's figures, D-62, the closing-correction push, D-63, and the audit-round push, D-64) or post fake ones. Rotate by changing `NTFY_TOPIC` and re-subscribing. |
| `public.rls_auto_enable()` | **Hardened 13 Nov 2026** (execute revoked from `PUBLIC` and `anon`) **and 23 Nov 2026** (migration `0017` also revokes `authenticated`). The earlier note that `authenticated` had to keep execute because of an event-trigger constraint was re-tested: on PostgreSQL 16 an event trigger does not need the DDL-running role to hold execute, and on the live project a probe table created after the change still received row level security (probe table dropped). The owner and `service_role` keep execute. Rollback: `grant execute on function public.rls_auto_enable() to authenticated;`. |
| Leaked-password protection | Off in Supabase Auth (advisor). Dashboard toggle; staff sign in with PINs so exposure is low. |
| Separate production project | Not yet; staging and live share one project (`js/core/config.js:3-7`, KI-3). |
| Deployment is not gated by CI | GitHub Pages publishes from `main` on its own, in parallel with CI (KI-4). Branch protection not verified. |
| Functions callable by the visitor role | Five low-risk functions (KI-1); allow-listed and guarded by `0999`. |
| Edge Function auth surface | `supabase/config.toml` sets `verify_jwt = false` for six functions; each checks its own credential (PIN lockout, `users.manage`, shared secret or per-device secret). `notify-ntfy` is not listed there. Handler tests cover five of the seven. |
| Error monitoring (Sentry) | Not yet. |
| End-to-end browser tests (Playwright) | Not yet; checked in a simulated browser and by the owner by hand. |
| Real-device and real-Google verification of the newest pages | Owner try-out pending. |
| 4-digit PIN | Only 10,000 combinations, weaker than a password. Mitigated by the weak-PIN list, a 1-hour lockout (about 40 days on average to guess one PIN at 5 tries an hour), rate limits and instant disable. Lockout can be abused to lock someone out for an hour; the owner can unlock. `PIN_PEPPER` leaking would remove the extra protection on stored PINs, so keep it private. |
| Public repository | Business rules are visible to anyone; no secrets or real figures are in it. |
| Free-plan limits | Storage, egress and a pause after a week of inactivity; the app reads small summaries to stay within them. |
| Staff sign-in shares Supabase's per-address limit | Fine for one shop; a flood of bad attempts could briefly block logins. |
| GitHub tokens pasted in chat | Treated as exposed; **revoke after each session**. |


## Status note (13 Nov 2026)
Manager migrations 0101–0103 and Inventory migrations 0301–0307 are recorded as live in their module progress evidence and their source is on `main`. Inventory's sync entry points (`inventory_apply_sync` and `inventory_apply_sync_body`) can be run by the service role only; nobody signed in, and no anonymous caller, can write product data. `anon` has no grants on any inventory table. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Candela Sales (14 Nov 2026)
Candela history and customer credit are readable only with `candela.view` (owner, at MFA level 2); no role preset carries it and no staff SELECT exists on the history tables. Staff may be granted `candela.today_total`, which allows one function, `candela_today_total()`, returning today's total (Pakistan date, decided in the database). History tables have no write grants; only security-definer triggers write them. The older landing-table policies still use `sales.view_history` and `credit.view`; if either is ever granted to staff for another reason, those raw rows would be visible to them.

## Dua Workspace (18–19 Nov 2026)
Access is per document, not per module. `workspace_role(document)` returns owner, editor, viewer or nothing and is the single decision used by every policy, function and (later) Storage rule; it returns nothing unless the caller holds `workspace.use` (so disabled, expired and not-yet-MFA admin accounts get nothing at once) and the document is not deleted. There is no admin override. Browsers have SELECT only on Workspace tables; every write is a function with an idempotency key. Sharing, ownership transfer, restore, archive, delete and rename are owner-only and sharing, unsharing, transfer, restore and state changes are written to the activity log. Note content is validated by the database (nodes, marks, link protocols http/https/mailto/tel, ids, size, depth), pasted content is reduced by the editor schema, and nothing is rendered as HTML. The editor library is vendored and hash-checked; it makes no network calls.
**Known gaps:** nothing is cached offline yet, so offline copies and sign-out wiping are future work (Phase 8) and need a Foundation sign-out hook; removing a member does not (yet) purge a copy that person already opened on their own device; Realtime and Storage are not used yet and need the CSP `wss:` question and a Storage test stub; the real-browser Content-Security-Policy behaviour of the editor has been checked only by reading the code and bundle; no break-glass for documents whose owner is disabled has been built (owner decision N-4 approved it for a later step).
