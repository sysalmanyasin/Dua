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

## Facts checked in the repository (24 Nov 2026)
- `index.html` has `<meta name="theme-color" content="#142b4a">` and `<link rel="icon" href="assets/icon.svg">`, and no manifest link. There is no `*.webmanifest` or `manifest.json`.
- The content security policy is `default-src 'none'; …; img-src 'self' data:;` with **no `manifest-src`**, so the browser would refuse a manifest until `manifest-src 'self'` is added.
- The only icon is `assets/icon.svg`. Android needs PNG icons (192 and 512) for an installed app.
- `sw.js` (cache `dua-shell-v2`) precaches the app shell from a generated list; run `node tools/sw-precache.mjs` after adding files. The repo root has a `CNAME`, so the app is served from the site root, and `start_url` and `scope` can be `./`.
- The audit routes that exist are `#/audit/count` and `#/audit/individual`. A shortcut to a screen the person has no key for is refused by the router, as a typed link would be.

## Prompt to build it
Paste this into a Foundation session on `sysalmanyasin/dua`.

> You are working in the Dua repository (plain HTML and ES modules, no framework, no CDN, no inline style or inline handlers). Read `docs/MODULES.md` §3.2, §3.3 and the Foundation rules, and `docs/modules/audit.foundation-request-shortcuts.md`. Branch from `main` as `foundation/pwa-manifest`.
>
> **Goal.** Make Dua installable on Android and give it two long-press shortcuts, **Counting** and **Individual audit**, without changing how any module works.
>
> **Before you build, ask the owner one question and wait for the answer:** "Dua has never been installable. Installing it makes it open as its own app window on phones and changes how updates arrive. Do you want Dua to be installable? If not, we stop here and nothing changes." Build nothing if the answer is no.
>
> **Build.**
> 1. Add `manifest.webmanifest` at the repo root: `name` "Dua", `short_name` "Dua", `start_url` "./", `scope` "./", `display` "standalone", `theme_color` "#142b4a", a `background_color` that matches `css/tokens.css`, and `icons` (the SVG plus PNG 192×192 and 512×512, plus a 512×512 `purpose: "maskable"`). Generate the PNGs from `assets/icon.svg` with the pre-installed Chromium/Playwright into `assets/`; keep them small. Add `shortcuts`: Counting → `./#/audit/count`, Individual audit → `./#/audit/individual`, each with the 192 icon.
> 2. In `index.html` add `<link rel="manifest" href="manifest.webmanifest" />`, and add `manifest-src 'self'` to the content security policy. Change nothing else in the policy.
> 3. Add the new files to the service worker list by running `node tools/sw-precache.mjs`. Do not hand-edit the generated block.
> 4. Add a unit test that: the manifest is valid JSON; `start_url` and `scope` are `./`; each shortcut URL points at a route registered by a module manifest (read `js/modules/*/manifest.js`); every icon file exists; the CSP in `index.html` contains `manifest-src 'self'` and still contains `default-src 'none'`; `index.html` links the manifest; and the manifest and icons are in the precache list.
> 5. Update `docs/modules/audit.md` (Foundation request 6 → built), `docs/MODULE_PROGRESS_REGISTER.md` and `docs/CHANGELOG.md`.
>
> **Rules.** No new JavaScript runtime code is needed; do not touch any module folder. No vendored library. No change to sign-in, routing or the service worker logic. Run `npm run verify` and `bash supabase/tests/run.sh` before you push; both must pass.
>
> **Done when:** on an Android phone, opening Dua in Chrome offers Install; after installing, long-pressing the icon shows Counting and Individual audit; tapping Counting opens the counting screen for a signed-in counter and the sign-in screen when signed out; the desktop and phone browser still work exactly as before. Tell the owner iPhones ignore shortcuts and will only get the normal home-screen icon.
