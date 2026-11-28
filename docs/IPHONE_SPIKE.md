# iPhone attendance: the 30-minute test on a real iPhone (the "spike")

Purpose: find out, before anything is enrolled, whether Apple Shortcuts can do what the design needs. **Nothing here touches Dua or any real data.** Everything uses a throwaway shortcut and a public test address (`https://httpbin.org/post`, which just repeats back what it receives).

Who: one person with an iPhone (11 or newer), at or near the pharmacy for the last test. About 30 minutes, plus a walk for S7.
Write down: the iPhone model and the iOS version (Settings → General → About), then pass or fail and a one-line note for each test below. Send the notes back and I will decide the next step (see "What happens next").

Action names below are the usual ones; they can be worded a little differently on your iOS version.

## Make the test shortcut (once)

Shortcuts app → **+** → name it **Dua Spike**. Add these actions in order:

1. **Get Current Location**
2. **Get Details of Locations** → *Latitude* (repeat for *Longitude*, and for *Horizontal Accuracy* if the list offers it)
3. **Current Date**, then **Format Date** → try *Custom* and write `yyyy-MM-dd'T'HH:mm:ssZZZZZ` (an ISO time with the zone)
4. **UUID** (search for the action; if it does not exist, write that down: it is test S3)
5. **Dictionary** with the keys `lat`, `lng`, `accuracy`, `at`, `id`, filled from the steps above
6. **Get Contents of URL**: `https://httpbin.org/post`, Method **POST**, Request Body **JSON**, using the dictionary
7. **Get Dictionary from Input**, then **Get Dictionary Value** for `json` (this is the reply being read back: test S5)
8. **Save File** (Ask Where to Save **off**, Overwrite **on**) to the Shortcuts folder on **this iPhone**, name `spike.json`, content = the dictionary
9. **Get File** `spike.json` (Shortcuts folder), then **Show Notification** with its text

Run it by hand once with Wi-Fi on. If a step fails, note which.

## The tests

| # | Do this | Pass if |
|---|---|---|
| **S1** | Shortcuts → **Automation** → **+** → **Arrive** → *Any Location* is fine for now → **Run Immediately** (not "Run After Confirmation") → run **Dua Spike**. Lock the phone and put it in your pocket. Leave the pharmacy and come back, or ask someone to move the phone's reference place. | The shortcut runs **by itself**, with no tap, with the phone locked. Repeat with **Leave**. |
| **S2** | In the notification or the saved file, look at the location and accuracy from an automatic run. | A location arrives, it is recent, and an accuracy number is present (accuracy missing is acceptable, write which). |
| **S3** | Step 4 above. | A UUID action exists. (If not, that is fine: a random number or text can be used instead.) |
| **S4** | Run **Dua Spike** from an *automation* (not by hand), phone locked. Later restart the phone, unlock it, and check the notification text shows what was saved earlier. | The file is saved and read back during an unattended run, in the Shortcuts folder **on the iPhone** (not iCloud), and it survives a restart. **This one matters most.** |
| **S5** | Step 7. | The reply from the test address is read and a value from it is shown. |
| **S6** | Turn on Airplane mode, trigger the automation. | The run ends with an error or a notification instead of freezing, and the saved file is still there afterwards. |
| **S7** | Create the Arrive and Leave automations around the pharmacy at three sizes (100 m, 200 m, 300 m). Walk away and back, and for each note: how many minutes after crossing the line the shortcut ran, and how far from the pharmacy you were when it did. | It runs within a few minutes. Note the distances: they set the 100 m / 50 m margins. |
| **S8** | In Safari, open the link `shortcuts://run-shortcut?name=Dua%20Spike&input=text&text=hello` and add a *Show Notification* with **Shortcut Input** at the top of Dua Spike. | The notification says `hello`. |
| **S9** | Check whether the notification from the unattended runs appeared on the lock screen, with sound or silently. | It appears (silent is acceptable). |
| **S10** | Compare what step 3 produced against the examples: `2026-11-28T09:05:00+05:00` (best), epoch seconds, epoch milliseconds. | At least one of these formats can be produced. Write which. |

## What happens next

- **All pass:** I build as designed (the Dua side is already written and tested; only the owner's page and the shortcuts remain).
- **S4 fails** (a locked, unattended shortcut cannot save and read a file): the rolling secret cannot work. I will then lay out the alternatives, with the trade-offs, and **ask before changing anything about credential security**.
- **S1 or S2 fail:** the shortcut route is not reliable enough for this pharmacy. I will present the other option (a small native iPhone app, which needs an Apple Developer account) and the cost, and wait for your decision.
- Any other failure: I will adjust the design for that one point and tell you.

When finished, delete the three test automations and the **Dua Spike** shortcut, and the `spike.json` file.
