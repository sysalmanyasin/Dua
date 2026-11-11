# Parallel sessions: coordination plan

Written 11 Nov 2026 from `main` (`e635e23`) and `module/closing` (`3592512`). Maintained by the Foundation session (see `docs/MODULES.md` §3.3).
Three Claude sessions run at the same time. Sessions have no memory (MODULES.md §0.3): this file and the three work orders are what keep them from colliding.

## 1. The three sessions

| # | Session | Branch | Migrations | Prefix | Work order (read this first) | First deliverable |
|---|---|---|---|---|---|---|
| 1 | **Inventory** (feed, interfaces, screens) | `module/inventory` | `0300`–`0399` | `inventory_` | `docs/modules/inventory.next-session.md` | Published interfaces (`inventory_balances` etc.), then the delta feed |
| 2 | **Closing** (shifts, ledgers, books) | `module/closing` (exists) | `0200`–`0299` | `closing_` | `docs/modules/closing.next-session.md` (on that branch) | Hardening migration `0203`, then the first screens |
| 3 | **Manager** (staff and finance, owner only) | `module/manager` (create it) | `0100`–`0199` | `mgmt_` | `docs/modules/manager.next-session.md` | Staff Registry and the credit ledger |

Each session's brief is the **specification**; its work order is the **to-do list**. Where they disagree, the work order is newer and wins, and it says which line of the brief to fix.

## 2. Who waits for whom

```
Inventory I-A (interfaces) ───────────────► Closing Session E (inventory audit card)
Closing Session C (closing_credit_feed) ──► Manager M6 (Credit Inbox)
Everything else is independent and can run today.
```

| Need | Provider | Consumer | Needed by | Until then |
|---|---|---|---|---|
| `inventory_balances(p_codes text[])` | Inventory | Closing | Closing Session E | Closing builds the card against a stub inside its own tests |
| `closing_credit_feed(p_after)` (shape: Closing work order §7) | Closing | Manager | Manager M6 | Manager builds the inbox against a **stub defined inside its own test file** with the same columns |
| `inventory_search`, `inventory_products_for_scope` | Inventory | Audit, STR, Emergency Billing | later modules | nothing blocked today |

Order of delivery that avoids blocking: Inventory session starts with the small interfaces (not the delta rework), so Closing is never waiting on it.

## 3. Rules that keep three sessions from colliding

1. **Own area only.** Each session edits only what MODULES.md §3.1 lists for its module. The three shared one-liners (`js/modules/index.js`, `index.html`, `.github/workflows/ci.yml`) will conflict trivially; keep **both** lines.
2. **Start every session** with `git fetch && git merge origin/main`, then `npm ci && npm run verify` and `bash supabase/tests/run.sh`. Stop and tell the owner if either is red.
3. **Migration numbers stay inside the range** above. Never renumber an applied migration. Name files `<number>_<prefix>_<what>.sql`.
4. **Applying to the live project is a separate, deliberate step** done by one person in range order, following `docs/RUNBOOK.md` §4 (by hand, register under the repo version). Sessions never let a tool invent a timestamp version. Each session lists "ready to apply" migrations in its own progress file; the owner says when.
5. **No pushes without a token.** Either the owner links GitHub in Claude settings, or he commits the files each session lists at the end. A token pasted in chat is treated as exposed: revoke it afterwards.
6. **Public repo:** no real staff names, phone numbers, ID numbers, salaries, credit balances or business amounts in code, seeds, tests, docs or fixtures.
7. **Do not guess money rules.** Ask the owner, in one message at the start of the session. Decisions are written in the module's own brief with its ID prefix (`INV-`, `CLS-`, `MGR-`).
8. **Foundation requests** go under that heading in the module's own brief and are collected in §5 below. Work around them inside the module meanwhile.
9. **A row-level-security tip (new, measured):** write read policies as `using ((select public.has_perm('key')))`, not `using (public.has_perm('key'))`. The bare form runs the check once per row: on 5,858 rows it took about 75 ms against about 2 ms wrapped (local Postgres 16, junior user). Existing policies (24 in `main`) work as they are; new policies on tables that can grow should use the wrapped form.

## 4. Environment facts (so nobody rediscovers them)

| Thing | Value |
|---|---|
| Live project | Supabase **DuaPharmaPlus**, ref `sdsynzsflubdxnelgthh`, region ap-south-1, Free plan (staging and live are the same project, OD-5) |
| Site | https://sysalmanyasin.github.io/Dua/ (GitHub Pages from `main`) |
| Inventory feed | Edge Function `sync-inventory-from-dropbox` (deployed as one inlined file; repo copy imports `_shared`), scheduled hourly by pg_cron job `inventory-hourly-sync`, shared secret in Supabase Vault (`inventory_sync_secret`) and Edge secret `INVENTORY_SYNC_SECRET` |
| Feed secrets (names only) | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `INVENTORY_SYNC_SECRET`, `ALLOWED_ORIGIN`. The Dropbox app is the existing `BT-Randoms` app, with a **new** refresh token, so the old project's sync keeps working |
| Feed data | about 5,858 products (about 2 MB), 4 sales-summary days, 7 credit-by-customer rows, 157 STR headers, 1,847 STR lines (9 Nov 2026) |
| Old projects (still running, do not touch) | `BTpharmacyAudit@2026` (`vtcrdkqhuvxatclobsby`, old inventory sync), `BT SALE DATA` (`wetbugzzchkghpzmowod`, old main app) |
| Claude's Supabase tool | In the chat that wrote this file it was connected to `BT SALE DATA`, **not** Dua. Before any database work, check which project is connected. Never run anything against the old projects |
| Local database for tests | `bash supabase/tests/run.sh` needs a running Postgres and a superuser role for the shell user |

## 5. Foundation backlog (owned by no module; do not do these inside a module session)

| ID | Item | Why now | Status |
|---|---|---|---|
| F4 | `notify_owner(kind, payload)` + `notifications` table + one ntfy sender (MODULES.md §6.4) | Closing submit alert; Inventory sync-failure alert; "Needs attention" on the Cover | Not built. `closing_submit` already calls it **if it exists** |
| F6 | **Reconcile the migration registry** (RUNBOOK §4, D-35). The inventory feed went live as timestamp versions `20261109102531 inventory_feed` and `20261109104257 enable_cron_and_net`. Fix: rename the first row to `0009`; put the cron step into a repo file as a **guarded** migration (runs only where `pg_cron` exists, so CI's plain Postgres skips it; the secret is never in Git); then remove the second row | Supabase's automatic apply refuses lower-numbered files, so new migrations do not apply on push; every session is forced into hand-applying | **Open. Needs the Dua project connected.** Not done in the chat that wrote this file (no access at the time) |
| F7 | Daily encrypted backup to Google Drive + restore drill (ROADMAP A1) | Highest open risk; each accepted module adds real data | Not built |
| F8 | Promotion of shared helpers when a **second** module needs them: Sales `print.js` (`printThermal`, `receiptLine`), an IndexedDB wrapper (Inventory's local copy, Audit's outbox, Closing drafts), PDF approach | Closing (CLS-9), Manager (MGR-11) and Inventory all want print/PDF/IndexedDB. Modules copy locally meanwhile | Requests collected below |
| F9 | Rewrite the 24 bare `has_perm` read policies to the wrapped form (§3.9), with a test | Speed on the larger Sales tables | Optional, low risk |
| F5 | Separate production project (OD-5) | Before launch | Open |
| A4 | Revoke GitHub tokens pasted in earlier chats; rotate the feed's shared secret (it was visible in a screenshot) | Hygiene | Owner |

**Foundation requests collected so far** (modules add rows here via their briefs):

| From | Request | Smallest change |
|---|---|---|
| Closing | Narrow settings wrapper for `till_float` and `per_customer_charge` (core `settings_set` needs `settings.manage`) | Either Foundation adds it, or Closing adds `closing_settings_set` allow-listing two keys (its work order D3) |
| Closing, Manager | PDF output (Closing Book, payslips, books) | Default decision: browser **Save as PDF** from a print layout, no new library (same as Sales Reports). One shared answer for CLS-9 and MGR-11 |
| Closing, Inventory | Thermal printing helper | Copy the small `printThermal` inside each module until F8 promotes it |
| Inventory | IndexedDB wrapper | Build a small one inside `js/modules/inventory/data/`; promote at F8 when Audit starts |

## 6. Owner decision queue (one list, so sessions do not ask the same thing twice)

Each session asks only its own questions, in **one message at the start**, and records answers in its brief.

| Where | IDs | Topic |
|---|---|---|
| Inventory work order §3 | INV-3, INV-7 to INV-15 | Local copy vs server-only reports, sales columns, default windows, who owns the feed, scope of "inventory related" |
| Closing work order §3 | CLS-6 to CLS-14 | Skipped slots, corrections, audit switch, opening balances, Final reset, conflicts, responsible person |
| Manager work order §3 | MGR-5 to MGR-14 | Incentive rates, payslip text link, sensitive staff fields, month locking, ledgers |
| Shared | PDF approach | One answer for CLS-9 and MGR-11 (default: print layout, Save as PDF) |

## 7. Release train (how finished work reaches the live project)

1. A session finishes a slice: `npm run verify` and `bash supabase/tests/run.sh` pass; progress file and handoff paragraph updated; files listed.
2. The owner (or a token-holding session) commits to the module branch and opens a pull request into `main`; CI must be green.
3. Merge **one module at a time**. After each merge the other two sessions run `git merge origin/main` before continuing.
4. After the merge, one person applies the new migrations to the live project **in numeric order**, by hand, registering each under its repo version (RUNBOOK §4), then checks RLS on every new table and that `anon` has no grants.
5. The owner tries the slice on a real phone; the result goes into the module's progress file. Only the owner marks a module Accepted.

## 8. Paste this first in every new session (then the module's own prompt)

```text
This repo is run as three parallel module sessions. Read docs/SESSIONS.md first, then docs/MODULES.md,
then your module's work order (docs/modules/<module>.next-session.md) and brief (docs/modules/<module>.md).
Stay inside your module's files and migration range. Ask the owner your questions in ONE message before
building. Never apply migrations to the live project, never paste or store a token, and never put real
names, numbers or amounts in the repo. At the end, list every file you changed.
```
