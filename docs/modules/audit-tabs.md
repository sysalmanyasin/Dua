# Audit: four-tab layout (supersedes the navigation part of Audit 2.0)

Status: built on `feature/audit-tabs` (PR #84 merged) and `feature/audit-team-reports`.
Scope: presentation and navigation only. **No database, SQL, API-function, RLS or business-rule changes.** Counting, submission,
compilation, conflicts, corrections, difference rounds, reopening, force submit, automatic Individual compilation, offline
outbox, barcode handling, expiry, racks and the final snapshot are the existing, tested code.

## Navigation

Four persistent tabs on every Audit page except counting (`ui/frame.js`, `domain/workspace.js`). A person sees only the tabs
they can open; a tab opens the first page of it the route's own permission list allows.

| Tab | Screens |
|---|---|
| Overview | five sections only (below) |
| Team Audit | Progress & Assignments · Compile & Review · Corrections · Reports · Finalization |
| Individual Audit | Monthly Overview · Rounds & Progress · Review & Corrections · Reports |
| Tools | Expiry register, Racks, Barcode centre, Templates, Team access |

Team screens that work on one round (Compile & Review, Corrections, Finalization) show greyed out until a round is chosen.
Every Team screen shows the audit name and round with a link back to the audit. Counting (`/audit/count`) has no tab bar.

## Route map

| Route | Screen | Page code |
|---|---|---|
| `/audit` | Overview | `ui/hub.js` (rewritten) |
| `/audit/engagements`, `/audit/engagement`, `/audit/round` | Team: Progress & Assignments | unchanged pages |
| `/audit/compile` | Team: Compile & Review | `ui/compile.js` `screen: 'review'` |
| `/audit/corrections` (new) | Team: Corrections | `ui/compile.js` `screen: 'corrections'` |
| `/audit/reports` | Team: Reports | `ui/reports.js` + `ui/combinedReport.js` |
| `/audit/final` | Team: Finalization | `ui/final.js` + `domain/finalChecks.js` |
| `/audit/individuals` | Individual: Monthly Overview | `ui/individuals.js` `screen: 'overview'` |
| `/audit/individual-rounds` (new), `/audit/individual` | Individual: Rounds & Progress | `ui/individuals.js` `screen: 'rounds'` |
| `/audit/individual-review` (new) | Individual: Review & Corrections | `ui/compile.js` `screen: 'individual'` |
| `/audit/individual-reports` (new) | Individual: Reports | `ui/individualReports.js` |
| `/audit/tools` (new) and the utility routes | Tools | `ui/tools.js`, `domain/tools.js` |
| `/audit/attention` | **removed** (Pending actions on the Overview replace it) | |

Routes that already existed keep their paths. There are no query strings and no deep links to a specific audit (owner decision):
the chosen audit, round and month are kept for the tab as before.

## Overview: five sections

1. **Quick actions**: compact chips, only to pages the person can open.
2. **Product search**: the existing `audit_product_history` search (compiled and final rounds of Team and Individual audits the
   person can see). Needs `audit.view`, `audit.review` or `audit.report`; hidden otherwise. Removed from the Team audits page.
3. **Pending actions**: one row per round, each opening its screen with the round selected: ready to compile, open conflicts,
   corrections waiting, **approved corrections not yet recompiled** (read from each compiled round, at most 12 rounds of at most
   6 open audits), and Team rounds ready to finalize. Individual rounds open the Individual review screen.
4. **Individual audit**: this month's people, rounds, done and still counting; Continue / Open / Start.
5. **Active team audit**: the newest open Team audit, its latest round, `n of m submitted`, what needs attention, Continue.
   A person who only counts sees their own assignments here instead.

## Rules this layout keeps

- **Individual rounds compile themselves.** The Individual review screen has no progress panel, compile button, cross-round
  conflicts, next round or final snapshot. The recompile alert and its button stay: an approved correction only applies at the next
  compile (this is the existing mechanism, not a new manual step).
- **Variance is never added across rounds** (owner decision). The combined variance report shows any or all compiled rounds
  one after another, each with its own label and its own totals. Individual rounds also show `who`. The combined and summary
  downloads have no "All rounds" row (removed from the existing summary file for the same reason: a repeated round counts the same
  item again).
- **Recompile alert** shows on Compile & Review, Corrections, Individual review and the Overview whenever an approved correction
  is newer than the compile.
- **Finalization checklist** mirrors what `audit_finalize` already refuses: compile older than a count or approved correction
  (`compile_stale`), a correction waiting (`corrections_pending`), an unsettled conflict (`conflicts_unresolved`). Each failed
  check names the screen that fixes it and disables the button. "Incomplete" or "reopened and not submitted" only warns.
  The database remains the authority.
- Team Reports gained a **Missing counts CSV** (the variance lines nobody counted), derived from data the variance report already reads.

## Things to know

- The Overview makes several reads (my assignments, engagements, attention summary, individual month, each open audit's rounds,
  the latest team round, each compiled round). Each is optional: one failing leaves the rest showing, with an error note in its
  own section. If this proves slow, a read-only SQL summary function would replace the per-round reads (not built).
- The Tools tab and Team access are permission-filtered links to existing routes. `audit.manage` alone does not open Barcode or
  Templates (the manifest lists them separately); that is unchanged.
- Old tests that asserted the previous hub layout and the old Individual page were replaced, not deleted without cover:
  `audit-overview`, `audit-workspace`, `audit-reports-combined`, `audit-final-checks` and additions to the history, export and
  final page tests.
