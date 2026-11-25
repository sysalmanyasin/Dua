# Workspace browser harness (throwaway, kept as text)

Why: jsdom has no layout and ignores CSS specificity, so it cannot show scrolling, paint order, `hidden` bugs or CSP
problems. A real Chromium found three bugs jsdom could not (role pill contrast, frozen header paint order, conflict
buttons always visible). Nothing here is part of the app. The files end in `.txt` so lint and prettier leave them alone.

What it does: serves the repo with the app's real Content Security Policy, loads the Sheets screen, and replaces
`data/workbooks.js` with a stub that uses the JS reference model (`domain/spreadsheet.js`) as the server. The stub builds a
3,101-row workbook with styles, a formula and a frozen first row and column. It does not touch Supabase.

Run (from the repo root, in a scratch folder outside the repo):

1. `mkdir /tmp/harness && cd /tmp/harness`, then copy each file here and drop the `.txt` (`server.mjs.txt` becomes
   `server.mjs`, `drive.cjs.txt` becomes `drive.cjs`, and so on).
2. Playwright is installed globally in this environment (`/opt/npm-tools`), so use
   `NODE_PATH=/opt/npm-tools/node_modules` and set `CHROME` to a Chromium binary. `@sparticuz/chromium` on npm bundles one
   if no binary is present. Run with `--no-sandbox` as root (the scripts already do).
3. `cd /tmp/harness && DUA_ROOT=/path/to/repo NODE_PATH=/opt/npm-tools/node_modules CHROME=/path/to/chromium node drive.cjs`
   (the scripts start the server themselves; set `DUA_ROOT` in the environment they inherit).

Scripts: `drive.cjs` (errors, CSP, cell count for a long sheet, contrast, paint order of frozen headers, tap, scroll cost,
dark mode, landscape; screenshots to `/tmp/shots`), `keys.cjs` (arrow keys, Page Down, End), `edit.cjs` (edit a styled cell,
formula refusal, unsaved-draft guard), `conflict.cjs` (a real conflict and "Keep theirs").

Limits: desktop Chromium emulating a phone screen is not a phone (no soft keyboard, no real touch scrolling, a fast CPU).
The stub server is the model, not the database. Update `stub-workbooks.js` if the data-layer exports change.
