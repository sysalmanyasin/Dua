# Dua Workspace — brief

Status: Notes integrated on main (Phase 4 of 11 done, 19 Nov 2026); Sheets, offline sync and attachments planned · Owner approval: yes (18 Nov 2026, plan N-1 to N-17 and Foundation requests M-1 to M-10)
Branch history: `module/workspace` merged to main at `468873a` · Migration range: 1100–1199        Prefix: workspace\_        Permissions: workspace.\*

> **New session? Start with [workspace.next-session.md](workspace.next-session.md).** Design of everything not yet built: [workspace.design.md](workspace.design.md). Evidence: [workspace.progress.md](workspace.progress.md).

## 1. Scope

Two productivity tools inside Dua, one module:

- **Notes**: rich-text documents (headings, bold, italic, underline, lists, checklists, links), personal folders, search, autosave, revision history, restore, attachments.
- **Sheets**: workbooks with several worksheets, formulas (`SUM AVERAGE MIN MAX COUNT COUNTA IF AND OR ROUND ABS CONCAT`, same-sheet references), formatting, sort, filter, CSV import/export.
- **Sharing**: each document is private to its owner until shared with named staff as **editor** or **viewer**. Offline editing with safe synchronisation; conflicts are kept and shown, never overwritten.

Not in this module: Manager's private staff notes (`mgmt_staff_notes`, untouched), XLSX, macros, pivot tables, charts, external data, full Excel compatibility, character-by-character co-editing, cross-sheet references (all later phases, each needing approval).

## 2. Old-app source

None. New module.

## 3. Rules (owner decisions, 18 Nov 2026)

- **N-1** id `workspace`, title "Dua Workspace", route `/workspace`, nav order 86.
- **N-2** permissions `workspace.use` and `workspace.create`; no role preset carries either.
- **N-3** access is per document (owner / editor / viewer). A person who can open Workspace sees only what is shared with them. **No admin override.**
- **N-4** break-glass: a logged function lets the pharmacy owner (admin, MFA) reassign a document **only when its owner is disabled**. (Built in a later step.)
- **N-5** only the owner restores revisions; viewers may see the history list (switchable per document, default on).
- **N-6** offline copies of _shared_ documents are opt-in per document; offline window 7 days after the last online check.
- **N-7** sign-out wipes local data but never silently: sync first, or export / stay / discard when offline with unsent work.
- **N-8** sheet storage is hybrid: cell table keyed by stable row and column ids, an append-only operation log, and snapshots.
- **N-9** limits: 20 sheets per workbook; 10,000 rows × 100 columns; 50,000 cells per workbook; 256 KB per note revision; 10 MB × 20 attachments; 50 members per document.
- **N-10** formulas: the twelve functions above; same-sheet references only.
- **N-11** libraries: ProseMirror core packages (vendored bundle), a custom virtualized grid, a custom formula engine. HyperFormula is not used (GPL-3.0-only).
- **N-12** attachments: allowlisted types, download only, no inline preview.
- **N-13** Realtime is a "something changed" nudge only; polling always works.
- **N-14** migration range 1100–1199.
- **N-15** migrations are applied to the shared project by hand after the phase gate, tested locally first.
- **N-16** the formatting baseline is restored in its own commit before Workspace work.
- **N-17** each phase merges only after its gate and a separate owner "go".

Rules that follow from MODULES.md and are not up for change in this module: reads under RLS; every write through a `security definer` function with an idempotency key; one decision function (`workspace_role`) decides access; no `eval` / `new Function`; no `innerHTML`; only vendored libraries.

## 4. Structure

Built in `1100_workspace_core.sql` (Phase 2):

| Table | Purpose |
|---|---|
| `workspace_documents` | One row per note or workbook: kind, title, owner (staff), version counter, archive / soft-delete stamps. Rows are never removed. |
| `workspace_members` | Sharing: editor or viewer per person per document. The owner is not a row here. Maximum 50 per document. |
| `workspace_folders` | A person's own folders (maximum 5 deep, 500 each). |
| `workspace_user_state` | A person's own flags per document: folder, pinned, "keep offline", last opened. |
| `workspace_save_keys` | Answers a retried save. Service role only. |

Functions: `workspace_my_staff_id`, `workspace_role` (the only access decision), `workspace_can_read`, `workspace_can_write`, `workspace_is_owner`; internal `workspace_staff_eligible`, `workspace_idem_get/put`, `workspace_note_valid` / `workspace_note_node_ok` (rich-text format check); public `workspace_create_document`, `workspace_list_documents`, `workspace_document_state` (archive / unarchive / delete / undelete), `workspace_share_candidates`, `workspace_member_set`, `workspace_member_remove`, `workspace_transfer_ownership`, `workspace_folder_save`, `workspace_folder_remove`, `workspace_state_set`.

Built in `1101_workspace_notes.sql` (Phase 3):

| Table | Purpose |
|---|---|
| `workspace_note_revisions` | Every saved version of a note: restricted JSON content (checked by the database), plain text for search, kind (`create`, `edit`, `merge`, `restore`), sealed flag. A person's own newest version stays open and is updated in place for 5 minutes (autosave); it is sealed when someone else saves, after 5 minutes, on restore or on "save version". Sealed versions never change and nothing is ever deleted. |
| `workspace_conflicts` | Text that lost a race: kept until someone resolves it. Sheets use the same table in `1103`. |

Functions: `workspace_note_open`, `workspace_note_save` (needs the version the editor started from; a stale base is **never** applied, it is stored as an open conflict and reported), `workspace_note_restore` (owner only; writes a new version), `workspace_note_history` (no text), `workspace_member_list` (names, for the sharing screen), `workspace_document_rename` and `workspace_document_set_history_visible` (owner only), `workspace_conflict_resolve`, `workspace_search_notes`; internal `workspace_note_plain_text`, `workspace_note_node_text`, `workspace_can_read_revision`.

Browser code built in Phase 3 (no screens yet): `domain/validation.js` (note format, mirrors the database rules; `tests/fixtures/workspace-note-cases.json` holds the shared cases and `tools/workspace-note-cases.mjs` turns them into `supabase/tests/1101_workspace_note_cases_test.sql`, so browser and database are checked against the same list), `domain/permissions.js`, `domain/revisions.js`, `domain/documents.js`, and the data layer `data/api.js`, `documents.js`, `sharing.js`, `notes.js`, `revisions.js`.

Planned (design: `workspace.design.md`): `1102` sheets, cells, styles, operations, snapshots; `1103` sheet conflicts, pull, Realtime publication; `1104` attachments and Storage policies.

Rich-text format: `{"v":1,"doc":{"type":"doc","content":[...]}}` with only the nodes `paragraph heading(1–3) bullet_list ordered_list list_item task_list task_item text hard_break` and marks `bold italic underline link(http, https, mailto, tel)`. Every top-level block has `attrs.id`. Maximum 256 KB and 8 levels of nesting.

## 5. Permissions

| Key | Allows | Role presets |
|---|---|---|
| `workspace.use` | Open Workspace; read and work on documents shared with you | none |
| `workspace.create` | Create documents; share them; receive ownership | none |

Per-document rights (owner / editor / viewer) are in the matrix in the plan and are enforced by `workspace_role()`, not by these keys alone. The pharmacy owner (admin) holds both keys at MFA level 2 but sees only documents shared with them.

## 6. Screens (layout)

Two routes (`js/modules/workspace/manifest.js`), both needing `workspace.use`:

- `/workspace` — **home**: New note, New folder, search (titles and note text), tabs All / Mine / Shared with me / Archived / Trash, personal folder chips, one row per document (title, kind, owner, last edited, your role, a "move to folder" box). "New workbook" is shown disabled with a note: Sheets arrive later.
- `/workspace/note` — **one note**: back link, title (owner edits it), a status pill (Saved / Unsaved changes / Saving / Offline / Needs your attention), Share (or "Who has access"), History, Save version, Archive and Delete (owner), a formatting toolbar (H1 to H3, bold, italic, underline, bulleted, numbered and checklists, link, undo, redo) and the editor. Viewers and archived notes get no toolbar and a read-only editor.
- Dialogs (`ui/panel.js`): sharing, history with preview and restore, confirmations. On a phone they are bottom sheets; the toolbar scrolls sideways; all inputs are 16 px so iOS does not zoom.

**Deviation from the plan (router):** the router only accepts exact paths made of letters, digits, `/`, `_` and `-` and carries no ids, so `/workspace/note?id=…` is impossible. The open note's id is kept in session storage (`dua.workspace.open`, cleared at sign-out with the other `dua.` keys). Consequences: reloading the tab reopens the same note; there are no shareable deep links yet. A small router change (a route with an id segment) would fix that; it is a Foundation file and is **not** requested yet.

Editing: ProseMirror (vendored, `vendor/workspace/`) with a schema that allows exactly the note format, so the editor cannot produce a note the database would refuse; pasted content is reduced to what the format allows (scripts, images, styles and unsafe links are dropped). Typing in `# `, `- `, `1. ` or `[] ` at the start of a line starts a heading or list. Autosave runs 1.5 s after typing stops; a save that fails in transit is resent with the **same** operation id and content before anything newer, so a lost reply can never make a person conflict with their own earlier save. Until offline editing exists (Phase 8), unsaved text is also kept in session storage and offered back after a reload.

Conflicts (Phase 4 version): when someone else saved first, autosave stops, the person's text is already stored on the server as an open conflict, and a banner offers **Keep my version on top**, **Use the latest version** (asks first) and **Copy my text**. The side-by-side Compare and automatic block-level merge arrive in Phase 9.

## 7. Interfaces

Provides none and consumes none. Reads core only (`staff`, `profiles`, `has_perm`, `log_activity`).

Requests to Foundation (approved by the owner acting as Foundation, 18 Nov 2026; each is carried out in the phase that needs it):

| # | Request | Needed by |
|---|---|---|
| M-1 | Range 1100–1199 and the Invoice Desk range recorded in MODULES.md (done); registry kept by hand with repo numbers | Phase 2 |
| M-2 | `workspace.use` added to the kept offline permissions (`js/core/offlineContext.js`) | Phase 8 |
| M-3 | Sign-out cleanup hook (`js/core/cleanup.js`, `signOut()` awaits hooks) | Phase 8 |
| M-4 | CSP `wss://*.supabase.co` only if a prototype proves it is needed; Realtime publication | Phase 9 |
| M-5 | Private bucket `workspace-attachments` | Phase 10 |
| M-6 | Service worker registration and precache for Workspace | Precache list regenerated in Phase 4 (done); registering the worker for Workspace is Phase 8 |
| M-7 | `storage` stub for database tests | Phase 10 |
| M-8 | ProseMirror set, exact versions, bundling option (a): one-off bundle committed with its hash | Done in Phase 4 (`vendor/workspace/`, see `build/BUILD.md`) |
| M-9 | Formatting baseline restored (done, separate commit); new Edge Function in the CI loop | Phase 10 |
| M-10 | Database security design (this brief and the plan, sections E and F) | Phase 2 |

## 8. Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Final design and prototypes | Done as the plan; prototypes still to run before Phases 4 and 9 |
| 2 | Database core: `1100_workspace_core.sql` | Done; applied to the shared project 18 Nov 2026 |
| 3 | Notes backend (`1101`), domain and data layers | Built and tested; see progress file for the live status |
| 4 | Notes editor, sharing and history screens, home page, module registered | Done and merged to main 19 Nov 2026; needs a real-phone check by the owner |
| 5 | Workbooks and grid (`1102`) | Next |
| 6 | Formula engine | Planned |
| 7 | Formatting, sort, filter, CSV | Planned |
| 8 | IndexedDB and offline queue | Planned |
| 9 | Synchronisation and conflicts (`1103`) | Planned |
| 10 | Attachments (`1104`) | Planned |
| 11 | Integration, security review, acceptance | Planned |

Kill switch at any time: the `modules_disabled` setting. Database rollback is fix-forward with a new migration in the range.
