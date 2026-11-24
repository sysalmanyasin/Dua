# Audit — brief

Status: **Integrated; Audit 2.0, expiry/racks, Barcode and Audit 3.0 are built and live; Audit 3.0 phone tests PHONE 5 to 10 passed and the owner accepted it on 24 Nov 2026** · Owner approval: yes (16 Nov 2026, "go")
Branch history: `module/audit` · Migration range: `0400–0499` · Prefix: `audit_` · Permissions: `audit.*` · Route prefix: `/audit` · Nav order: 50

> Read `docs/MODULES.md` first. This brief follows its Appendix A template. It is the plan agreed with the owner on 15–16 Nov 2026; the long-form reasoning (old app vs new core, row by row) lives in the owner's plan document "Audit Module Plan for Dua".

## 1. Scope

**In scope:** the whole stock-audit lifecycle of the old Audit Hub, rebuilt on Dua's core:

- Engagements (scope: full inventory, selected companies, single company, template, individual) and rounds with the lifecycle draft → locked → counting → compiled → final; lettered sub-rounds (1A, 1B)
- Assignments (auto-split by company count or item volume, manual move, revoke, reopen)
- Counting (manual, barcode, hybrid), offline counting, calculator, notes, row timing, "Mark Remaining as Match", Force Submit
- Compilation, variance review, difference rounds (differences only, full company recount, random spot-check), cross-round conflicts, corrections (propose → review → approve/reject), Final Snapshot
- Individual (self-service) audits in a rolling monthly engagement; saved templates; templates can also be made by choosing CSV files of product codes only (one template per file, named after the file, previewed before saving)
- Expiry tracking (racks, monthly rack-to-staff assignment, entries)
- Barcode Center (register, verify, change, disable, conflicts, scan history) and the camera scanner
- Reports (final, variance, round and submission history, audit trail) with print / Save as PDF
- Owner alerts through `notify_owner`; a compiled round (individual self-picks too) raises the full "Audit Round Complete" push with its figures (D-64; migration 0413)

**Out of scope:** staff creation, PIN reset, blocking and expiry (Dua's Users & Access does this); the stock feed itself (Inventory); the legacy "Verify Stock" workflow (dropped, AUD-11); Android shell and widget (later, after acceptance); any import of old audit history (AUD-6).

## 2. Old-app source

`sysalmanyasin/Random` (Audit Hub, `main`): `README.md`, `BLUEPRINT_v1_original.md`, `supabase/schema.sql`, `supabase/barcode-schema.sql`, `docs/BARCODE.md`, `js/actions/*` (compile, counting, difference, item-key, individual, round, assignment, variance-edit), `js/components/*`, `js/barcode/*`, and the 31 files in `tests/*.test.mjs`, which are the executable specification of the rules below.

## 3. Rules (from the old app)

| # | Rule | Tag |
|---|---|---|
| R1 | An item never entered counts as **0** (a visible shortage). Only "Mark Remaining as Match" or Force Submit (match mode) may change that, and those rows stay marked `auto_matched` | KEEP |
| R2 | Each round freezes its own item list at lock; a later inventory sync never moves it. A new round takes a fresh snapshot | KEEP |
| R3 | Compile may proceed with missing assignments only as an explicit choice, and the choice is stored | KEEP |
| R4 | Merge keys on company + item; difference rounds send back only the differing items (or a full company, or a spot-check sample) | KEEP |
| R5 | Cross-round conflicts are never auto-resolved; the owner picks a side and the choice is recorded | KEEP |
| R6 | A correction is proposed, reviewed, then approved or rejected; the original count is always kept | KEEP |
| R7 | Row timing credits at most 600 seconds to one item | KEEP |
| R8 | Individual audits live in one rolling monthly engagement; one open self-pick per person. **Each self-pick compiles itself when submitted (0412) and raises no cross-round conflicts (AUD-14)** | KEEP |
| R9 | A barcode is globally unique and never silently reassigned; conflicts need an explicit owner decision with a reason. Numeric EAN/UPC/GTIN codes are check-digit validated | KEEP |
| R10 | A locked expiry entry can be reopened, edited or deleted only by the owner (`audit.expiry_manage`) | KEEP |
| R11 | Item identity is `company::<position>` inside one round's snapshot | IMPROVE: stable uuid plus product code per round item |
| R12 | Variance and compile are computed in the browser and stored as sent | IMPROVE: computed in SQL (`audit_compile_round`); the screen previews with the same rule; parity-tested |
| R13 | Resubmitting overwrites the submission | IMPROVE: only after an owner reopen with a reason; the new submission is a revision, the original is kept (D-12) |
| R14 | Progress is copied by rewriting a `live_snapshot` about 1.5 s after each change | IMPROVE: count events synced in batches; progress is derived |
| R15 | Random spot-check uses `sort(() => Math.random() - 0.5)` | IMPROVE: server-side draw with a stored seed |
| R16 | Client-written `audit_log` with free-text actor | DROP: core `activity_log` via `log_activity` |
| R17 | Own `staff` table, phone + 4-digit PIN (stored as PIN + `00`) | DROP: Dua accounts (AUD-10) |
| R18 | Legacy "Verify Stock" workflow | DROP (AUD-11) |
| R19 | Blind counting | Not used (AUD-4): counters see the system quantity |
| R20 | The old `price` is the **retail price**; variance value = variance quantity × retail price | KEEP (AUD-5) |
| R21 | Counters see quantities, variance and variance value for their own assignment | KEEP (AUD-5) |

`ASK` items: none open except those in section 8.

## 4. Structure

Table names are a proposal; the first migration confirms them. Every table: `create table public.<name>`, a matching `alter table ... enable row level security;`, no direct write grants, `numeric(14,2)` money, `created_at` / `updated_at`, indexes on parent ids and dates (MODULES.md §5.2).

| Group | Tables | Notes |
|---|---|---|
| Flow | `audit_engagements`, `audit_members`, `audit_rounds`, `audit_round_items`, `audit_assignments`, `audit_assignment_items` | Round items freeze at lock and are immutable afterwards; an assignment points at item ids |
| Counting | `audit_count_events`, `audit_submissions`, `audit_submission_lines` | Events are append-only with a unique client event id (idempotent retries); a submission is a revision |
| Results | `audit_compilations`, `audit_compiled_rows`, `audit_corrections`, `audit_conflicts`, `audit_finals`, `audit_final_lines` | Written only by functions; finals are immutable |
| Templates | `audit_templates` | Codes only, resolved against current inventory when loaded |
| Barcode | `audit_barcodes`, `audit_barcode_log`, `audit_scan_events` | Port of the old register / verify / change / disable / conflict functions; scan events idempotent by client event id |
| Expiry | `audit_racks`, `audit_rack_assignments`, `audit_expiry_entries` | Locked on save |

Not rebuilt: old `staff` and `audit_log` (core `staff`, `profiles`, `activity_log` replace them).

**Functions (writes):** `audit_engagement_create`, `audit_round_create`, `audit_round_lock`, `audit_assign_auto`, `audit_assign_move`, `audit_count_batch`, `audit_submit`, `audit_reopen`, `audit_compile_round` (and the internal `audit_compile_round_core`, 0412), `audit_round_next`, `audit_correction_propose`, `audit_correction_decide`, `audit_conflict_resolve`, `audit_finalize`, `audit_individual_start`, plus barcode and expiry equivalents. Each checks `has_perm`, runs in one transaction, logs with `log_activity`, takes an idempotency key or expected version where it is a draft-like write, and follows the MODULES.md §5.4 security pattern.
**Reads for counters:** `audit_my_items(assignment)`; counters never read the item tables directly.
**Error codes:** every refusal the screen must explain gets its own SQLSTATE and hint from the first migration (lesson G3 from Closing); `data/api.js` maps by code, never by message text.
**Version guard:** mutable writes take the version the browser last saw and refuse an older one (lesson G5 / CLS-13).

**Round lifecycle (states move only through functions):**

| Move | Key | Function | Guard |
|---|---|---|---|
| draft → locked | `audit.manage` | `audit_round_lock` | Freezes the item list |
| locked → counting | none | first count event | Assigned, unexpired person only |
| counting → compiled | `audit.compile` | `audit_compile_round` | Refused with unsubmitted assignments unless "compile anyway" is chosen and stored |
| compiled → compiled | `audit.compile` | `audit_compile_round` | New compilation revision; the earlier one is kept |
| compiled → final | `audit.finalize` | `audit_finalize` | Immutable snapshot |
| submitted → reopened | `audit.reopen` | `audit_reopen` | Reason required; original kept |

**Opening balances:** none needed (no running balances). **Old data:** not imported (AUD-6).

## 5. Permissions

Existing in core (`0001_core.sql`): `audit.count`, `audit.manage`, `audit.review`. New keys, seeded in the first `04xx` migration in the required shape (`insert into public.permissions (key, description) values ...`). Keys may contain only letters and underscores.

| Key | Allows | Default holder |
|---|---|---|
| `audit.count` (exists) | Count own assignments and submit | Junior and senior presets (already) |
| `audit.individual` | Start own Individual Audits | Sub bundle |
| `audit.view` | See engagements, rounds, progress, compiled results and variance values | Deputy bundle |
| `audit.manage` (exists) | Create engagements and rounds, lock rounds | Owner only |
| `audit.assign` | Assign, move, revoke assignments | Owner; may delegate |
| `audit.compile` | Compile rounds, generate the next round | Owner; may delegate |
| `audit.review` (exists) | Approve or reject corrections, resolve conflicts | Owner only |
| `audit.suggest` | Propose a corrected count with a reason | Deputy bundle |
| `audit.finalize` | Create the Final Snapshot | Owner only |
| `audit.reopen` | Reopen a submitted assignment | Owner only |
| `audit.report` | Export reports | Deputy bundle |
| `audit.templates` | Create and edit templates | Owner; may delegate |
| `audit.barcode_scan` | Scan during counting | Sub bundle |
| `audit.barcode_register` | Register and verify barcodes, report conflicts | Deputy bundle |
| `audit.barcode_admin` | Resolve conflicts, disable or reassign a barcode | Owner only |
| `audit.expiry_log` | Log near-expiry stock | Sub bundle |
| `audit.expiry_manage` | Racks, rack assignment, reopen or delete entries | Owner only |

**Roles:** Owner (`admin`, MFA) is the Main Auditor and holds every key. Deputy = `senior` plus granted keys; Sub-Auditor = `junior` plus granted keys. Role presets only get what the owner approves: nothing is added to `role_permissions` beyond the existing `audit.count`.
**Bundles (not a new mechanism):** Deputy = `audit.view`, `audit.suggest`, `audit.report`, `audit.barcode_register`, `audit.count`. Sub = `audit.count`, `audit.individual`, `audit.barcode_scan`, `audit.expiry_log`. Applied from `/audit/team` (owner only, needs `users.manage`) by calling core `set_user_permission` once per key, so every grant is logged. Bundle definitions live in `domain/bundles.js` with a test that every key is seeded.
**Engagement scope:** `audit_members` (engagement, person, role: lead, deputy, counter, observer). A deputy with `audit.view` sees only engagements they were added to; the owner sees all; counters see only their own assignments.

## 6. Screens (layout)

Phone first; touch targets ≥ 44 px, text ≥ 0.8 rem, status never colour-only. Styles in `css/audit.css`, keeping the old layout and crimson accent (AUD-12). Money shown as `₨ 12,345`.

| Route | Replaces | Who (any of) |
|---|---|---|
| `/audit` (hub) | Home: my assignments, quick start; progress tiles for `audit.view` | `audit.count`, `audit.view`, `audit.manage` |
| `/audit/engagements`, `/audit/engagement` | Team Audit hub: scope, rounds, assignment preview | `audit.view`, `audit.manage` |
| `/audit/round` | Assign, lock, live progress, force submit, reopen | `audit.assign`, `audit.manage` |
| `/audit/count` | Counting: manual / barcode / hybrid, calculator, notes, submit | `audit.count` |
| `/audit/individual` | Individual Audit | `audit.individual` |
| `/audit/compile` | Compile, variance review, corrections, conflicts, next round | `audit.compile`, `audit.review`, `audit.suggest`, `audit.view` |
| `/audit/reports` | Reports; print / Save as PDF | `audit.report` |
| `/audit/templates` | Inventory tab: search, group, templates | `audit.templates`, `audit.individual` |
| `/audit/expiry`, `/audit/expiry/racks` | Expiry Tracking | `audit.expiry_log`, `audit.expiry_manage` |
| `/audit/barcode` (+ master, register, queue, conflicts, history) | Barcode Center | `audit.barcode_*` |
| `/audit/team` | Audit part of the Staff tab: apply bundles, per-key switches | Owner only |
| `/audit/settings` | `audit.` settings | `audit.manage` |

## 7. Interfaces

**Consumes**
- `inventory_search(p_text, p_limit, p_offset)` and `inventory_balances(p_codes)`: on `main` (`0301`/`0302`).
- `inventory_products_for_scope(p_scope jsonb)` and `inventory_companies()`: on `main` once PR #31 merges (`0308`, applied live 18 Nov 2026). Scope shapes: `{type:'full'}`, `{type:'selected'|'single',companies:[...]}`, `{type:'template',codes:[...]}`; a scope that names nothing returns nothing.
- Core: `staff`, `profiles`, `has_perm`, `log_activity`, `notify_owner`, `set_user_permission`, `settings`.

**Provides:** nothing to other modules yet.

**Foundation requests (§3.3), none blocks the start**
1. Offline outbox (OD-6): small IndexedDB helper plus a sign-out hook that warns about unsent counts (AUD-9). Blocks the counting slice.
2. Barcode libraries: vendor ZXing and ZXing-C++ WASM with hashes in `tools/check-vendor.mjs`, and add `'wasm-unsafe-eval'` to the content security policy. The browser's native `BarcodeDetector` needs neither, so scanning starts with it. Blocks the barcode slice only.
3. `.xlsx` export: built in Audit 3.0 F5 (AUD-15), written by the app itself with no vendored library.
4. Alert wording for `audit.submitted`, `audit.compiled`, `audit.conflict` in `ntfy.ts` and `alerts.js`.
5. New icons if needed; otherwise reuse an existing one as Closing did.

**One-line edits (§3.2):** add `audit` to `MODULE_IDS`, one CSS link in `index.html`, the function folder (if any) in the CI loop.

## 8. Decisions

| ID | Decision | Status |
|---|---|---|
| AUD-1 | Only the owner is Main Auditor; a trusted person may get every audit key as a "Lead" bundle | Accepted (owner default, 16 Nov 2026) |
| AUD-2 | Bundles: Deputy = view, suggest, report, barcode_register, count; Sub = count, individual, barcode_scan, expiry_log | Accepted (default) |
| AUD-3 | Deputies see only engagements they were added to; owner sees all | Accepted (default) |
| AUD-4 | **No blind counting.** Counters see the system quantity | Accepted (owner, 16 Nov 2026) |
| AUD-5 | `price` is the **retail price**; counters see quantities, variance and variance value for their own assignment; `audit.view`, `audit.review`, `audit.report` extend that to all engagements. Cost prices (`inventory.view_cost`) are not used | Accepted (owner, 16 Nov 2026) |
| AUD-6 | No import of audit history; the old app stays open read-only as an archive. Optional one-time load of verified barcodes, racks and templates as reference data only if the owner asks later | Accepted (default) |
| AUD-7 | CSV and print / Save as PDF first; vendor SheetJS only if `.xlsx` is needed | Accepted (default); changed by AUD-15: Excel files are also wanted, written by the app without a vendored library |
| AUD-8 | A submitted count changes only after an owner reopen with a reason; the new submission is a revision, original kept | Accepted (default) |
| AUD-9 | Signing out with unsent counts is blocked until synced; discard allowed after confirmation | Accepted (default) |
| AUD-10 | Username + 6-digit PIN replaces phone + 4-digit PIN; staff request access again | Accepted (default) |
| AUD-11 | Drop legacy Verify Stock; keep the Counting Calculator inside the counting screen | Accepted (default) |
| AUD-12 | Keep the old layout and crimson accent, scoped in `css/audit.css` (as CLS-15 for Closing) | Accepted (default) |
| AUD-13 | Start the brief and the database and domain slices now; real round creation waits for `inventory_products_for_scope` | Accepted (default) |
| AUD-14 | Individual Audit rounds compile automatically on submit so the person can start the next without waiting for the main auditor; no cross-round conflicts are raised between individual rounds (same product on another day or by another person is a normal difference). Other rounds keep manual compile and conflicts. The `audit.compiled` owner alert is not sent for individual rounds | Accepted (owner, 22 Nov 2026) |
| AUD-15 | Exports: both CSV and Excel files | Accepted (owner, 22 Nov 2026, "Excel reports too needed"); Excel written by the app itself, no library |
| AUD-16 | No deleting or renumbering rounds | Accepted (default); nothing built |
| AUD-17 | Attention badges: ready to compile, open conflicts, corrections waiting | Accepted (default); built in F7 |
| AUD-18 | "Lock and start" is one tap with a preview and a confirm | Accepted (default); built in F4 |
| AUD-19 | No warning for the same product in another open round | Accepted (default) |

## 9. Slices (build order)

Each slice ends with `npm run verify`, `bash supabase/tests/run.sh`, the list of changed files and an updated `docs/modules/audit.progress.md`. **PHONE** = the owner tries it on a real phone before the next slice.

1. **A1 Database core** (`0401`): tables for flow, members, rounds, round items, assignments; permission seeds; RLS; lock and assignment functions; error codes. Done when database tests prove refusals (no key, anon, direct write), idempotency and the state machine both ways.
2. **A2 Domain and parity:** port R1–R15 to `domain/` using the 31 old tests as the spec; `audit_compile_round` in SQL; one shared fixture file. Done when JS and SQL agree to the paisa on every fixture.
3. **A3 Shell and Team Access:** manifest, `data/api.js` with error mapping by code, `/audit` hub, `/audit/team` bundles.
4. **A4 Engagements and rounds:** create, scope, auto-split preview, manual move, lock.
5. **A5 Counting and Individual:** count events, outbox, counting screen, submit, Individual Audit, templates. **PHONE 1:** 200 counts in airplane mode, reconnect, none lost or doubled.
6. **B1 Compile and review:** compile, variance review, three difference modes, corrections, conflicts, Force Submit, reopen, recompile. **PHONE 2:** two people, two rounds, end to end.
7. **B2 Final and reports:** Final Snapshot, reports with print / PDF, audit trail view, owner alerts.
8. **C1 Expiry.**
9. **C2 Barcode:** Center, register, verify, conflicts, scanner, scan outbox. **PHONE 3** (needs the Foundation requests).
10. **D Hardening and acceptance:** offline end-to-end test, accessibility, low-end phone, egress review, MODULES.md §11 definition of done. The owner marks the module Accepted.
11. *Later:* Android shell (ML Kit) and widget with a real release signing key.

**Acceptance bars (proposed):** zero `innerHTML` / `eval` / CDN scripts; security tests on every table and function; every legal state move works and every illegal one is refused; browser preview equals SQL result on every fixture including each old test case; replaying count events twice changes nothing; first screen under 2.5 s and navigation under 1 s on a full-inventory round (about 5,900 products); no periodic progress writes; the original count stays readable after resubmission, correction and recompile.

## 10. Handoff

- Start with section 8 (all decided) and section 7 (the one missing interface, `inventory_products_for_scope`).
- Branch `module/audit`, created from `main` at `b7f18c5` (16 Nov 2026). Only this brief is committed; no code, migration or registry row has been added. Updating the `audit` row in `MODULES.md` §7 is a Foundation edit to be done when the brief is accepted.
- Run `npm ci && npm run verify` and `bash supabase/tests/run.sh` before touching anything (MODULES.md §0.1), then give the 10-line summary and wait for "go" on slice A1.
- Lessons to apply from the first migration, from `closing.next-session.md`: distinct error codes (G3), expected-version writes (G5/CLS-13), and database tests for any figure that is stored permanently (G1) before a screen shows it.
- Old-app claims in this brief come from the code and README of `sysalmanyasin/Random` at `b8a7851` (3 Nov 2026); the scanner, most screens and the Android code were not read. Check rules R1–R10 against the running old app while writing A2.
- Security housekeeping: the GitHub token used to push this brief was pasted into a chat. Treat it as exposed and revoke it (see `docs/SECURITY_MODEL.md`, known gaps).
