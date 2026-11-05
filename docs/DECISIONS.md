# Decision Records (Phase 1)
Format: ID · decision · why · status. "Open" = needs owner answer.

D-01 Repo is **sysalmanyasin/Dua** (not PharmacyOS). GitHub Pages. Public repo (free Pages). Accepted.
D-02 Plain HTML + JS ES modules, no build step; Supabase JS from pinned CDN. Accepted (plan).
D-03 New Supabase project; **Free plan**. Accepted. Consequence: no guaranteed backups → D-10.
D-04 Roles: **Admin** (owner = manager, same powers), **Senior**, **Junior**. Roles are only *presets*; real access is **per-user permissions** (grants/denies on named keys). Differences between Senior and Junior decided later. Accepted.
D-05 Staff login = **username + 6-digit PIN**; admins = email + password + MFA. Supabase needs an email, so staff get a hidden internal address (`username@staff.dua.invalid`). 4-digit PINs are rejected by Supabase minimum length. Accepted, owner to confirm 6 digits.
D-06 Self-registration = **request only**, no access until an admin approves and assigns role/permissions. Forgot PIN = request → admin approves → one-time code. Accepted.
D-07 **Candela POS stays the source of truth** for products, stock and STR. V2 stores dated snapshots and keeps its own records only for what V2 creates (closings, sales entries, emergency bills, audit adjustments, V2 STR requests). Accepted by owner 5 Nov 2026.
D-08 Business day = Asia/Karachi calendar day, cutoff 00:00. A closing's business_date is its slot date. Accepted.
D-09 Staff may see only the **last closed day's** sale total (via a database function). History (7 years) hidden unless a permission is granted. Accepted.
D-10 Backups: daily encrypted database export by GitHub Actions to **Google Drive** (30 daily + 12 weekly kept), plus a restore drill before launch. Free plan RPO ≤ 24 h, RTO = hours (restore into a fresh project). Accepted.
D-11 History import (up to 7 years of daily sales; closings later if wanted) is a **one-time data job, not part of the app**. It lives in a separate `tools/import/` folder (or a separate private repo), runs by hand against staging then production, is idempotent, and is deleted/archived after use. App code stays clean. Accepted by owner.
D-12 Submitted closings/audit counts are immutable. Corrections = new revision row with reason, original kept. Accepted (plan).
D-13 Money: PostgreSQL `numeric(14,2)`; JS integer paisa. Daily TOTAL still rounds to whole rupee like the old app. Accepted.
D-14 Closing submit works **online only** (drafts may be offline), as the old app. Audit counting may be fully offline. Accepted.
D-15 Attendance/geofencing: not in V2 until Android phase. Accepted.
D-16 Public repo: no secrets, no real staff data, no business numbers beyond rules. Business rules are visible to anyone; accepted risk (old repos already public).
D-17 `till_float` = **Rs 45,000 extra cash in hand kept in the pharmacy** (not sales money). Grand total includes it, so Liquid = Grand − till_float. Stored as a setting, changeable only by admin with a logged reason. Accepted.
D-18 `per_customer_charge` = **Rs 1 per customer**, added to Net Sale as the old app does. Stored as a setting (default 1). Accepted.
D-19 Front-end stays vanilla ES modules (no React). XSS defence: escaping `html` template helper, ESLint rule banning raw `innerHTML`, strict CSP, pinned CDN versions. Modules lazy-loaded per route and permission. Accepted.
D-20 Supabase JS is **vendored** (`vendor/`, version 2.45.4, hash-checked in CI) instead of loaded from a CDN. Deviation from the plan, stricter: nothing third-party loads at runtime and the CSP is `script-src 'self'`. Accepted for Phase 2.
D-21 Admin changes to roles and permissions go through logged database functions (`set_user_role`, `set_user_permission`); admins have no direct write access to those tables. Admin accounts are created only from the Supabase dashboard + `bootstrap_first_admin`.
D-22 Staff sign-in runs inside the `staff-login` Edge Function (lockout), which calls Supabase Auth from the function's own address. Supabase's own per-address sign-in limit therefore applies to all staff together; fine for one shop, but a flood of bad attempts could briefly block logins. Watch list.
