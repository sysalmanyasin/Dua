# How `prosemirror-bundle-1.0.0.mjs` was built

Source: nine ProseMirror packages (MIT) at the exact versions below, bundled into one ES module with esbuild 0.28.2. Nothing is downloaded at runtime; the app loads this one file from its own origin.

| Package | Version |
|---|---|
| prosemirror-model | 1.25.12 |
| prosemirror-state | 1.4.4 |
| prosemirror-view | 1.42.9 |
| prosemirror-transform | 1.12.5 |
| prosemirror-commands | 1.7.2 |
| prosemirror-schema-list | 1.6.0 |
| prosemirror-history | 1.5.1 |
| prosemirror-keymap | 1.2.3 |
| prosemirror-inputrules | 1.5.1 |
| orderedmap (dependency) | 2.1.1 |
| w3c-keyname (dependency) | 2.2.8 |
| rope-sequence (dependency) | 1.3.4 |

Every version was published at least 14 days before it was chosen (18 Nov 2026). `prosemirror-transform` and `prosemirror-inputrules` were pinned one release behind their newest because the newest were under two weeks old.

## Rebuild (the result must hash to the value in `tools/check-vendor.mjs`)

```
cd vendor/workspace/build
npm ci --ignore-scripts
npx esbuild entry.js --bundle --format=esm --minify --target=es2022 --legal-comments=none --outfile=../prosemirror-bundle-1.0.0.mjs
sha256sum ../prosemirror-bundle-1.0.0.mjs
```

Do this in a scratch copy, not in the repo (it creates `node_modules`). Two builds produce identical bytes.

## What was checked in the output

- No `eval`, no `new Function`, no `document.write`, no `<style>` element creation, no `setAttribute("style")`, no network calls (`fetch`, XMLHttpRequest, WebSocket, sendBeacon).
- `innerHTML` appears four times, all in ProseMirror's clipboard code. Pasted HTML is parsed into an inert document made with `document.implementation.createHTMLDocument`, which cannot load resources or run scripts.
- Size: about 212 KB minified, about 67 KB gzipped. It is loaded only when a note is opened.

## Upgrading

Change the versions in `build/package.json`, rebuild, name the new file with a new set number, update the hash in `tools/check-vendor.mjs`, update `LICENSES.txt`, and run the Workspace editor tests.
