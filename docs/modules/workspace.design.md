# Dua Workspace — design for the parts not built yet

Written 19 Nov 2026 so a new session can continue without the original planning conversation. Approved by the owner on 18 Nov 2026 (decisions N-1 to N-17 in `workspace.md`). Notes (Phases 2–4) are built; this file covers **Phases 5–11**: Sheets, formulas, offline editing, synchronisation, attachments and acceptance. Where this file and `workspace.md` disagree, `workspace.md` and the code win, and this file should be corrected.

Tags: **[V]** verified in the repository or live project; **[A]** design choice; **[?]** not verified (open question).

## 1. Principles (do not trade these away)

1. Security before convenience. The database decides access (`workspace_role()`); buttons only hide things.
2. No silent data loss. Never overwrite a concurrent edit; keep the loser as a conflict. Never delete unsent work without telling the person.
3. Local-first editing with a durable outbox; Realtime is a nudge, never the only way to sync.
4. No `eval` and no `new Function` anywhere; formulas are parsed into a tree and evaluated by our own code.
5. No runtime CDN; third-party code is vendored and hash-checked (decision D-43).
6. Small, reviewable increments; each phase has a gate (tests pass in CI, acceptance criteria met, owner says go).
7. Do not touch other modules or existing migrations. Foundation files only through the approved requests (section 10).

## 2. Limits (owner decision N-9)

20 sheets per workbook · 10,000 rows × 100 columns per sheet · 50,000 non-empty cells per workbook · formula length 1,000 characters · string cell 32,767 characters · CSV import 5 MB · note revision 256 KB · attachments 10 MB each, 20 per document · 50 members per document. Allowed attachment types: PDF, PNG, JPEG, WebP, TXT, CSV, DOCX, XLSX; download only (no inline preview, which avoids a CSP change).

## 3. Sheets storage (Phase 5, migration `1102`)

**Decision (N-8): hybrid.** The cell table is the current truth; an append-only operation log gives ordering, idempotency and history; snapshots give restore points. Rejected: one JSON blob per workbook (rewrites everything per edit, no per-cell conflicts), log-only (slow to open, hard to test), snapshot-plus-log without a cell table (cannot query or page cells).

**Stable row and column ids.** Cells are keyed by `(sheet_id, row_id, col_id)`; ids are small integers allocated per sheet and never reused. Each sheet stores the visible order as arrays `row_order int[]` and `col_order int[]`. Inserting, deleting or moving rows or columns changes only those arrays; a cell edit made offline against `(row_id 17, col_id 3)` stays valid when someone inserts a row above it. Operations are **anchor-based** ("insert two rows after row_id 17"), never index-based, so no operational transformation is needed. Formulas keep A1 text; structural operations carry the rewritten formulas in the same batch (the browser shifts references; the server only stores). Deleting a referenced row turns the reference into `#REF!`.

Tables (all with RLS, SELECT-only grants, every write through a function; follow `1100`/`1101` for style):

| Table | Columns (types) | Notes |
|---|---|---|
| `workspace_sheets` | `id uuid pk`, `document_id fk`, `name text 1–31`, `position int`, `row_order int[]`, `col_order int[]`, `next_row_id int`, `next_col_id int`, `row_sizes jsonb`, `col_sizes jsonb`, `frozen_rows int`, `frozen_cols int`, `created_at`, `deleted_at` | unique `(document_id, lower(name)) where deleted_at is null`; checks `cardinality(row_order) <= 10000`, `cardinality(col_order) <= 100` |
| `workspace_cells` | `sheet_id fk`, `row_id int`, `col_id int`, **pk of the three**, `value jsonb` (number, string or boolean; null for empty or formula), `formula text <= 1000`, `style_id int`, `last_seq bigint`, `updated_by` | not both value and formula; index `(sheet_id, last_seq)` for delta pulls; **computed results are never stored** |
| `workspace_sheet_styles` | `sheet_id`, `style_id int`, `style jsonb`, pk both | validated by a `workspace_style_valid` function (whitelisted keys: weight, size 8–72, colours `#rrggbb`, borders, alignment, number format) |
| `workspace_operations` | `document_id fk`, `seq bigint` (pk with document), `op_id uuid`, unique `(document_id, op_id)`, `device_id`, `actor_user`, `op_type`, `base_seq`, `payload jsonb <= 256 KB`, `status` (applied, conflict, rejected), `result jsonb`, `applied_at` | append-only trigger (copy `activity_log_immutable`); `op_type` ∈ set_cells, set_style, insert_rows, delete_rows, move_rows, insert_cols, delete_cols, move_cols, resize, add_sheet, rename_sheet, delete_sheet, reorder_sheets, duplicate_sheet, sort_range, restore_snapshot |
| `workspace_sheet_revisions` | `id`, `document_id`, `seq`, `kind` (checkpoint, manual, pre_restore), `label`, `snapshot jsonb <= 8 MB`, `bytes`, `created_by`, `created_at` | immutable; auto-checkpoint every 200 applied operations or 24 h of activity; keep last 20 automatic + all manual + one per day for 30 days; operations older than 90 days that precede the oldest kept snapshot may be pruned by a maintenance function |
| `workspace_conflicts` | already exists (`1101`) | kinds `cell`, `target_deleted`, `structure` are already allowed by its check |

Also in `1102`: add `alter function … set search_path = public` for the four trigger-guard functions (Supabase advisor follow-up) and drop nothing.

Functions (each re-checks `workspace_role()` and takes an idempotency key where it writes): `workspace_apply_ops(p_doc, p_ops jsonb)` (≤ 200 operations in one transaction), `workspace_pull(p_doc, p_since_seq, p_limit)`, `workspace_load_sheet(p_sheet, p_cursor)` (paged cells), `workspace_snapshot_create`, `workspace_sheet_restore` (**owner only**; writes a `pre_restore` snapshot, then a `restore_snapshot` operation that stamps all touched cells with a new `last_seq`). Roles: owner and editor write; viewers read; only the owner restores (matrix in `workspace.md` §5). Archived workbooks are read-only. Workbook rename reuses `workspace_document_rename`.

## 4. Applying operations (`workspace_apply_ops`)

One transaction per batch:

1. Lock the document row (`for update`) — this serialises writers per document and gives the next `seq`.
2. Role check (owner or editor, not archived, not deleted); otherwise return `rejected` for every operation without touching data.
3. For each operation in order: if `(document_id, op_id)` exists, return its **stored** result (`duplicate`); else validate shape and limits (`rejected_invalid`); then apply:
   - `set_cells`: per cell compare `cell.last_seq` with the cell's `base_seq`. If `last_seq <= base_seq`, or the stored content already equals the incoming content, write it with the new `last_seq`. Otherwise it is a **cell conflict**: nothing is written for that cell and a `workspace_conflicts` row records server and local content. Different cells never conflict.
   - Structural operations apply to the order arrays using anchors; a deleted anchor is a `structure` conflict. Operations aimed at a deleted sheet, row or column are `target_deleted` conflicts (the local content is kept).
4. Insert the operation with its status and result and the next `seq`; set `documents.head_version`.
5. Return `{ results: [{ operation_id, status, seq, conflict_id? }], head_seq }`; create a snapshot when due.

A workbook restored while someone is offline turns that person's stale edits to restored cells into conflicts, not silent losses (the restore stamps cells with a new `last_seq`).

## 5. Offline and synchronisation (Phases 8 and 9)

Local store: one IndexedDB database `dua-workspace`, every row tagged with `user_id`: `docs` (metadata, last known version, role, offline flag), `notes`, `cells` (sparse per sheet), `outbox`, `conflicts`, `meta` (user id, device id, last sync). A document is written locally **before the screen says Saved**. If IndexedDB is unavailable the app says so and refuses offline saving. Reuse the shape of `js/modules/audit/data/outboxStore.js` and eBill's "persist before acknowledging" rule [V].

Operation envelope (also the shape sent to the server): `operation_id`, `document_id`, `user_id` (informational; the server uses `auth.uid()`), `device_id`, `operation_type`, `base_version`, `payload`, `created_at`, `status` (pending, sending, applied, conflict, rejected_permission, rejected_deleted, rejected_invalid). Per-document first-in-first-out. Typing is coalesced (one pending operation per cell or note within 2 s) but a coalesced operation is stored before it is sent.

Client loop (on `online`, app start, a Realtime nudge, and every 60 s): **push** (≤ 200 operations or 256 KB) → handle results → **pull** (`workspace_pull(since_seq)`), apply to the local copy, rebase remaining pending operations (cell operations need no transformation thanks to stable ids). Retry with exponential back-off 2 s → 5 min plus jitter. An operation is deleted locally only after the server confirmed it. The note path already follows this: see `domain/autosave.js` (same operation id resent until answered).

| Case | Behaviour |
|---|---|
| Network lost mid-upload | the same operation ids are resent; the server returns the stored outcome |
| Duplicate delivery | `(document_id, op_id)` is unique; the stored result is replayed |
| Permission revoked while offline | `rejected_permission`; the document moves to a **Recovery** area: unsent operations kept, document read-only, banner "You no longer have access", button to export unsent changes (JSON/CSV/text) |
| Document deleted or archived | `rejected_deleted`; same Recovery handling |
| Account switch on one device | local rows carry `user_id`; another user's data is never shown; wiped only through the sign-out gate |
| Different cells edited concurrently | both apply |
| Same cell edited concurrently | first to arrive wins; the second becomes a conflict the person resolves |
| Note edited by two people | `base_version` mismatch → conflict row (built); Phase 9 adds block-level merge and Compare |

Conflict screens (Phase 9): notes use a three-way merge by top-level block id (ancestor, server, mine) — if blocks changed on only one side, merge automatically and save a `merge` revision, otherwise open **Compare** with Keep mine / Keep theirs / Keep both. Sheets get a **Conflicts** panel listing cells (label like `C7`, their value, my value) with per-cell and bulk Keep mine / Keep theirs; "Keep mine" re-sends with the current `base_seq`. A badge on the document list and a warning in the status pill show open conflicts. **Never choose automatically for the same cell or block.** (Block ids already exist: `domain/editorModel.js` keeps and de-duplicates them.)

Realtime (Phase 9): publish only `workspace_documents` head changes (payload `(id, head_version)`); on a nudge the client pulls. Needs a migration adding the table to the `supabase_realtime` publication and, **if a browser prototype shows it is needed**, `wss://*.supabase.co` in the CSP `connect-src` (Foundation). Realtime is not used anywhere in the repository today [V]. If it fails, the 60 s poll still works. Whether Supabase stops delivering to a user the moment a membership row is deleted is unverified [?]; the design never depends on it.

Sign-out (Foundation request M-3, approved, not built): add `js/core/cleanup.js` with `onSignOut(fn)`; `signOut()` awaits the hooks (5 s timeout each, with an explicit "discard and sign out") before `auth.signOut()`. The Workspace hook: outbox empty → delete the whole local database; pending operations and online → sync first, then delete; pending operations and offline → **block sign-out** with *Export unsent changes*, *Stay signed in* or *Discard and sign out*. Never silent deletion. Owner decision N-6: offline copies of **shared** documents are opt-in per document, with a seven-day offline window after the last online check; N-7: wipe on sign-out, not "keep encrypted on the device". Also needed (M-2): add `workspace.use` to `KEPT` in `js/core/offlineContext.js` [V: today only `ebill.use` is kept] so Workspace can start offline; and register the service worker for Workspace (today only Emergency Billing registers it) [V].

## 6. Formula engine (Phase 6, pure code in `domain/formulas/`)

`lexer.js` → `parser.js` (tree) → `evaluator.js` with `functions.js` and `dependencies.js`. Functions: `SUM AVERAGE MIN MAX COUNT COUNTA IF AND OR ROUND ABS CONCAT`. Operators: `+ - * / ^ &`, comparisons `= <> < > <= >=`, unary minus. References: `A1` and `A1:B9`, **same sheet only** (cross-sheet references are deferred, decision N-10). Errors as values, never thrown: `#REF! #VALUE! #DIV/0! #NAME? #CIRC!`. Circular reference detection (direct, indirect, through ranges). Dependency graph with incremental recalculation. Row and column insert/delete must rewrite references (and turn deleted ones into `#REF!`). Numbers: JavaScript doubles with a documented rounding rule for `ROUND` (half away from zero); text/number coercion rules written down in the module's brief before coding. Tests: fixture file of formula cases (invented numbers), a fuzz test (random input never throws and never reaches `eval`), ESLint already bans `eval`/`new Function`. HyperFormula was rejected: GPL-3.0-only (checked in the npm registry) and the repository has no LICENSE file [V].

## 7. Grid, formatting, sort, filter, CSV (Phases 5 and 7)

Custom DOM-virtualised grid (no Tabulator: it is a data-table library; stable ids, per-cell styles and formula references fit poorly). Needs selection and range selection, copy and paste (tab/newline text), row and column insert/delete/resize, keyboard navigation, an ARIA `grid` pattern, and a phone-friendly editing mode. This is the largest and riskiest piece (accessibility and touch). **Fallback if it proves too costly on real phones:** a read-mostly grid with an edit bar for the active cell. Styles are stored once per sheet and referenced by id; formats: weight, size, text and background colour, borders, alignment, number format (general, fixed decimals, currency, percent, date). Sort and filter are view-only unless the person chooses **Sort range**, which is an operation. CSV import with preview, validation, UTF-8/BOM, commas, quotes and line breaks (RFC 4180 parser, 5 MB cap); CSV export must say that CSV keeps only values: no sheets, formatting or live formulas. Out of scope for v1: XLSX, macros, pivot tables, charts, external data, full Excel compatibility, character-level co-editing, cross-sheet references.

## 8. Attachments (Phase 10, migration `1104`)

Private bucket `workspace-attachments` (not the `imports` bucket; no bucket exists in the repository and no Storage code at all [V]); object path `<document_id>/<attachment_id>/<safe_name>`; `workspace_attachments` table (`id`, `document_id`, `object_path` unique, `original_name`, `safe_name` `[a-z0-9._-]` ≤ 80, `mime`, `size_bytes` ≤ 10 MB, `sha256`, `status` pending/ready/deleted, `uploaded_by`, `created_at`, `committed_at`, `deleted_at`). Flow: `workspace_attachment_begin` (editor or owner; validates type, size, count; inserts pending) → upload with the person's own session (Storage policy allows only paths of a document they can write **and** a matching pending row) → `workspace_attachment_commit` (checks the object exists with the declared size) → `workspace_attachment_sign_download` (reader only; signed URL valid 60 s; downloaded by navigation so no CSP change). Cleanup: `pg_cron` calls Edge Function `workspace-storage-cleanup` (service role inside the function only) to remove pending rows older than 24 h and their objects, and objects of purged documents. Attachments are never cached offline in v1. The database test harness has no `storage` schema [V]: ask Foundation (M-7) for a stub in `supabase/tests/stub_auth.sql` or put one inside the Workspace test file. New Edge Function folders need one line in the Deno loop of `.github/workflows/ci.yml`.

## 9. Phases still to do

| Phase | Scope | Files | Database | Gate |
|---|---|---|---|---|
| 1 (open) | Browser prototypes in a **throwaway** copy, not the repo: CSP behaviour, `wss:`, grid scrolling on a real phone | none | none | owner approves findings |
| **5** | Workbooks and grid: sheets, cells, styles, operations, snapshots, `workspace_apply_ops` (online first), stable-id structural operations, grid with selection, copy/paste, resize, keyboard | `1102_workspace_sheets.sql` and test; `domain/spreadsheet.js`; `data/workbooks.js`; `ui/sheets.js`, `ui/workbook.js`; routes `/workspace/sheet` (+ home enable "New workbook") | yes | DB tests for every row of the permission matrix; parity test of JS reference model vs SQL (same operation sequences give same results); scrolling 10,000 × 100 smooth on a real phone; keyboard and touch work |
| 6 | Formula engine (pure code) | `domain/formulas/*` and fixtures | none | all fixtures and fuzz pass; no `eval` |
| 7 | Formatting, sort/filter, CSV | `domain/formatting.js`, `domain/csv.js`, UI | small (style validation function) | CSV edge-case suite; formats match fixtures |
| 8 | IndexedDB local store, outbox, offline create/edit, sign-out hook wiring, service worker registration | `data/localStore.js`, `data/outbox.js`, `data/cleanup.js`, `ui/recovery.js`; Foundation: M-2, M-3, M-6 | none | `fake-indexeddb` tests; kill-tab and reload test; real phone in aeroplane mode |
| 9 | Synchronisation and conflicts: pull, resolve, merge and Compare screens, Realtime nudge | `1103_workspace_sync.sql`, `domain/conflicts.js`, `ui/conflicts.js`; Foundation: CSP if needed (M-4) | yes | concurrency DB tests; two-device manual test; polling-only fallback works |
| 10 | Attachments | `1104_workspace_attachments.sql`, `data/attachments.js`, Edge Function; Foundation: M-5, M-7, CI line | yes | Storage policy tests; type, size, limit tests; revoked-access download refused |
| 11 | Integration, security review of every policy and function, full regression, accessibility pass, low-end-phone tests | docs | none | all green in CI; owner phone try-out; owner marks Accepted |

Kill switch at any time: the `modules_disabled` setting. Database rollback is fix-forward with a new migration in 1100–1199 (never edit an applied migration).

## 10. Foundation requests (approved by the owner acting as Foundation on 18 Nov 2026)

| # | Request | State |
|---|---|---|
| M-1 | Range 1100–1199; Invoice Desk range recorded; registry kept by hand with repo numbers | done |
| M-2 | `workspace.use` in `KEPT` (`js/core/offlineContext.js`) | open, Phase 8 |
| M-3 | Sign-out cleanup hook (`js/core/cleanup.js`, `signOut()` awaits hooks) | open, Phase 8 (also solves Audit's AUD-9) |
| M-4 | CSP `wss://*.supabase.co` only if a prototype proves it is needed; Realtime publication | open, Phase 9 |
| M-5 | Private bucket `workspace-attachments` | open, Phase 10 |
| M-6 | Precache list regenerated | done in Phase 4; registering the worker for Workspace is Phase 8 |
| M-7 | `storage` stub for DB tests | open, Phase 10 |
| M-8 | ProseMirror vendored bundle | done in Phase 4 |
| M-9 | Formatting baseline; new Edge Function in the CI loop | baseline done; CI line open, Phase 10 |
| M-10 | Database security design sign-off | done |
| **new, not requested** | Router: a route with an id segment (shareable links) | optional; D-44 |

## 11. Main risks still open

| Risk | Severity | Mitigation |
|---|---|---|
| Sync or conflict bug loses or overwrites data | high | server never overwrites a stale base; conflicts stored; outbox kept until confirmed; parity tests between a JS model and the SQL; two-device manual test |
| A policy mistake exposes another person's document | high | one decision function; every table tested directly with every role; policy review in Phase 11; no admin override |
| Private data left on a shared phone | high | sign-out hook; opt-in offline for shared documents |
| One Supabase project is both testing and live (OD-5) | high | test locally first; apply by hand only after the gate; compare function hashes afterwards (D-47) |
| Custom grid weak on phones or for accessibility | medium | real-device checks every phase; ARIA grid; fallback grid |
| Formula edge cases | medium | fixtures, fuzz, small function set, errors as values |
| Free-plan limits (database size, Storage egress, Realtime connections) | medium | hard limits in section 2; snapshot retention and operation pruning; check quotas before Phases 9 and 10 (OD-7) |
| CSP blocks the Realtime WebSocket | medium | prototype first; polling-only fallback |

## 12. Owner decisions still open or to confirm

- Phase 1 browser prototype results (CSP, `wss:`, grid on a phone) before Phases 5 and 9.
- Whether to ask Foundation for the router change (shareable links to notes and workbooks).
- Whether editors may rename documents (today owner only, per the approved matrix).
- Whether to build the break-glass reassignment for documents whose owner is disabled (approved in principle, N-4; not built).
- Who gets `workspace.use` and `workspace.create` first.
