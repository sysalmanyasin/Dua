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

## PHONE 6: scanner help (new, Audit 3.0 F3)
1. Open the scanner on a pack with a small or dense barcode. Look for: it reads within a few seconds, and while it is trying the line under the picture stays on "Hold the barcode inside the frame."
2. Cover the camera with a hand, or scan in a dim room. Look for: "Too dark. Turn on the light." and, on a phone with a light, the light comes on by itself once. Turn it off with the button. Look for: it does not switch itself on again.
3. Tilt a shiny pack under a lamp. Look for: "Glare. Tilt the pack a little."
4. Hold the phone too close. Look for: "Hold steady and move back a little to focus."
5. On a phone with zoom, look for a Zoom slider starting a little zoomed in. Slide it. Look for: the picture zooms and the slider can reach both ends.
6. Tap the picture. Look for: the camera refocuses on that spot (a short pause, then sharp).
7. Scan a tiny barcode that normally fails live. Look for: after a few seconds it reads from a still photo (the phone may make a shutter sound or a brief flash).
8. Read a barcode, then keep the scanner open on the next pack. Look for: no old hint is left on screen.

## PHONE 7: the owner starts a round and reaches the review (new, Audit 3.0 F4)
1. On the Audits page, fill Name, choose Full stock, tap **Next: team**. Look for: four steps listed, the second one marked as the one you are on, and Next greyed out until you type a name.
2. Tick two counters and give one other person the role Deputy. Tap **Next: make the round and preview**. Look for: the round is made as a draft and you see each counter's share before anything is given out.
3. Change the balance. Look for: the shares change at once. Tap **Next: lock and start**, then **Lock and start**. Look for: you land on the Round page, which shows Counting as the step you are on.
4. Without using the browser's back button: tap the button for the next step, then look at the top of each page. Look for: Audits › Audit › Round › Review, each earlier part is a link, and the Review page has a bar of jump buttons with numbers.
5. Turn off the signal just as you tap **Lock and start**. Look for: a message naming the step that stopped. Turn the signal on and tap the button again. Look for: no second round or second audit appears in the list.
6. Let a counter submit, compile, approve a correction, then look at the Review page. Look for: "Out of date" with "1 approved correction waiting" and a **Recompile now** button. Tap it. Look for: the banner disappears.
7. On the next round's page (draft), tap **Same team as last round**. Look for: last round's counters are ticked and the preview shows, and nothing is given out until you tap Apply.

## PHONE 8: report files (new, Audit 3.0 F5)
1. Reports › choose an audit with a compiled round › Download › **Excel: this round**. Open the file in the phone's spreadsheet app. Look for: three sheets named Variance, Auditor Notes and Conflicts; columns line up; amounts show two decimals; the header row stays in view as you scroll.
2. Add up the Variance value column. Look for: it equals the net figure on the Review screen, to the paisa.
3. Tap **Variance CSV**, **Auditor notes CSV** and **Conflicts CSV** one at a time. Look for: each opens as a table with its own header row, and Urdu or accented names are not garbled.
4. Make a product name start with `=` (or look for one). Look for: in Excel it shows as text; in the CSV it starts with an apostrophe.
5. Tap **Excel: all rounds**. Look for: Summary first, then Combined, then one sheet per round; the Summary's last row says All rounds. On an audit with many rounds, look for the tab names to be unique and readable.
6. Tap **Summary CSV** and **Combined CSV**. Look for: the Round column on every line of the combined file.
7. Barcode Center › All barcodes (as an administrator) › **Excel: all four**. Look for: Master, Verification, Conflicts and Scan history sheets.
8. Turn the signal off and tap a download. Look for: a plain message, not a blank screen, and the buttons work again afterwards.

## PHONE 9: find a product and Individual audits by person (new, Audit 3.0 F6)
1. Audits › **Find a product**. Type part of a product name you know was counted and tap **Search**. Look for: the product listed with each compiled or final round it was in, newest first, with System, Counted and the difference.
2. Type the start of its code. Look for: the same product. Type `%`. Look for: nothing found, not everything.
3. Tap **Open** on a final round and on a compiled round. Look for: the Final page and the Review page of that round.
4. Sign in as someone who only views one audit and search for a product that is only in another audit. Look for: nothing found.
5. Audits › **Individual audits by person**. Look for: this month, people in A–Z order, each with their rounds newest first.
6. Pick last month in the Month box. Look for: the list changes and nothing from this month stays on screen. Pick a month with no Individual audits. Look for: a plain "Nobody has counted…" line.
7. Find a person whose Individual audit is still being counted. Look for: "Not compiled yet" for that round, not "0 differences".

## PHONE 10: person panel and attention badges (new, Audit 3.0 F7)
1. As the owner, open a round that is being counted. On Round or Review, tap **Items** beside a counter. Look for: "X of Y counted", the not-counted items first, with their codes.
2. Tap **Counted**, then **Assumed to match**, then **With a note**. Look for: the list changes each time and the number in each button matches the list.
3. On Review, with the panel open, tap **Force submit** for that person. Look for: the form opens and the panel stays readable. Cancel it. Tap **Items** again. Look for: the panel closes.
4. Have two counters submit everything in a round. Open the Audit overview. Look for: "Needs your attention" with "1 round ready to compile". Tap it. Look for: that round listed. Tap **Open**. Look for: the Review page of that round.
5. Compile, then make a conflict or a proposed correction (use a second round or a person with the suggest key). Look for: the badge says how many conflicts or corrections are waiting, and the list behind it adds up to the same number.
6. Sign in as a counter who has no review or compile key. Look for: no "Needs your attention" box and no Items button.
