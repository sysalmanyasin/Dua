# MODULES.md — The Shared Contract

**Every Claude session (and every human) must read this file completely before writing any code.**
It is the one document that keeps several modules, built in different sessions at the same time, from colliding.

Last updated: 13 Nov 2026 · Owner: the pharmacy owner · Maintained by: the Foundation session only.

---

## 0. How to use this document

### 0.1 Session start protocol (do this, in order)

1. Read this file fully.
2. Read your own brief: `docs/modules/<your-module>.md`. If it does not exist, create it from the template in Appendix A and ask the owner to confirm it before building.
3. Read these existing docs: `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/DATABASE_DESIGN.md`, `docs/DECISIONS.md`, `docs/BUSINESS_RULES.md`.
4. Look at the finished example: `js/modules/sales/` (manifest, `domain/`, `data/`, `ui/`), `supabase/migrations/0002_sales.sql`, `supabase/tests/0002_sales_test.sql`, and `tests/unit/sales-*.test.js`.
5. Run `npm ci && npm run verify`. It must pass **before** you change anything. If it does not, tell the owner and stop.
6. Write back, in plain words, a 10-line summary of: your module's scope, the tables you will own, the permissions you will use, the migration range you may use, and what you will NOT touch. Wait for the owner to say "go".

### 0.2 Session end protocol

1. `npm run verify` and `npm run test:db` both pass.
2. Update **your own** progress file `docs/modules/<module>.progress.md` (what is done, tested, failed, next). Do not edit the shared `PROJECT_PROGRESS.md` while other modules are in progress.
3. List every file you changed, so the owner can copy it into Git. (You cannot push to GitHub; the owner commits.)
4. Write a "Handoff" paragraph at the bottom of your brief: what the next session must know first.

### 0.3 Sessions have no memory

A Claude session remembers nothing from another session. The repository is the only memory. If something is not written in a doc in the repo, assume the next session does not know it. Write decisions down.

---

## 1. The project in one page

- **Goal:** one web app (Dua) on one Supabase project, holding every pharmacy workflow as a **module**.
- **Stack:** plain HTML + JavaScript ES modules, no build step, no framework. Supabase (Postgres, Auth, Storage, Edge Functions). GitHub Pages hosting. npm is for dev tools only. (D-02, D-19)
- **Old apps are references, not sources of data.** Three older public repos hold the business rules, table structure and screen layout we are rebuilding:
  - `sysalmanyasin/BT-Sale-Data2` — first app (Sales, Management, Inventory, STR, Closing summaries, Emergency Billing, AI, Android apps).
  - `sysalmanyasin/Closing` — shift closing app.
  - `sysalmanyasin/Random` — Audit Hub (stock audits, barcode, expiry, Android app).
- **No data import from the old apps.** We copy **rules, structure and layout** only. New modules start empty. Where a module needs a running balance (carried closing values, staff credit balance, petty cash balance), it provides an **opening-balance entry** screen/function instead. (The Sales history import done earlier is a finished one-off and is not repeated.)
- **Inventory data** still comes from Candela → Dropbox → an Edge Function → Supabase tables. Candela stays the source of truth (D-07). The sync function moves into this project (Foundation task F3), and only the **latest** stock is kept (§8.4).
- **Status of the foundation:** login, roles, permissions, shell, router, module loader and Sales are integrated; Manager is integrated; Closing has a partial guided ledger; Inventory's base feed is live and its enhanced feed source is awaiting integration from `module/inventory`. See `docs/PROJECT_STATUS.md`, `PROJECT_PROGRESS.md` and each module progress file.

---

## 2. Non-negotiable rules

These are enforced by tests and CI. Breaking one fails the build.

### Security

1. **The browser is never trusted** for price, permission, status, approval or totals. All access rules live in the database (RLS + functions). Hiding a menu item is cosmetic only.
2. **Every table has RLS enabled.** `anon` has no grants. No blanket "admin sees everything" policies.
3. **Critical writes are Postgres functions (RPC)** that run in one transaction and take an **idempotency key** (client-made UUID).
4. **`security definer` functions** must set `search_path = public`, check `public.has_perm(...)` inside, have execute revoked from `public, anon, authenticated`, then granted to `authenticated` only (copy the pattern at the bottom of `0002_sales.sql`).
5. **Submitted/posted rows are immutable.** A correction is a new revision row with a mandatory reason; the original is kept. (D-12)
6. **Every sensitive action is logged** with `public.log_activity(...)` into the append-only `activity_log`.
7. **No secrets in Git** (service-role key, tokens, passwords, notification topics). Only the publishable key is public. `npm run check:secrets` enforces it.
8. **Public repo:** no real staff names, phone numbers, salaries or business amounts in code, seeds, tests or docs. Use made-up test data. (D-16)
9. Never cache sales totals, credit or salary data on a staff phone. Offline storage holds only the signed-in user's own work and is wiped on logout.

### Code

10. **No `innerHTML`** (or `outerHTML`, `insertAdjacentHTML`). Use the `html` template tag and `render()` from `js/shared/html.js`. ESLint blocks the rest.
11. **No `eval`, `new Function`, `document.write`.** `eqeqeq` is required.
12. **Third-party code is vendored** in `vendor/` with a SHA-256 recorded in `tools/check-vendor.mjs`. Nothing loads from a CDN at runtime. The CSP is `script-src 'self'` (plus Google sign-in only for Gmail send). Do not add a new external host or library yourself — raise a Foundation request (see §3.3).
13. **Money maths lives in `domain/` only**, as pure functions with unit tests. Money in JS is **integer paisa**; in the database `numeric(14,2)`. (D-13)
14. **Dates:** business day is the Asia/Karachi calendar day, cutoff 00:00. Store UTC timestamps plus a separate `business_date`. (D-08)

---

## 3. Who may edit what

### 3.1 Your module's own area (free to edit)

| Area | Path pattern |
|---|---|
| Module code | `js/modules/<id>/**` (manifest, `domain/`, `data/`, `ui/`, `status.js`) |
| Module styles | `css/<id>.css` |
| Unit tests | `tests/unit/<id>-*.test.js` |
| Database migrations | `supabase/migrations/<your range>_*.sql` |
| Database tests | `supabase/tests/<your range>_*_test.sql` |
| Edge Functions | `supabase/functions/<function-name>/` (new folders only) |
| Docs | `docs/modules/<id>.md`, `docs/modules/<id>.progress.md` |

### 3.2 One-line additions you are allowed (expect trivial merge conflicts; resolve by keeping both lines)

- `js/modules/index.js` → add your `id` to `MODULE_IDS`.
- `index.html` → one `<link rel="stylesheet" href="css/<id>.css" />` line.
- `.github/workflows/ci.yml` → add your function folder name to the Edge Function type-check loop.
- `supabase/tests/stub_auth.sql` → only if your tests truly need a new stub (rare; ask first).

### 3.3 Foundation-owned (do NOT edit; ask instead)

`js/core/**`, `js/shared/**`, `css/tokens.css`, `css/base.css`, `css/components.css`, `css/fonts.css`, `eslint.config.js`, `package.json`, `package-lock.json`, `vendor/**`, `tools/**`, migrations `0001`–`0099`, `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md`, `docs/DECISIONS.md`, `docs/BUSINESS_RULES.md`, `PROJECT_PROGRESS.md`, and this file.

**If you need a change there:** write it under "Foundation requests" in your own brief (what, why, smallest change). Keep working with a local workaround inside your module. The Foundation session (or the owner) applies it.

Need a small helper that other modules could also use? Build it inside your module first. Promotion to `js/shared/` is a Foundation decision, made when a second module needs it.

### 3.4 Decisions and rules while sessions run in parallel

- Do **not** edit `DECISIONS.md` or `BUSINESS_RULES.md`. Write your rules and decisions in your brief using your own ID prefix (`MGR-1`, `CLS-1`, `AUD-1`, `INV-1`, `STR-1`…). The Foundation session folds them into the shared docs when your module is accepted.
- The existing Closing rules are already in `BUSINESS_RULES.md` §3–7; read them there.

---

## 4. Module anatomy (the contract)

```
js/modules/<id>/
  manifest.js     what the app needs to know about the module
  status.js       optional: a status-bar pill (see sales/status.js)
  domain/         pure functions. No DOM, no database, no network. All money maths. Unit tested.
  data/           the ONLY place that talks to Supabase (js/core/supabase.js → db()).
                  Reads: tables/views under RLS. Writes: RPC functions only.
  ui/             pages and components. Build HTML with html`...`; render with render().
```

### 4.1 manifest.js

```js
export default {
  id: 'manager',              // lowercase, matches the folder name
  title: 'Manager',
  icon: 'users',              // name from js/shared/icons.js
  nav: { order: 20 },         // see §7 for reserved orders
  permission: null,           // module-level permission key, or null (each page then says who may open it)
  routes: [
    { path: '/manager/staff', title: 'Staff Registry', desc: 'People and details',
      permission: 'mgmt.staff_view',                // or anyOf: ['a.b', 'c.d']
      load: () => import('./ui/staff.js') },
  ],
};
```

Rules checked by `tests/unit/repo-consistency.test.js`:

- Route paths match `^/[a-z0-9/_-]+$`, are **unique across all modules**, and **must start with `/<your-id>`**.
- `load` is a function returning a dynamic `import()` (modules load lazily, only when the route opens).
- Any `permission` named in the manifest must be seeded in a migration (§5.3).
- A route with a `title` appears in the module's sub-navigation; a route without one is reachable but hidden.
- A module can be switched off by an admin setting (`modules_disabled`) without breaking others, so **never import another module's files** (§8).

### 4.2 Pages

A page file default-exports what the router expects (copy the signature from `sales/ui/*.js`). Rules:

- Each page gets a fresh container (the shell guarantees this). Attach listeners to elements you create; do not use global listeners that outlive the page.
- Phone first. Use the shared design tokens (`css/tokens.css`) and shared components (`js/shared/ui.js`: `hero`, `sectionLabel`, …). Colors, fonts, spacing come from tokens (D-23: navy `#101B2D`, teal `#18A999`, amber `#F2B84B`).
- Touch targets ≥ 44 px, text ≥ 0.8 rem, status never colour-only (use ▲ ▼ ✓ or words as well).
- Heavy libraries (e.g. charts) load only on the page that needs them.
- Pages that list history must paginate or use delta reads (§6.6).

---

## 5. Database conventions

### 5.1 Naming and migration ranges

Migrations are applied in filename order, on a clean database, by CI (`supabase/tests/run.sh`). To let modules grow in parallel, each owns a **range**. Never use a number outside your range.

| Range | Owner |
|---|---|
| `0001`–`0099` | Foundation + Sales (core, sales, checklist, dashboard views, shared settings, inventory feed F3) |
| `0100`–`0199` | Manager |
| `0200`–`0299` | Closing |
| `0300`–`0399` | Inventory (screens/reports; the feed itself is Foundation F3) |
| `0400`–`0499` | Audit |
| `0500`–`0599` | STR |
| `0600`–`0699` | Emergency Billing |
| `0700`–`0799` | Reports / Cover signals / Herald |
| `0800`–`0899` | AI / Intelligence |
| `0900`–`0999` | Reserved |

File name: `<4-digit number>_<module>_<what>.sql`, e.g. `0201_closing_tables.sql`. Test name: `<same number>_<module>_<what>_test.sql` (the runner picks up every `*_test.sql`).

**Table names:** every new table, view and function carries your module prefix: `mgmt_…`, `closing_…`, `audit_…`, `inventory_…`, `str_…`, `ebill_…`. (Sales and core keep their legacy un-prefixed names; nobody else may use un-prefixed names.)

### 5.2 Table rules

- `id uuid primary key default gen_random_uuid()` unless a natural key is clearer.
- `created_at`, `updated_at timestamptz` (UTC); `business_date date` wherever the day matters; `created_by` → who did it.
- Money `numeric(14,2)`. Quantities `numeric`. Never `float`.
- Soft delete with `deleted_at` where history matters. Posted/submitted rows are never updated or deleted — add a revision row.
- Foreign keys and indexes on `business_date`, parent ids and `user_id`.
- **Format required by the consistency test:** write `create table public.<name>` and, for each table, a line `alter table public.<name> enable row level security;` in the same migration.
- Free-tier sizing: avoid copying large tables; never design a screen that reads whole history on open (§6.6).

### 5.3 Permissions

- Permission key format: `<prefix>.<action>`, lowercase, e.g. `mgmt.staff_view`. Prefixes you may use: your own module's (§7). The keys that already exist (see `0001_core.sql`) are reserved for the module named by their prefix.
- Seed new keys **in your own migration**, in exactly this shape (the test reads it with a regex):

```sql
insert into public.permissions (key, description) values
 ('mgmt.staff_view', 'See the staff registry'),
 ('mgmt.staff_edit', 'Edit staff details');
```

- Role presets (admin / senior / junior) are only templates. Add to `role_permissions` only what the owner has approved in your brief.
- Check permissions with `public.has_perm('key')`. Admin gets everything only when MFA is satisfied (`aal2`) — this is already inside `has_perm`.

### 5.4 Templates to copy

**Table + RLS + read policy**

```sql
create table public.mgmt_example (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  amount numeric(14,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.mgmt_example enable row level security;
create policy mgmt_example_read on public.mgmt_example for select to authenticated
  using (public.has_perm('mgmt.petty_cash'));
-- no insert/update/delete policy: writes go through an RPC below
grant select on public.mgmt_example to authenticated;
```

**Write function (RPC) with permission check, idempotency, and log**

```sql
create function public.mgmt_example_save(p_date date, p_amount numeric, p_key uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_perm('mgmt.petty_cash') then raise exception 'not allowed' using errcode = '42501'; end if;
  -- idempotency: the same key must not create a second row (use a unique column or a lookup)
  insert into public.mgmt_example(business_date, amount, created_by) values (p_date, p_amount, auth.uid())
    returning id into v_id;
  perform public.log_activity('mgmt.example_saved', 'mgmt_example', v_id::text, null, jsonb_build_object('amount', p_amount), null);
  return v_id;
end $$;
revoke all on function public.mgmt_example_save(date, numeric, uuid) from public, anon, authenticated;
grant execute on function public.mgmt_example_save(date, numeric, uuid) to authenticated;
```

### 5.5 Database tests (required)

Copy the helper block at the top of `supabase/tests/0006_checklist_test.sql` (`as_user`, `ok`, `fails`). For every table and function you add, prove at least:

- a user **without** the permission is refused (read and write);
- an `anon` user reads nothing;
- a **direct** insert/update/delete on the table is refused (only the RPC works);
- the same idempotency key twice creates one row;
- a submitted/posted row cannot be edited (if your module has such rows);
- your money formulas give the expected numbers (use invented figures).

---

## 6. Cross-cutting conventions

1. **Identity:** staff are rows in core `staff`; each login links to a `staff` record via `profiles`. Your module references `staff.id`. **Never create your own staff or user table.** Never delete a staff row; disable it.
2. **Settings:** shared settings live in `settings` (`till_float`, `per_customer_charge`, thresholds…). Add module settings with a module prefix (`closing.xxx`) through your migration. Changes go through `settings_set(...)`, which logs and versions them.
3. **Per-person preferences:** use `user_prefs` through `core/prefs.js` (`getPref`, `setPref`).
4. **Notifications to the owner (built, live since 12 Nov 2026; D-36, D-37).** Foundation F4 is done. Modules only *ask* for a notification and never talk to ntfy:
   - **How to call it:** from inside your own RPC, `perform public.notify_owner('<module>.<event>', jsonb_build_object('...', ...))`. The signature is exactly `notify_owner(text, jsonb) returns uuid`. Guard with `to_regprocedure('public.notify_owner(text, jsonb)') is not null` if your code must also run where it may not exist (as Closing does). It is callable only from inside the database (not by signed-in users).
   - **It can never block your action:** it never raises. Bad input, a duplicate, a full backlog or any internal problem just returns `null`. Do not wrap it in your own error handling.
   - **Kind:** lowercase letters, digits, `_` and `.`, up to 60 characters, shaped like `closing.submitted`. A new kind shows a generic message until Foundation adds wording in `supabase/functions/_shared/ntfy.ts` and `js/shared/alerts.js`; ask Foundation (§3.3).
   - **Payload:** ids and dates only, at most 4 KB. **Never amounts, names or other business values:** the push goes through a public ntfy server. Optional `dedupe_key` in the payload drops repeats while the earlier alert is unacknowledged.
   - **Where it goes:** the `notifications` table (status `pending|sent|failed`, attempts, last error) is the permanent record. The sender (`notify-ntfy`) retries 5 times with backoff and every failure stays visible: failed or long-unsent alerts appear in the Cover's "Needs attention" and in the owner-only Tools tab (`tools.view`). The ntfy topic and secrets live only in Edge Function secrets, never in Git.
   - **Do not** edit `notify-ntfy`, the `notifications` table or `cover_summary()` to add your alert. The Cover reads alerts through `notifications_attention()`, separate from `cover_summary()`, so your Cover signals stay yours.
   - Do not copy the old ntfy Edge Functions.
5. **Printing, copy and Gmail send:** reuse what Sales built (`js/modules/sales/ui/print.js`, `js/shared/mailDialog.js`, `js/core/gmail.js`). Do not import from the sales module; ask Foundation to promote what you need (§3.3).
6. **Reads on the Free plan:** pull deltas (`updated_at > last_sync`), paginate (Supabase returns at most 1000 rows; see `fetchAll` in `sales/data/api.js`), use summary views for dashboards, cache static lists. Targets: first screen < 2.5 s, navigation < 1 s.
7. **Offline:** only where the brief says so. Drafts may be saved on the device; **submit requires a connection** (D-14). Counting/scan queues use an IndexedDB outbox that is idempotent and cleared on logout (Audit only; the library choice is a Foundation request).
8. **Errors:** use `log` from `js/core/logger.js` (it scrubs sensitive data). Show a plain message to the person; never show raw database errors.
9. **Language and tone of screens:** plain English labels; amounts shown as `₨ 12,345` via `shared/format.js`.

---

## 7. Module registry

Update only your own row (and only when your brief is accepted). Statuses: **Planned → Briefed → Building → Accepted**.

| Module id | Scope (source in old apps) | Table / function prefix | Permission prefix | Route prefix | Nav order | Migrations | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| `home` | Cover / landing (core) | — | — | `/home` | 0 | — | core | Built |
| `sales` | Daily sales, dashboard, reports, check list (BT-Sale-Data2 `js/sales`) | _(legacy, none)_ | `sales.`, `targets.`, `checklist.` | `/sales` | 10 | 0001–0099 | core | Building |
| `manager` | **Owner-only.** Staff Registry, notes, salary, payslips, petty cash, staff credit, Credit Inbox (from Closing), incentives, ledgers, reports; attendance later with the Android app (BT-Sale-Data2 `js/manager`) | `mgmt_` | `mgmt.`, `credit.` | `/manager` | 20 | 0100–0199 | core, closing credit feed | Planned |
| `closing` | Shift closing, final closing, credit/misc ledgers, Closing Book, history tabs (Closing repo; BT-Sale-Data2 `js/closing`) | `closing_` | `closing.` | `/closing` | 30 | 0200–0299 | core, inventory interface | Planned |
| `inventory` | Feed (F3), stock ledger, excess, reorder, health (BT-Sale-Data2 `js/inventory`, `inventory-search`) | `inventory_` | `inventory.` | `/inventory` | 40 | 0300–0399 (+ feed in 0001–0099) | core | Planned |
| `audit` | Engagements, rounds, assignments, counting, barcode, expiry, reports (Random repo) | `audit_` | `audit.` | `/audit` | 50 | 0400–0499 | core, inventory interface | Planned |
| `str` | Stock transfer requests (BT-Sale-Data2 `js/str`) | `str_` | `str.` | `/str` | 60 | 0500–0599 | core, inventory interface | Planned |
| `ebill` | Emergency billing (BT-Sale-Data2 `js/emergency-billing`) | `ebill_` | `ebill.` (new) | `/ebill` | 70 | 0600–0699 | core, inventory interface | Planned |
| `reports` | Cross-module reports, Herald, cover signals | `reports_` | `reports.` | `/reports` | 80 | 0700–0799 | other modules' interfaces | Planned |
| `ai` | BT Intelligence, assistant | `ai_` | `ai.` (new) | `/ai` | 85 | 0800–0899 | all | Planned |
| `access` | Users & Access (core) | — | `users.` | `/access` | 90 | — | core | Built |

Android apps (attendance, widgets, mail routine, audit scanner) are **after** their web module is accepted and are not part of this contract yet.

---

## 8. How modules talk to each other

**Rule: a module never reads another module's tables, and never imports another module's files.** Two things are allowed:

1. **Core:** everyone may use core tables and helpers (`staff`, `profiles`, `settings`, `activity_log`, `user_prefs`, `has_perm`, `log_activity`, `js/core/*`, `js/shared/*`).
2. **Published interfaces:** a module may publish a small number of **database functions or views** that others may call. They are listed below, owned by the provider, and only ever grow in a backward-compatible way. The provider must test them. A consumer calls them from its own `data/` folder.

### 8.1 Interfaces (proposed names; the provider's brief confirms them)

| Provider | Interface | Consumers | Purpose |
|---|---|---|---|
| Inventory (feed F3) | `inventory_latest_sync()` | all | When stock data was last refreshed |
| Inventory (feed F3) | `inventory_balances(p_codes text[])` | closing (Inventory Audit card, 31 fixed codes) | Current stock for given item codes |
| Inventory (feed F3) | `inventory_search(p_text text, p_limit int)` | audit, str, ebill | Product search (permission `inventory.search`) |
| Inventory (feed F3) | `inventory_products_for_scope(p_scope jsonb)` | audit | Frozen product list for a round |
| Closing | `closing_credit_feed(p_after timestamptz)` | manager | Read-only list of credit lines from **submitted** closings (date, shift, kind, label, amount, line id). Needs `credit.view`. See §8.2 |
| Core | `staff` table, `my_context()` | all | Who is the person, what may they do |

If you need something that is not listed, add a **request** in your brief and agree the interface with the owner before building around it.

### 8.2 Decided: credit bridge (owner decision, 9 Nov 2026)

- **Closing is for staff.** Staff close the shift and record credit there (customer, tier and free-label credit). That is a **record of what happened at the counter**, nothing more.
- **Manager is for the owner only.** It holds the real ledgers (staff credit and the others). No staff role gets any `mgmt.*` or `credit.*` permission.
- **The bridge is one-way and manual.** The owner opens a **Credit Inbox** in Manager, sees each credit line that Closing recorded (for example "Rs 1,000"), and **files it into the correct Manager ledger by hand**. Nothing is filed automatically.
- How it is built:
  1. Closing publishes the read-only function `closing_credit_feed(...)` (§8.1). It returns lines from submitted closings only.
  2. Manager owns a table `mgmt_credit_filings` that remembers, for each Closing line id, **which ledger it was filed into, by whom, and when**. Manager never writes to a Closing table, and Closing never needs to know about filing.
  3. The inbox = feed lines that have no filing row yet. Filing creates the Manager ledger entry **and** the filing row in one RPC (idempotent). A mistake is fixed by a reversal entry, not by editing (D-12).
  4. The line id is stored as a plain value, not a database foreign key, so either module can be switched off without breaking the other.
- Corrections in Closing (`closing_correct`) must keep the original line id stable or publish a "superseded by" link, so the inbox can show "this line changed after you filed it". The Closing brief must cover this.
- **History, so nobody re-adds the wrong thing:** the old Closing app once forwarded credit automatically into the old BT app's inbox tables (including an "Unmatched" tab). That was **removed on purpose**: the two ledgers are meant to stay independent records, not one auto-merged into the other (see the Closing repo's `SCHEMA.md`, "BT Sale Data bridge"). The Credit Inbox above is the deliberate redesign that file asks for: a **read-only feed plus manual filing by the owner**. Do not rebuild the old automatic forwarding, and do not auto-match lines to staff or ledgers.
- The old BT Manager still has an "Unmatched" tab and a database trigger that folds some staff-credit entries into the ledger automatically. The Manager brief must read them and record what to KEEP / IMPROVE / DROP; manual filing overrides automatic folding.

### 8.3 Decided: attendance

Attendance is built **with the Android app, inside the Manager module**, later. The web Manager module ships without it. Note for that future slice: staff phones will *write* check-in events while the rest of Manager is owner-only, so attendance needs its own separate permission (for check-in) and its own narrow RPC, not a Manager-wide permission.

### 8.4 Decided: inventory is latest-only

- The inventory feed (F3) keeps **only the current stock**. A sync replaces the product rows and updates one `inventory_sync_log` row; there are no dated snapshots and no history table.
- This keeps the Free-tier database small (OD-7). It also means **no module may assume past stock levels exist**. Audit rounds already store their own frozen list when a round is locked, so they do not depend on history in this table.
- **Stock Ledger needs no history (checked in the old code):** each product row from Candela already carries its own 30/60/90-day and today sales quantities and values, creation date, last receive date and last sale date. Stock Ledger, Excess Working, Reorder and Health all compute from that one latest row set. The one thing that did keep history was a small per-device "reorder value over time" trend in the old Health page; the Inventory brief decides whether to drop it or keep it per device.
- **The repo schema is out of date:** the live `inventory_products` table has more columns than `Random/supabase/schema.sql` shows. Task F3 must start from the **live** table definition and the **deployed** Edge Function source (download it from the Supabase dashboard), plus the Candela-side export script (`sync.ps1`, mentioned in old code comments). Neither the function nor the script is in the public repos, and no Dropbox token may ever enter Git.

---

## 9. Porting from the old apps (rules → structure → layout)

We rebuild, we do not copy code. The old code is for understanding. Follow this recipe for every module:

1. **Read the old module.** Clone the old repo (public). Note every screen, field, calculation and permission. Put what you learn in your brief under **Rules** in plain words, tagged `KEEP`, `IMPROVE`, `DROP`, or `ASK` (as in `BUSINESS_RULES.md`). `ASK` items go to the owner; do not guess money rules.
2. **Write the structure.** Tables (with prefix), columns, relationships, permissions, who can see/edit what. Put it under **Structure** in your brief. Get owner approval before the migration.
3. **Pure maths first.** Write `domain/` functions and their tests from the **old formulas**. They must reproduce the old results exactly on invented sample figures before anyone may improve them.
4. **Database + tests.** Migration, RPCs, and the database tests of §5.5. If a calculation exists in both JS (live preview) and SQL (saved result), add a **parity test** that feeds identical samples to both and fails on any difference, even 1 paisa (see `tests/fixtures/sales-total-cases.json` and `sales-totals.test.js`).
5. **Data layer** in `data/`, then the **screens** in `ui/`, copying the old **layout** (what is on screen, in what order, which buttons) using Dua's tokens and components.
6. **Try it on a real phone** and record the result in your progress file. Only the owner marks a module Accepted.
7. **Opening balances** instead of imports: build a small admin-only "opening balance" function/screen if your module carries running balances.

### 9.1 Where the old rules live

| Topic | Look here |
|---|---|
| Sales, daily check list, targets | BT-Sale-Data2 `js/sales/`, `js/shared/summary-calc.js` (already ported; see `docs/SALES_DESIGN.md`) |
| Management (staff, salary, payslip, petty, credit, incentive, attendance, notes) | BT-Sale-Data2 `js/manager/` (+ its README), `supabase/migrations/*attendance*`, `*staff_credit*` |
| Shift closing | Closing repo `js/actions.js` (`calc()`), `js/state.js`, `SCHEMA.md`; rules already in `BUSINESS_RULES.md` §3–7 |
| Inventory | BT-Sale-Data2 `js/inventory/`, `js/shared/inventory-metrics.js`, `js/shared/planning-metrics.js`, `inventory-search/` |
| STR | BT-Sale-Data2 `js/str/` |
| Audit | Random repo `README.md`, `supabase/schema.sql`, `supabase/barcode-schema.sql`, `docs/BARCODE.md`, `js/actions/`, `js/components/` |
| Emergency billing | BT-Sale-Data2 `js/emergency-billing/`, `supabase/migrations/*emergency_billing*` |

The old apps used shared `anon` access in places and kept the Dropbox sync function in a separate Supabase project (its source is not in these repos). Do not carry those weaknesses over; Dua's security model replaces them.

---

## 10. Decisions from the owner (sessions must not guess the open ones)

| ID | Question | Status | Answer / suggested default |
|---|---|---|---|
| OD-1 | Who owns credit? | **Decided** | Closing records credit (staff-facing). Manager (owner-only) files it by hand from a Credit Inbox into the right ledger. See §8.2 |
| OD-2 | Attendance now or later? | **Decided** | Later, with the Android app, inside Manager. See §8.3 |
| OD-3 | Inventory history: dated snapshots or latest only? | **Decided** | **Latest inventory only. No dated snapshots.** Each sync replaces the current stock rows. This overrides the "dated snapshots" wording in D-07 (Candela is still the source of truth). See §8.4 |
| OD-4 | How the owner is notified | **Decided and built** | **ntfy**, via a `notifications` table plus one send function, `notify-ntfy` (§6.4; D-36, D-37). Live since 12 Nov 2026. Modules call `notify_owner(text, jsonb)` and never call ntfy themselves |
| OD-5 | Production Supabase project | Open | Today production = staging (`js/core/config.js`). Create `dua-production` before the first module goes live |
| OD-6 | Offline outbox library for Audit | Open | Foundation request when Audit starts |
| OD-7 | Free-tier limits with all modules in one project | Open | Review after each accepted module |

---

## 11. Definition of done (every module slice)

A slice is done only when **all** are true:

- [ ] `npm run verify` passes (lint, format, unit tests, secret scan, vendor hashes).
- [ ] `npm run test:db` passes, including the security checks of §5.5.
- [ ] Domain maths reproduces the old results on invented samples; parity tests exist where JS and SQL both calculate.
- [ ] No file outside §3.1 and §3.2 was changed (check with `git status`).
- [ ] Every new permission is seeded and described; the manifest only references seeded keys.
- [ ] The slice was tried on a real phone and the result is in the progress file.
- [ ] Brief and progress file are updated; handoff paragraph written.

---

## 12. Git and parallel sessions

- **One branch per module:** `module/manager`, `module/closing`, `module/inventory`, `module/audit`, … The Foundation work uses `foundation/<task>`.
- **Small, working slices.** Merge one module's slice at a time. After any merge, other branches run `git rebase main` (or merge `main`) before continuing.
- **Merge order matters only for the shared one-liners** (§3.2). Resolve by keeping both lines.
- **Never rename or renumber a migration after it has been applied** to the live project. Fix forward with a new migration in your range.
- **Foundation tasks** (done first, by one session, before parallel module work):
  - **F1** — this contract and the three module briefs.
  - **F2** — Sales finished and accepted (it is the pattern everyone copies).
  - **F3** — Inventory feed: move the Dropbox sync Edge Function and the product/sync tables into this project as **latest-only** (§8.4); publish the interfaces of §8.1. No screens.
  - **F4** — Notification mechanism on ntfy (§6.4) and any shared helpers other modules request.
  - **F5** — Production project (OD-5).

---

## Appendix A — Module brief template (`docs/modules/<id>.md`)

```markdown
# <Module name> — brief

Status: Briefed | Building | Accepted        Owner approval: yes/no (date)
Branch: module/<id>        Migration range: 0X00–0X99        Prefix: <prefix>_        Permissions: <prefix>.*

## 1. Scope
What this module does, in plain words. What it does NOT do (and which module does).

## 2. Old-app source
Which old repo / folders / screens this comes from (links).

## 3. Rules (from the old app)
Plain-language rules and formulas. Tag each: KEEP / IMPROVE / DROP / ASK. Use invented sample numbers.

## 4. Structure
Tables (name, purpose, key columns), relationships, which are posted/immutable, opening-balance needs.

## 5. Permissions
Each key, what it allows, which role presets (if any) get it.

## 6. Screens (layout)
Route, title, what is on the screen top to bottom, buttons, who sees it. Phone first.

## 7. Interfaces
Provided to others / consumed from others (§8). Requests to Foundation (§3.3).

## 8. Decisions
`<ID>-1` … with date and status (Open / Accepted).

## 9. Slices (build order)
1. … 2. … Each slice small enough to finish and try on a phone.

## 10. Handoff
What the next session must know first.
```

## Appendix B — Prompt to paste at the start of every module session

```text
You are building the "<module id>" module of the Dua pharmacy app.
Before doing anything: read docs/MODULES.md completely, then docs/modules/<module id>.md,
then docs/ARCHITECTURE.md, docs/SECURITY_MODEL.md, docs/DATABASE_DESIGN.md,
docs/DECISIONS.md and docs/BUSINESS_RULES.md. Study js/modules/sales as the finished example.
Follow the session start protocol in MODULES.md §0.1 exactly: run `npm ci && npm run verify`,
then tell me, in about 10 lines, your scope, tables, permissions, migration range and what you will
not touch. Wait for my "go" before writing code. Stay inside the files MODULES.md §3 allows.
Do not guess money rules: ask me. At the end follow §0.2.
The repo is https://github.com/sysalmanyasin/Dua (branch main). The old apps are
public references for rules, structure and layout only: sysalmanyasin/BT-Sale-Data2,
sysalmanyasin/Closing, sysalmanyasin/Random. Do not import any data from them.
```
