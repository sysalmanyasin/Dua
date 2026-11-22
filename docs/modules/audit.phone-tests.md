# Audit: real-phone test scripts

These are for the owner to run. Nothing here has been run on a real phone yet.

## PHONE 1: counting offline and back online
1. Sign in as a counter with an assignment. Open Audit > Count and open the assignment.
2. Turn on airplane mode. Type quantities for 5 items. Look for: "saved on this phone" style status, no errors.
3. Close the browser tab and reopen the app (still offline). Look for: the 5 counts are still there.
4. Turn airplane mode off. Look for: "Everything is sent" within a minute.
5. Tap Sign out while one count is unsent (repeat step 2 first). Look for: a warning naming the unsent counts; Cancel keeps you signed in.

## PHONE 2: two people, two rounds
1. Owner creates an audit, a round, and assigns two counters. Both count their own list.
2. Look for: each counter sees only their own items (AUD-5), no one sees another's quantities.
3. Owner compiles, reviews, resolves a conflict with a reason, starts round 2. Look for: fresh stock in round 2.

## PHONE 4: Individual Audit compiles itself (new, 22 Nov 2026)
1. A person with `audit.individual` and `audit.count` starts an Individual Audit (a template or one company) and counts a few items, leaving some uncounted.
2. Submit. Look for: **Your result** shows the item count, how many differ and the value; the owner does not need to compile.
3. Tap **Start another audit** and start a second one straight away. Look for: it starts without waiting.
4. A second person counts the same product to a different quantity and submits. Look for: no conflict appears for the owner.
5. Owner reopens the first submission with a reason while the person has the second audit open. Look for: a clear message that they already have another Individual Audit open.

## PHONE 3: barcode scanner (new)
Needs: a person with `audit.barcode_scan`, one with `audit.barcode_register`, one with `audit.barcode_admin`; a few real product boxes.
1. Open Audit > Barcodes > Find. Tap "Scan a barcode". Look for: the browser asks for the camera; the view shows the camera. If refused, the message says how to allow it and you can type the number.
2. Scan an unregistered box as the scanner-only person. Look for: "This barcode is not registered. Ask a deputy." and no Register button.
3. As the registrar: scan the same box, tap "Register this barcode", pick the product, Register. Look for: "not verified yet". A second person (or the same registrar) taps Verify under "To verify".
4. Register the same barcode for a different product. Look for: "Nothing was changed... listed under Conflicts". As admin, open Conflicts and decide with a reason.
5. Hybrid counting: use an audit set to hybrid. In Count, tap Scan, scan a box in your list. Look for: that item jumps to the top, its quantity box has the cursor, nothing is counted until you type. Scan a box not in your list: "not in the list given to you".
6. Offline scan: with airplane mode on, scan a registered box in Find. Look for: result still shown (from the copy on the phone) and "1 scan waiting to send"; turn the signal on and it clears.
7. Which engine: on an Android phone with Chrome the browser reader is used (no download). On an iPhone the first scan loads a small file once; note if it takes more than a few seconds.
8. Battery and heat: leave the scanner open without scanning. Look for: it pauses itself after about 45 seconds ("Keep scanning" button).
9. Low-end phone: note how long a box takes to read, and whether the page stays responsive.
