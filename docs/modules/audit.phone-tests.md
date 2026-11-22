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

## PHONE 5: getting into counting quickly (new, Audit 3.0 F1)
1. A counter with exactly one open assignment taps **Counting** from the Audit Overview. Look for: the count screen opens at once, with no list in between. Tap **All assignments**. Look for: the list shows and stays.
2. With two open assignments, tap **Continue counting** on the second card. Look for: that assignment opens, not the first.
3. On a long list, scroll down. Look for: a bar stays at the bottom with "N left" and **Submit**; it is easy to tap with a thumb. Tap Submit with items uncounted. Look for: the "not counted" warning, and nothing is submitted.
4. Count every item and tap Submit in the bar. Look for: it submits at once. Then look for **Your next assignment** if you have another open one.
5. Individual Audit: count some items wrongly, submit, then tap **Recount my differences**. Look for: a new audit with only the products that differed. Tap it twice quickly, or with a weak signal. Look for: only one audit is started.
6. As the main auditor, open a round, go back to the Overview, then close the tab and reopen the app. Look for: **Pick up where you left off** opens the same audit and round.

## PHONE 5b: the counting calculator (new, Audit 3.0 F2)
1. Open a count that is in progress. Tap a count box, then tap **Calculator**. Look for: the sheet rises from the bottom and says "The answer goes into" with that item's name. The keys are large enough to hit one at a time with a thumb.
2. Type 6 × 10 + 4. Look for: "6 × 10 +" above, 4 on the big display, and "= 64" under it. Tap **Put 64 in the count box**. Look for: the sheet closes, 64 is in the box, the difference shows at once, and the next box is ready.
3. Type 4 + 6 × 10. Look for: 64, not 100.
4. Type 10 ÷ 3 and tap Put. Look for: a message that it has more than 3 decimals, and nothing is counted. Type 3 − 5. Look for: "A count cannot be below zero."
5. Open the calculator before tapping any box. Look for: it says to tap a count box first, and the put button is off.
6. Turn on airplane mode, count one item with the calculator. Look for: the count shows as waiting to send, and it sends when the signal returns.
7. With the on-screen keyboard up in a count box, tap Calculator. Look for: the sheet is fully visible and no key is hidden behind the keyboard.
