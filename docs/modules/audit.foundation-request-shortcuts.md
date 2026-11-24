# Foundation request: phone shortcut links for Audit (N5)

Raised by the Audit module on 24 Nov 2026. It does not block Audit 3.0, which is accepted without it.

**What is wanted.** Long-pressing the Dua icon on a phone should offer two shortcuts: **Counting** (`#/audit/count`) and **Individual audit** (`#/audit/individual`).

**Why this is a Foundation request.** Shortcuts live in the web app manifest. The repository has no web app manifest today (`index.html` links none, and there is no `manifest.json` or `*.webmanifest`), so adding one changes the root install behaviour of the whole app, not only the Audit module. The Audit module does not edit root files.

**What Foundation would add.**
1. A `manifest.webmanifest` with name, short name, `start_url`, `scope`, `display: standalone`, theme and background colours, and the existing `assets/icon.svg` (plus PNG sizes 192 and 512, which phones need for the home-screen icon).
2. `<link rel="manifest" href="manifest.webmanifest">` in `index.html`, and the file added to `sw.js` precache (run `node tools/sw-precache.mjs`).
3. A `shortcuts` array. Each entry's URL must be a hash route that already exists and that the signed-in person is allowed to open; the router already refuses a route the person lacks the key for, so a shortcut can never open a screen the person may not use:
   ```json
   "shortcuts": [
     { "name": "Counting", "short_name": "Counting", "url": "./#/audit/count" },
     { "name": "Individual audit", "short_name": "Individual", "url": "./#/audit/individual" }
   ]
   ```
4. A test that the manifest is valid JSON, every shortcut URL matches a registered route, and the file is in the precache list.

**Notes.** iOS Safari ignores manifest shortcuts (it uses only its own home-screen icon), so this helps Android only. Installing as an app also changes how the app is signed in and updated, so the owner should decide whether Dua is meant to be installable before this is built.
