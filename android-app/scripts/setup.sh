#!/usr/bin/env bash
# Builds android-app/android/ from scratch: Capacitor's pinned template + our hand-written overlay + generated icons.
# The generated project is NOT committed (it contains binary files and is reproducible); only overlay/ is.
# Safe to run again: it recreates the project every time.  Needs: node, npm, python3 with Pillow.  Run from android-app/.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm ci
rm -rf android
npx cap add android
cp -R overlay/app/. android/app/
python3 scripts/make-icons.py
npx cap sync android
echo "android/ is ready. Build with: cd android && ./gradlew assembleDebug"
