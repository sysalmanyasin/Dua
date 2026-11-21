# Emergency Billing: Phase 6 (stabilise and test)

Status: **automated testing complete (21 Nov 2026); real-device and real-printer acceptance is the owner's step (checklist in section 3).**
Read with `ebill.md` (design) and `ebill-handover.md` (state and how to work).

## 1. What was tested, and the result

| Area | How it was tested | Result |
|---|---|---|
| **Money integrity of refunds** | New database test `0650_ebill_money_fuzz_test.sql`: 300 invented invoices (1 to 6 items, whole and half quantities, prices up to 800.00, discount/tax mixed into the net) refunded in random pieces (1,054 refunds, up to 11 per invoice); 60 more with a first piece then "refund the rest"; a retry with the same request id. | Every invoice's refunds add up to its net total to the paisa; no refund is negative or over the net; a retry never refunds twice. |
| **Screen preview equals the database** | One-off cross-check, not kept as a test: 1,963 random server refunds (including second and third refunds on the same invoice) compared with the amount the refund dialog previews. | 0 differences after a fix. The first run found 1 in 551 off by 0.01 (floating-point rounding of an exact half-paisa). `domain/refund.js` now uses exact fractions; regression test added (net 2.13: 0.355 rounds to 0.36). |
| **Restart persistence, interrupted upload, duplicates, deactivation** | Already covered by `ebill-offline-page`, `ebill-sync`, `ebill-held-page` and database tests `0611`/`0612`/`0622`; reviewed, no gap found. | Pass. |
| **Large catalogue** | `tests/unit/ebill-large-data.test.js`: 30,000 products; code lookup; seven keystrokes of word search across every field; sort and page. | About 0.6 s for the seven keystrokes; page is 50 rows. Limits are generous so the test is not flaky. |
| **Very long bill** | Same file: 300 lines totalled and turned into a receipt. | Exact, well under 0.5 s. |
| **Large report** | Same file: 5,000 invoices to tables, CSV, Excel and a multi-page PDF. | About 1.3 s for CSV plus Excel, about 0.9 s for the PDF (30+ pages, last invoice present). |
| **Printed receipt layout** | Real Firefox print engine, printed to PDF and viewed: 80 mm (one item), 58 mm (26 long-named items running to extra pages), Gift with logo, Summary with 2 copies and Duplicate, an offline bill with the temporary-reference note. | Page widths exact (80 mm = 227 pt, 58 mm = 165 pt); copies each start a new page; Gift shows no prices; Duplicate and "Copy n of N" appear; logo prints. **Found and fixed:** the page showed a pale blue background behind the slip; print now forces white. |
| **Screens at 1366 x 768** | Headless Firefox screenshots of History, refund dialog, report window, Settings > Receipt (with preview) and the billing screen. | Fixed: the report totals were stacked and wasted space (now a row); "Print receipt" crowded "Receipt type" (spacing added). |
| **Migration safety** | `supabase/tests/run.sh` builds an empty database from every migration in order and runs all tests; 0642 was also applied to the live project and checked read-only. | 75 test files, 3,226 checks pass. Live: 0633, 0634, 0640, 0641, 0642 registered; no `anon`/`public` execute on any `ebill_` function; internal helpers not callable by clients; RLS on every `ebill_` table. |
| **Permission gate on the live project** | Read-only: simulated a real login in a query and called a billing function. | Refused ("not allowed") for a user with no billing right. This is correct. **No role or user has any `ebill.*` right yet** (see section 4). |
| **Whole suite** | `npm run verify` | 1,874 unit tests in 120 files pass; secret and vendor checks pass. |

Also fixed during Phase 6 and Phase 5 merge: the billing screen's "Enable cash received entry" switch left the old cash amount showing in the box (and its test looked in the wrong place); `css/ebill.css` now passes Prettier.

## 2. Known limits (not bugs)

- Reports cover what is **on the server**. Invoices still on a device (waiting or failed) are not in them; the report window says so, offers Upload now, and names the files `-INCOMPLETE`. Invoices waiting on *other* devices cannot be seen from this one (the window says that too).
- A report file lists at most 5,000 invoices; the totals always cover all of them, and the window says when the list is cut short. A range is at most 400 days.
- Printing uses the browser's print window. A real thermal printer driver may still add its own margins or scale (see checklist).
- Receipt choices on the billing screen (Print on/off, Copies, Receipt type) are not remembered. Each time the screen opens they start from the shop settings. The **shop settings themselves are saved on the server and shared by every device**; a device keeps a copy so it can still print offline.
- The Supabase Preview check on GitHub reports "Remote migration versions not found in local migrations directory". It failed on `main` before Phase 5 as well, because migrations are applied by hand and recorded under their own numbers (RUNBOOK 4). It does not affect the live site.

## 3. Owner checklist (real devices and the real printer)

Tick each on the actual hardware. "Counter PC" = the shop computer; "phone" = an Android phone with Chrome.

**A. Set up (once)**
- [ ] Settings > Receipt: fill in shop name, address and licence lines, STN/NTN, POS number, terms; choose 80 mm (or 58 mm); Save with a reason.
- [ ] Press **Print a test slip** on the real thermal printer. Check: all lines readable, nothing cut off at the sides, the slip ends after the terms (no long blank paper), the paper cutter works.
- [ ] If the printer adds big margins or shrinks the slip, set the printer driver's paper size to 80 mm (or 58 mm) roll and margins to none, then print again.
- [ ] Open Settings on a second device: the same shop details appear.

**B. A normal sale (online)**
- [ ] Sign in, scan or type a code, enter quantity, take cash, Save invoice, enter your PIN.
- [ ] With Print receipt ticked, the slip prints by itself; with it unticked, the Print receipt button next to the saved message prints it.
- [ ] Copies = 2 prints two slips; the second says Duplicate and "Copy 2 of 2".
- [ ] Receipt type Gift prints no prices; Summary prints totals only; Secondary says Duplicate.

**C. No internet**
- [ ] Switch the device to aeroplane mode (or unplug the router). Make a sale; it saves with a LOCAL- reference and the slip says "Temporary reference".
- [ ] Switch on again; within a minute the invoice gets its real EB- number (History shows Synced).
- [ ] Close the browser completely while offline with an unsent bill; reopen: the bill is still there and uploads later.

**D. History, refunds, reports**
- [ ] History: find a bill, Print receipt (it says Duplicate).
- [ ] Refund part of a bill (say 1 of 3 packs): the dialog shows the amount before you confirm; History shows "Part refunded" and how much is back.
- [ ] Refund the rest: the status becomes Refunded; the amount refunded equals the bill total.
- [ ] Reports & export: choose a date range; totals and day-by-day table appear; download CSV, Excel and PDF and open each (Excel opens with two sheets; the PDF prints cleanly on A4 landscape).
- [ ] Make a bill with the internet off, do not upload it, then open Reports: the red warning appears and the files are named INCOMPLETE. Press Upload now (online): the warning disappears.
- [ ] Search receipt on the billing screen finds a bill by number or customer and reprints it.

**E. People and devices**
- [ ] A cashier with only "use" rights does not see Reports & export, Refund or Correct.
- [ ] A cashier cannot change the receipt settings.
- [ ] Deactivate a device in Settings; that device can no longer save offline bills.

**F. Phone**
- [ ] On the phone, bill a sale, hold it, resume it, and save. Text is readable and buttons are tappable.
- [ ] Rotate the phone; nothing important is hidden.

When every box is ticked, Emergency Billing is accepted. Anything that fails: write what you did and what you saw, with a photo of the screen or slip, and send it to the developer.

## 4. Before staff can use it: grant the rights (owner action, not yet done)

On the live project no role and no user has any `ebill.*` permission, including the owner account, so every billing function currently refuses. Grant them in the app's access screen (or ask the developer to, with your go-ahead). Suggested: cashiers get `ebill.use`; a senior or the owner also gets `ebill.manage` (refunds, corrections, receipt settings, all reports), `ebill.history_all` (see everyone's bills) and `ebill.export` (reports and files); `ebill.set_pin` for whoever sets staff PINs; `ebill.discount_override` only if wanted.
