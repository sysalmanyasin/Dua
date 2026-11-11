# Closing — plan for the next session

Written 11 Nov 2026, after re-reading `main` (commit `e635e23`) and the `module/closing` branch (commit `3592512`).
Read `docs/MODULES.md` and `docs/modules/closing.md` first. This file is the **work order**; the brief is the **specification**.

---

## 1. Where things stand

| Item | State |
|---|---|
| Branch `module/closing` | 1 commit on top of old `main` (`5856249`). `main` has moved 3 commits since (inventory feed F3, Sales reports, documentation set). **Merging `main` into the branch is clean** (tried; no conflicts). |
| Tests on the merged code | `npm run verify`: 258 pass (28 files). `bash supabase/tests/run.sh`: all pass with migrations `0001`–`0010` + `0201`–`0202`. |
| Built (database) | `0201_closing_tables.sql` (15 tables, RLS, lock triggers, `closing_calc`, `closing_compute`, internals) and `0202_closing_flow.sql` (`closing_save_draft`, `closing_submit`, `closing_correct`, carry-forward). |
| Built (browser) | `js/modules/closing/domain/compute.js` only (pure maths, integer paisa). **No manifest, no screens, no module registration.** |
| Not applied to the live Supabase project | Correct: nothing in the `02xx` range is applied anywhere except local test databases. Applying is a separate step (see §2, item 5). |
| Not tried on a phone | Nothing to try yet (no screens). |
| Owner decisions in | CLS-4 (credit lines are per-shift new amounts), CLS-5 (thermal receipt stays). |
| Owner decisions still open | CLS-6, CLS-7, CLS-8 (in the brief) and the new ones in §3 below. |

### What changed on `main` that matters to Closing

- **F3 inventory feed is live** (`0009`), but the published interfaces are **not**: `inventory_balances(p_codes)` (needed for the audit card) does not exist yet (Inventory slice I4). Only `inventory_latest_sync()` exists.
- **F4 (`notify_owner`) does not exist.** `closing_submit` already calls it by name if it is there (see §6.4), so nothing to change until F4 ships; check its real signature then.
- **Migration registry problem (D-35).** The live project's migration list does not match the repo, so new migrations do **not** apply automatically. Each is applied **by hand** with `docs/RUNBOOK.md` §4 and registered under its repo version. Never let a tool invent a timestamp version.
- Sales now has `print.js` (`printThermal`, `receiptLine`), `mailDialog.js`, Reports with landscape print / Save as PDF, and a documented page pattern. Closing may **not** import from the Sales module; copy what you need inside `js/modules/closing/` or raise a Foundation request (MODULES.md §3.3).
- Sign-out already wipes every browser-storage key that starts with `dua.` or `sales.` (`js/core/auth.js`). **Store closing drafts under `dua.closing.draft.<key>`** and they are wiped on sign-out with no Foundation request.

---

## 2. Before writing any feature code (housekeeping)

1. **Merge `main` into `module/closing`** (`git merge origin/main`), then `npm ci && npm run verify` and `bash supabase/tests/run.sh`. Both must pass. If not, stop and tell the owner.
2. Run the session start protocol of MODULES.md §0.1 (10-line summary, wait for "go").
3. The owner pasted a GitHub token in an earlier chat. Ask whether it was revoked (ROADMAP A4). Never paste or store a token in files.
4. This environment cannot push without a token. Either the owner links GitHub under claude.ai Settings → Connectors, or commits the listed files himself (MODULES.md §0.2.3). List every changed file at the end.
5. **Do not apply `0201`/`0202` to the live project in this session** unless the owner says so. When he does: RUNBOOK §4 step 3 (hand-apply, register under `0201`/`0202`), then check RLS on every new table and that `anon` has no grants.
6. Local database for tests: `pg_ctlcluster 16 main start`, make sure a superuser role exists for the shell user, then `bash supabase/tests/run.sh` from `supabase/tests`. If a test run prints nothing, the database is not running (it stops when the container idles).

---

## 3. Questions for the owner (ask first, in one message; do not guess money rules)

Open from the brief:

| ID | Question | Built as today |
|---|---|---|
| CLS-6 | If the slot just before was never closed (e.g. Morning skipped), what does the next closing carry? | Carries from the latest earlier **submitted** closing (the old app carried zeros) |
| CLS-7 | When an earlier closing is corrected, do later **submitted** closings change? | No; they keep what they were submitted with. Later drafts pick up the correction on next save |
| CLS-8 | `closing.require_inventory_audit` ships **on**, so nobody can submit until the audit card exists | Owner may switch it off with a reason during rollout |

New from this review:

| ID | Question | Suggested default |
|---|---|---|
| CLS-9 | Closing Book PDF: the old app used jsPDF + html2canvas (not vendored in Dua). Add them (Foundation request, new vendored files), or use the browser's **Save as PDF** from a print layout like Sales Reports? | Print layout (no new library) |
| CLS-10 | Opening balances: how should the first closing get its carried values (card, credit, deposits, cash, open misc charges)? | A small admin-only table `closing_opening` (one row per start point) that `closing_apply_carry` reads when no earlier submitted closing exists. Not a fake closing |
| CLS-11 | Which slot kinds may be a **Final** closing? What exactly does Final reset? (BUSINESS_RULES §5–6 and old `pullPreviousShift`.) | Any slot may be Final; Final starts cash and deposits at 0, keeps credit, card and open misc. Confirm |
| CLS-12 | At submit, if an earlier closing was submitted since the cashier last saved, the carried-in figures can change under them. Silently use the new ones, or refuse and ask them to look again? | **Refuse** with "opening figures changed, review and submit again" |
| CLS-13 | Two devices (or tabs) editing the same draft: last save wins today. Refuse the older save instead, like the Daily Check List does? | Refuse (conflict message, reload) |
| CLS-14 | Who can pick the "responsible person"? Which staff appear in the list? | Any **active** staff member, chosen by name; shown through a small function, not by letting juniors read the whole `staff` table (check what they can read today) |

---

## 4. Review of what already exists (honest list; fix in this order)

| # | Severity | Gap | What to do |
|---|---|---|---|
| G1 | **High, before any real submit** | Stored `final_net_sale`, `final_net_cash` for **Shift** closings are wrong today: the "since last Final" roll-up (`agg`) is empty, so they equal this shift alone. `closing_results` is append-only (D-12), so wrong values would be permanent. | Build `closing_period_agg(closing)` (SQL) from the old `aggregateSinceLastFinal` (old repo `js/actions.js` around line 543; fixture case H shows the fields), call it from `closing_build_input`, add DB tests with a multi-shift period, and a parity test of the SQL roll-up against the fixture. Until then, do not let any screen or real submission rely on those two numbers |
| G2 | **High** | `closing_submit` re-runs carry-forward just before freezing, so the numbers the cashier reviewed can change silently. | Implement CLS-12 (refuse when carried values differ from what the draft had) with a DB test |
| G3 | High | A new database error message is the only way the browser can tell cases apart (`closing is locked`, `inventory audit not verified`, …). Matching text is brittle. | Migration `0203`: use distinct custom SQLSTATE codes (e.g. `CL001`…) or `hint` for every refusal the UI must explain; keep the English message for logs. Update tests. Do this **before** `data/api.js` is written |
| G4 | Medium | **No opening balances.** The first closing starts from zero. | CLS-10: table + admin-only logged RPC + test; `closing_apply_carry` falls back to it |
| G5 | Medium | Draft saves are last-write-wins. | CLS-13: add `p_expected_updated_at` to `closing_save_draft`; mismatch raises a conflict code; copy the conflict pattern from the Daily Check List (`sales/ui/checklist.js`) |
| G6 | Medium | Carry rules not yet cross-checked line by line against the old `pullPreviousShift` (`js/actions.js` ~330–420, 480–500) | Before the carry screens, write a short table in the brief: item → carried in shift mode → carried in Final mode → source in old code. Confirmed so far: **misc rows carry in both modes** (old comment at `actions.js:390`), and are **not** re-carried when an old closing is reopened. Check the same for card (CC), credit, deposits, cash, HS rows, strips |
| G7 | Medium | Responsible-person list (CLS-14) and "my drafts / my recent closings" list have no function yet. | Small read functions in `0203`, tested for isolation |
| G8 | Low | `closing_amt` accepts negative numbers everywhere. Some are legitimate (adjustments, returns shown negative). | UI validation per field; add a DB range check only where the rules say a value can never be negative |
| G9 | Low | No "discard draft" function. | Add only if the owner wants it |
| G10 | Info | Fixtures were hand-worked and the DB and JS agree on all 9 cases, but the **old app was never run** on them (its maths is tied to the page). | Keep the hand derivations in the test file comments; if the owner can supply 3–5 real closings' printed totals (figures can be made up if he prefers), add them as extra cases |

---

## 5. Slice plan

Each slice ends with: `npm run verify`, `bash supabase/tests/run.sh`, files listed, progress file updated. Slices marked **PHONE** need the owner to try them on a real phone before the next one starts.

### Session A (the next session): hardening + first working screens

| Step | Scope | Files (all inside MODULES.md §3.1/§3.2) | Done when |
|---|---|---|---|
| A0 | Housekeeping of §2 | — | merged, green |
| A1 | **Hardening migration `0203_closing_hardening.sql`**: G3 error codes, G2 submit guard, G5 expected-version, G7 read functions (`closing_staff_choices`, `closing_my_recent`), G4 `closing_opening` + `closing_set_opening` + carry fallback | `supabase/migrations/0203_*.sql`, `supabase/tests/0203_*_test.sql` (and update 0202 tests if messages change) | DB tests prove each refusal and the happy path; mutation check on G2 and G5 |
| A2 | **G1 period roll-up** `closing_period_agg` in the same or `0204` migration | migration + tests + parity case(s) in `tests/fixtures/closing-cases.json` | multi-shift period test passes; JS and SQL agree |
| A3 | **Module skeleton**: `manifest.js` (id `closing`, nav order 30, routes of the brief), `css/closing.css` + one `<link>` in `index.html`, `closing` in `MODULE_IDS`, `data/api.js` (only file that calls Supabase; `fetchAll` pattern), error mapping from A1 codes, `/closing` start page (list own recent closings, start Night/Morning/Evening/Handover for a date) | `js/modules/closing/**`, `css/closing.css`, `tests/unit/closing-*.test.js` | repo-consistency test passes; page driven in jsdom (see `tests/unit/sales-entry-page.test.js`) |
| A4 | **Guided ledger framework** `/closing/ledger/<slot>`: one section at a time, progress bar, jump-nav, save chip (Saved ✓ · Saving… · Offline, draft kept · Failed, tap to retry), autosave every 3 s to `dua.closing.draft.<key>` and to the database, conflict handling, live preview from `domain/compute.js` | `ui/ledger.js`, `domain/sections.js`, `domain/payload.js`, `domain/draft.js` + tests | a draft saved, reloaded, saved on a second tab (conflict shown) and sign-out wipes the local copy |
| A5 | **Sections 1–5**: POS, MEDIQ, Shift, HS, Strips (copy the layout and field order of the old screens) | `ui/sections/*.js` + page tests | totals shown equal `compute.js`; struck-through rows excluded and still stored |
| **STOP** | **PHONE try-out #1** (owner): create a Night draft, fill sections 1–5, leave and come back, go offline and back | | owner's findings in the progress file |

### Session B: finish the entry flow and submit

| Step | Scope |
|---|---|
| B1 | Sections 6–14 in the old order: Inventory Audit (placeholder until C9), Misc, Card, Till, Vault, Credit (named / tier slots / free rows; **new amounts for this shift**), Deposit, Audit, Final. Variance shown with ▲ ▼ ✓ and a word |
| B2 | End-of-shift summary, responsible-person picker, **submit** with the refusal messages mapped from A1 codes, success screen, idempotent retry |
| B3 | Owner alert on submit when F4 exists (`notify_owner`); otherwise leave the logged TODO. Failure must never block submit |
| **STOP** | **PHONE try-out #2**: a whole Night closing, submitted, then the next Morning picking up the carried values |

### Session C: carry-forward visible, ledgers, feed

C1 carry-forward display and Handover slots and Final-mode screens · C2 opening-balance admin screen · C3 Credit Ledger and Misc Ledger (with aging by `charge_id`), 3" thermal receipt (CLS-5; copy the small `printThermal` approach inside the module) · C4 `closing_credit_feed(p_after timestamptz)` for Manager (design in §7) · **PHONE try-out #3**.

### Session D: books, review, settings

D1 Closing Book (flip-through, ranges, jump to date, PDF per CLS-9), Register Book, history tabs CC / RBD / MEDIQ (CC is Evening-only) · D2 `/closing/review` and corrections UI over `closing_correct` · D3 `/closing/settings`: strips, credit accounts, tiers, audit codes, thresholds. `till_float` and `per_customer_charge` live in core `settings`, whose `settings_set` needs `settings.manage`; either ask Foundation or add a narrow wrapper `closing_settings_set(key, value, reason)` that allow-lists those two keys, checks `closing.settings`, and writes the same history and log rows · **PHONE try-out #4**.

### Session E: inventory audit card and acceptance

Needs Inventory's `inventory_balances(p_codes text[])` (slice I4). Seed the 31 audit codes from the old `AUDIT_CODES` in `js/inventory-audit.js` (item codes only; check they contain no business amounts). Card syncs, shows "data as of", freezes a verified snapshot inside the closing. Then switch `closing.require_inventory_audit` on for real use, run the full definition of done (MODULES.md §11), and ask the owner to mark the module Accepted.

---

## 6. Facts the next session must not have to rediscover

### 6.1 Functions that exist today

| Function | Who may call | Notes |
|---|---|---|
| `closing_save_draft(p_key uuid, p_date date, p_kind text, p_mode text, p_payload jsonb, p_handover_seq int default null)` | `closing.enter_own` | Creates the slot and the draft on first save; idempotent on `p_key`; returns `{closing_id, slot_id, status, updated_at}`. Date must be between 2000-01-01 and tomorrow (Karachi) |
| `closing_submit(p_key uuid)` | owner of the draft | Needs responsible staff; needs a verified audit row unless setting `closing.require_inventory_audit` is false; writes the result once; logs; retry returns `already: true` |
| `closing_correct(p_closing uuid, p_reason text, p_changes jsonb, p_key uuid)` | `closing.correct` | New revision, original becomes `superseded`; `credit line_id` and `charge_id` stay the same; reason mandatory; retry with the same key returns the same revision |
| `closing_compute(p_closing uuid)` | anyone who may see that closing | Read-only figures from saved rows |
| `closing_calc(p jsonb)` | signed-in | Pure formula; same input shape as `domain/compute.js` and the fixture |

Internal only (no grants): `closing_build_input`, `closing_write_result`, `closing_apply_payload`, `closing_apply_carry`, `closing_previous`, and the input readers `closing_amt/qty/txt/rows`.

### 6.2 Payload of `closing_save_draft` (all keys optional; a missing scalar keeps the stored value; a present list **replaces** that whole section)

```
responsible_staff_id, sys_cash, last_bill_no, comp_sale, alfalah, keenu,
ret_manual_1..3, ret_system, book_bill_1, book_bill_2, extra_cash, credit_adj, prev_mediq, final_sys_returns,
overrides: { shift_sale, customers, curr_cc, prev_cash }        // null or "" clears an override; a typed 0 is a real override
hs:       [{ label, amount, deleted }]
strips:   [{ strip_id?, label, price, qty, deleted }]
mediq:    [{ bill_no, collected, pharmacy_bill, deleted }]
deposits: [{ label, amount, deleted }]
misc:     [{ charge_id?, label, amount, deleted }]
till:     [8 counts in the order 5000, 1000, 500, 100, 50, 20, 10, 1]   // same for vault
credit:   { named: [{ line_id?, account_id?, label, amount, deleted }],
            tier:  [{ line_id?, label, amount }]   // at most 3
            free:  [{ line_id?, label, amount, deleted }] }
```

The browser must send back the `line_id` / `charge_id` it received, or the stable ids (which Manager relies on) are lost.

### 6.3 Refusals the screens must explain in plain words (today's English messages; becomes codes in A1)

`not allowed` (42501) · `closing is locked` (55000) · `a closing already exists for this slot` (23505) · `date out of range`, `invalid slot kind`, `invalid mode`, `invalid payload`, `this key belongs to another slot`, `responsible staff member not found` (22023) · `invalid amount in <field>`, `amount too large in <field>`, `invalid quantity in <field>`, `invalid rows in <section>`, `invalid cash count in <till|vault>`, `at most 3 tier slots` (22023) · `choose the responsible staff member` (22023) · `inventory audit not verified` (22023) · `a reason is required`, `only the current submitted closing can be corrected`.

### 6.4 Rules already built into the database

- Slot positions: night 10, morning 20, handovers 21–9998 (first 30, then 40…), evening 9999; one live (draft or submitted) closing per slot.
- Carry-forward comes only from **submitted** closings (drafts never carry): credit = previous `debt_e`; deposits and cash = previous `deposits_f` and `liquid` (both 0 in Final mode); card = previous `cc_total` for a Night, otherwise the same day's Night opening card; open misc rows are copied at creation with their `charge_id`.
- `closing_results` stores `till_float` and `per_customer_charge` as used, and is append-only.
- Customers charge = customers × `per_customer_charge` everywhere (old app added the bare count; identical while the charge is 1).
- A shift stores its own `shift_variance`; `final_variance` only in Final mode.
- `closing_submit` calls `public.notify_owner(text, jsonb)` **only if it exists**, inside its own error handler; a failure is logged as `closing.notify_failed` and never blocks the submit. Confirm F4's real signature when it ships.

### 6.5 Phone and design rules (MODULES.md §4.2, §11)

Text ≥ 0.8 rem, touch targets ≥ 44 px, status never colour-only, amounts as `₨ 12,345` through `shared/format.js`, no `innerHTML`, tokens only (navy `#101B2D`, teal `#18A999`, amber `#F2B84B`), safe-area padding, a fresh container per page, heavy libraries only where used. Public repo: **no real staff names, phone numbers or business amounts in code, seeds, tests or docs.**

---

## 7. Design for the credit feed (Session C4; get owner's nod on this shape first)

`closing_credit_feed(p_after timestamptz default null)` — read-only, requires `credit.view`, security definer, no direct table access for Manager.

- Source: credit lines of closings in status `submitted` or `superseded`, **latest revision of each `line_id` only**, excluding struck-through lines and zero amounts, plus the credit adjustment as a pseudo-line using `credit_adj_line_id` when non-zero.
- Columns: `line_id`, `business_date`, `slot_kind`, `slot_seq`, `kind` (named / tier / free / adjustment), `label`, `amount`, `closing_id`, `revision`, `submitted_at`, `changed_after_first` (true when an earlier revision of the same line had a different label or amount), `removed` (true when the latest revision no longer has the line), `account_id`.
- `p_after` filters on `submitted_at`, so a correction (new `submitted_at`) re-emits the lines it touched.
- Lines only, never carried balances (decision C9). Tests: staff and anon refused; a corrected closing shows `changed_after_first`; a removed line shows `removed`; struck lines never appear.

---

## 8. Definition of done for the whole module

MODULES.md §11, plus: G1–G6 fixed; a full week of invented closings (Night, Morning, Handover, Evening, a Final, a correction, a skipped slot) walks through the screens and matches hand-worked numbers; owner has tried it on a phone after each STOP; the brief's Handoff is current; the module row in MODULES.md §7 is updated **by the owner** when he marks it Accepted.

---

## 9. Paste this at the start of the next session

```text
You are continuing the "closing" module of the Dua pharmacy app (branch module/closing).
Read docs/MODULES.md completely, then docs/modules/closing.md, docs/modules/closing.progress.md and
docs/modules/closing.next-session.md (this is your work order). Then read docs/ARCHITECTURE.md,
docs/SECURITY_MODEL.md, docs/DATABASE_DESIGN.md, docs/DECISIONS.md, docs/BUSINESS_RULES.md, docs/RUNBOOK.md §4
and study js/modules/sales as the finished example.
Step 0: merge origin/main into module/closing, run `npm ci && npm run verify` and `bash supabase/tests/run.sh`.
Both must pass before you change anything; if not, tell me and stop.
Then tell me in about 10 lines what you will do in Session A (steps A0–A5), which questions in section 3 you
need me to answer, and what you will not touch. Wait for my "go".
Do not guess money rules; ask. Do not edit files outside MODULES.md §3.1/§3.2. Do not apply migrations to the
live project unless I say so. No real staff names or business amounts anywhere in the repo.
At the end follow MODULES.md §0.2 and list every file you changed.
The old apps are references only: sysalmanyasin/Closing (main), sysalmanyasin/BT-Sale-Data2, sysalmanyasin/Random.
```
