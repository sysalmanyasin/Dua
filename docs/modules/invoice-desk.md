# Invoice Desk — Module Brief

**Current status (22 Nov 2026):** Module source and three routes are integrated on `main`; CI run #444 and Pages deployment #244 passed on commit `18283f176`. Migrations 1000–1003 are live under their four-digit repository versions. Remaining: explicit E2E save/product/history/RLS coverage, workbook/logo fidelity, Android/Windows browser and physical 80mm printer acceptance.

## Purpose
Replace the owner's three Excel invoice workflows with a secure, historical, printable module inside Dua. This is invoicing only, not accounting, inventory or POS.

## Scope
Fixed businesses: B.S Mart, Safari Book Land, Best Choice Store. Original worksheet sources: `BS Mart (6)`, `Safari Book Land (2)`, `Best Choice Store`. Preserve manually entered invoice numbers as text; duplicates are valid. Support item snapshots, product suggestions scoped by business, history, preview and browser printing.

## Architecture
Plain HTML + JavaScript ES modules; no new framework or runtime dependency. Module id `invoice-desk`; routes `/invoice-desk`, `/invoice-desk/history`, `/invoice-desk/products`. Supabase access only in module data layer; reads under RLS and writes via transactional RPC.

## Tables owned
`invoice_desk_invoices`, `invoice_desk_lines`, `invoice_desk_products`, `invoice_desk_idempotency`, and `invoice_desk_revisions` only if correction workflow is implemented. All namespaced and RLS-enabled.

## Permissions and security
Use `public.has_perm('invoice_desk.manage')`; the existing helper requires an enabled account and MFA AAL2 for admin accounts. No role presets receive this permission. Direct writes are revoked; RPC functions enforce permission. Read access is owner-only through the same permission.

## Migration range
1000–1099, explicitly assigned by the owner. Initial migration: `1000_invoice_desk_core.sql`.

## Template decisions
Three independent immutable template IDs: `bs-mart-v1`, `safari-book-land-v1`, `best-choice-store-v1`. Persist template id/version and printed snapshot values. Amount-in-words computed and saved for every business; printed only where original layout provides a field. Preserve Best Choice discount and the original cash/change fields where present.

## Printing
Dedicated 80mm CSS and print rendering path, browser print dialog only. No QZ Tray, ESC/POS bridge, or silent printing.

## Explicit exclusions
No accounting, inventory, stock, POS, automatic invoice numbering, customer/payment collection tracking, supplier management, multi-tenancy or analytics.

## Foundation requests
None currently. Do not modify `js/core/**`, shared helpers, package files, or unrelated modules. Central registration and stylesheet link are permitted one-line additions.

## Handoff
Baseline verification was reported by owner as passing (90 files, 1,344 tests) in GitHub Codespaces. Confirm by rerunning on feature branch before changes. Workbook inspected; actual print hardware acceptance remains dependent on physical device access.
