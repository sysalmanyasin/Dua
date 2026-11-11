# Changelog (everything built so far)

Dates are 2026. Counts are as of the end of each step.

## 4–5 Nov — Plan, rules and design
- Owner's fresh-build plan received; decisions confirmed (GitHub Pages, free Supabase, Candela stays the source of truth, midnight business day, username + PIN for staff).
- **Phase 0:** business rules read from the old code and written down (`BUSINESS_RULES.md`): closing calculation, sales TOTAL/DIFF, carry-forward, Final Closing, STR/audit rules, emergency billing.
- **Phase 1:** architecture, database design, security model, 22 decisions.

## 5 Nov — Phase 2: foundation (accepted by the owner)
- Database: people, roles, permissions (per-person allow/deny), settings with history, append-only activity log; admin MFA enforced in the database.
- Four Edge Functions: staff login with lockout, access requests, one-time setup codes, admin actions.
- App shell, router, module registry, sign-in / request / set-PIN / MFA screens, Users & Access page.
- CI (lint, tests, database tests, function checks); secret scan; vendored Supabase client.
- Live on the owner's new Supabase project; owner tested request → approve → PIN → sign-in → lockout.

## 5 Nov — Sales history
- Old backup studied: 2,379 days + 80 months. The old TOTAL formula reproduced 2,268 days; 110 old days held negative client values that the old app had stored as reductions; 30 days typed as April 2021 were April 2022; one day (25 Sep 2026) had a stale total. Owner decisions applied.
- One-time, token-protected import function; verified; removed.

## 5–6 Nov — Sales, first pages
Add Entry (live total, corrections with reason, safe retries), Daily Data, Index, Diff Report, Cash to Deposit (with 72 mm receipt), Last Day for staff; payment-method table; revisions; page-level permissions and sub-menus.

## 6 Nov — Daily Check List and design
Daily Check List (the owner's priority): all 19 sections and defaults carried over exactly from the old code, autosave, offline copy, conflict check, live stock figures, progress, Preview / Copy / Print / Email, shared dropdown lists. Design refresh: original fonts and logo, status bar, header, tab navigation, teal hero banners. Fixed: pages sharing one event container.

## 7 Nov — Sale Report, Cover, Dashboard, Gmail
- **Sale Report** with Customize Rows (saved per person), Till/Patty, print, copy; Monthly Target card (targets and preferences tables).
- **Cover (home):** greeting, key numbers, Needs attention, tiles per permission.
- **Dashboard:** 11 KPI cards (like-for-like comparisons), insights, Race the forecast, five charts with ranges/compare/year filter, summary table, top 10 days, weekday averages, best/worst months, year calendar. Summary views keep the phone's downloads small.
- **Send via Gmail** for the Sale Report and Daily Check List (send-only permission; recipients remembered).

## 10 Nov — Completing Sales, and documentation
- **Reports:** monthly report and Sale Book (year / all time), landscape print and Save as PDF.
- **Manage Fields, Targets page**, Add Entry opens on the next unrecorded day with a recent-entries list, Index shows target progress.
- Security: unsent drafts are cleared at sign-out.
- Merged with the other session's inventory-feed work; migration numbering and registry problem found, documented and worked around.
- This documentation set.

## Totals at 10 Nov
10 migrations · 33 tables / 6 views / 25 functions · 29 permissions · 5 Edge Functions · ~5,600 lines of JavaScript · 242 front-end tests · 195 database checks.
