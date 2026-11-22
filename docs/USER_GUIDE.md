# User Guide

For the owner, managers and staff of Fazal Din's Pharma Plus. Open the app at **https://sysalmanyasin.github.io/Dua/** (on a phone, use the browser menu → *Add to Home screen* for a one-tap icon).

## 1. Signing in
| Who | How |
|---|---|
| **Staff** | *Staff* tab → your **username** and **4-digit PIN**. The owner creates your login and tells you both. |
| **Owner / Manager** | *Owner / Manager* tab → email + password. The first time, scan the QR code with an authenticator app (Google or Microsoft Authenticator); after that, type the 6-digit code each time. |

**New staff member:** there is no sign-up. Ask the owner to create your login; you get a username and a 4-digit PIN.
**Forgot your PIN:** ask the owner to set a new PIN for you.
**Locked out:** five wrong PINs lock the account for 1 hour. The owner can unlock you sooner.

## 2. Finding your way around
- **Dark bar at the very top:** the latest closed day's sale (if you may see it) and the Pakistan time.
- **Header:** logo, business name, who you are, *Sign out*.
- **Tabs under the header:** one tab per section the owner has enabled and your permissions allow (currently includes Home, Sales, Manager, Closing, Users & Access where available). Under a section, a second row of tabs lists its pages. On a phone the rows scroll sideways.
- **You only see what you are allowed to use.** If a page is missing, the owner has not given you that permission.

## 3. Home (the Cover)
A greeting, the key numbers you may see (latest sale, this month so far against the same days last year, target progress, customers), a **Needs attention** list (days with no entry, today's check list not started after 4 pm, no target for the month) with a button for each, and tiles for every page you can open.

## 4. Sales
### Dashboard
Cards for the running month (compared with the previous month's *same days*), cash + banks, credit, customers, average bill, year to date, forecast against target, yearly growth (CAGR), branch score, cumulative difference and all-time sales. Below: insights in plain words, *Race the forecast*, five charts (monthly total with 3M/6M/12M/24M/YTD/All and *Compare*, cash vs banks, top credit clients, customers, year on year — tap a bar to open that month), the last 12 months, top 10 days, weekday averages, best and worst month of each year, and a calendar of the year shaded by sale strength.
### Index
Every month as a card, grouped by year: total, days, average per day, difference, growth against the same month last year, and target progress. Months that exist only as monthly figures are marked and cannot be opened. Tap a month to see its days.
### Add Entry
Opens on the **next day with no record**. Enter the amounts; **Total sale** and **Diff** update as you type using the same rule as the database. Fields you rarely use are behind *Show more fields*. *Cash Returns* and the *Returns* columns always **deduct**, whatever sign you type; a negative amount in a client or bank column reduces the day. Press **Save day**.
- **Correcting a saved day:** open it (from *Daily Data* or *Recent entries*). The page switches to *Save correction* and asks for a **reason**. The old version is kept and listed under *Corrections*. Days are never deleted.
- If you press Save twice, or your connection drops and retries, the day is saved **once**.
### Daily Data
All days by month. Tap a month, then a day, to see every payment line, the summary figures, and the correction history, with a *Correct this day* button if you may.
### Sale Report
Pick a date; everything fills in. Enter **Till Short** and **Patty Cash** by hand if needed. **Print Report**, **Copy** (paste into Gmail and the formatting is kept), **Send via Gmail** (see §6), **Customize Rows** (untick rows to hide them; saved for you on every device; totals are never changed). The **Monthly Target** card shows target, collected and % achieved for that month; people with the *targets* permission can set it.
### Daily Check List
The branch inspection report in the original layout (19 sections, defaults pre-filled).
- It **saves by itself** a moment after you stop typing. The small dot shows *Saved*, *Saving…* or *Not saved yet — will retry*. If the connection drops, a copy is kept on your phone and sent when it returns.
- Figures work themselves out: opening stock, total in hand, net total, return total, total customers, flagged items.
- The bar shows *N of 19 sections complete*; *Next incomplete* jumps to the next unfinished one; the left list (or chips on a phone) jumps to any section; the green strip at the bottom shows net sales, closing stock, customers and flagged items.
- If the same day is changed on another device, you are told and nothing is overwritten. *Load the latest* reloads it.
- **Preview**, **Copy**, **Print**, **Email** (opens your mail app) and **Send via Gmail**. *Reset day* clears the day after asking.
- The pen button (✎) next to a dropdown edits that list (only for people with that permission). Lists are shared by everyone.
- Sales figures in the stock section are typed by hand for now; automatic filling is planned.
### Diff Report
Total sale minus COMP SALE by month with a running total; open a month for its days (the running total restarts at 0 each month).
### Cash to Deposit
For every day: Cash Sale − Cash Returns + FDPP POS + FDPP Consumer. Tick days to get a combined total and breakdown, and print a 72 mm receipt.
### Reports
Pick **Monthly report** (summary + day-by-day table), **Sale Book — a year** or **Sale Book — all time**, press *Show report*, then *Print / Save as PDF*. In the print window choose *Save as PDF* to get a file. Pages are landscape A4.
### Last Day (staff)
Staff with the basic permission see only the **latest closed day's total** (today is never "closed"). Nothing else about sales is visible to them.

## 5. Manager and Closing (where enabled)
- **Manager → Staff Registry:** the owner can add and view staff records, private details and notes. A staff record does not automatically create a login; login access is managed separately in Users & Access.
- **Manager → Staff Credit:** the owner can set an opening balance, add entries, record deductions and reverse an entry with a reason. Access is permission-controlled.
- **Closing:** the guided ledger is still being built. Only the sections currently shown in the app are available; later sections and the submit workflow are not complete yet. Do not treat a saved draft as a submitted closing.
- **Inventory** (for people with `inventory.view`): the Candela stock feed updates every hour and your phone keeps its own copy, so search works even with no signal. The header shows when the stock data was last updated.
  - **Home** has a **Stock** row: stock value, to reorder, not selling, and excess. Tap a card to open the page that explains it.
  - **Overview:** search any product by name, code or supplier. Open the menu for the other screens you may see.
  - **Stock Ledger:** tabs for Never sold, Dead stock, Excess, Zero stock and Pack issues. Choose the window (30–365 days, default 60), search and sort.
  - **Reorder:** what to buy, by supplier or as a top-sellers list, with the cover days and sales window you choose; units already on the way are counted.
  - **Excess Working:** products with more stock than needed, with a retain list that is shared across devices.
  - **Health:** the four Home numbers, a chart by class and by supplier, and the best sellers.
  - **Sync** (for people with `inventory.sync`): see the last check and the last runs, or press **Sync now**.
  - **Excel, PDF and CSV:** Stock Ledger, Reorder and Excess Working have three buttons at the end of the totals card. The file holds exactly what is on screen after your tab, search and settings. Excel (all rows) has a second sheet, About, with the settings and the data time. PDF opens the print window: choose *Save as PDF*; it prints the first 1,500 rows and says so, so use Excel for the full list. CSV is the plain table.

## 5a. Workspace: notes (where enabled)
Open **Workspace** from the menu. **New note** starts a note and opens it (you need permission to create notes; otherwise you can still open notes shared with you).
- **Writing:** the toolbar has headings, bold, italic, underline, bulleted, numbered and tick-box lists, links, undo and redo. Typing `# `, `- `, `1. ` or `[] ` at the start of a line starts a heading or list. The note saves by itself a moment after you stop typing; the label at the top says **Saved**, **Unsaved changes**, **Saving** or **Offline**. If it says Offline, keep the page open: it keeps trying. Notes cannot be edited without a connection yet.
- **Sharing (owner):** **Share** lists who has access. Add a colleague as *Can edit* or *Can view*, change or remove access, hand over ownership, and choose whether people who can only view may see earlier versions. Only the owner can change this.
- **If two people edit at once:** you see *Someone else saved a newer version*. Your text is safe. Choose **Keep my version on top**, **Use the latest version**, or **Copy my text**. Their version stays in History either way.
- **History (earlier versions):** open **History**, pick a version to preview it. The owner can **Restore** it: this adds a new version with that text and erases nothing.
- **Archive and Delete (owner):** an archived note is read-only and leaves the main list. Delete moves it to **Trash**, where only the owner can see it.
- **Finding things:** search looks in titles and in note text. Folders are your own: other people do not see how you file things.
- Not available yet: sheets and spreadsheets, attachments, editing offline, and links you can send to a colleague.

## 5b. Audit: Individual Audit (where enabled)
For people with the Individual Audit permission. Open **Audit → Individual audit**, choose a saved template or whole companies, and tap **Start counting**. Count your items; items you do not count read as 0.
- **Submit:** tap **Submit count**. The audit is worked out at once. You do not have to wait for the main auditor.
- **Your result:** after you submit you see how many items you counted, how many differ from the system and the value of the difference.
- **Next audit:** tap **Start another audit** straight away. You can have only one open at a time, so submit the one you are counting first.
- **Same product counted twice in the month:** counting the same product on another day, or someone else counting it, is not treated as a conflict between individual audits.
- If a count needs a change after you submit, ask the owner to reopen it (they give a reason). You cannot reopen it while another of your audits is open.

## 6. Users & Access (owner)
See the Admin Guide.

## 7. Sending reports by Gmail
*Send via Gmail* opens a small box: type one or more addresses (separate with commas), check the subject, press **Send**. The first time, Google opens a window asking you to allow **sending** from your own Gmail. The app can never read your mail. The addresses are remembered for next time.

## 8. If something goes wrong
| You see | What to do |
|---|---|
| "Too many attempts" | Wait 15 minutes, or ask the owner. |
| "Not saved yet — will retry" (check list) | Keep the page open; it retries. Your work is also kept on the phone. |
| "Changed on another device" | Press *Load the latest*. |
| "Charts could not be loaded" | Reload the page; check your connection. |
| A page is missing | You do not have that permission; ask the owner. |
| "This section could not load" | The rest still works; reload, then tell the owner. |
| Print shows other pages | Use the page's own *Print* button, not the browser's. |
