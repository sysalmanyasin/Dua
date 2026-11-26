# Android app: progress

Branch: `feature/android-app` · Migration ranges: `0110` (attendance, Manager range), `1400`–`1499` (prefix `app_`) · Brief: `docs/ANDROID_ARCHITECTURE.md`

| Date | Task | Done | Tested | Failed / not done | Next |
|---|---|---|---|---|---|
| 2026-11-26 | Attendance Phase 2 (menu entry, own history, owner week summary, migration `0111` read-only views, date-dependent test fixed) | yes | full database suite (3,124 checks incl. 25 new), 2,797 unit tests, lint, format, secret and vendor checks | `0111` not applied live; not seen on a phone | owner: apply `0111` after review; then Phase 3 (native geofencing) |
| 2026-11-26 | Correction: `0110` and `1401` ARE applied live (registry checked 26 Nov); 0 places, 0 events, 0 people granted `attendance.check_in`; 2 devices registered (1 with a push address). The installed APK is a CI debug build (certificate `CN=Android Debug`), which cannot be updated by a signed release | n/a | read-only checks | — | owner: install the first signed release (Actions → Android APK → Run workflow); grant `attendance.check_in`; add the pharmacy place |
| 2026-11-25 | Attendance: tables, geofence check-in function, owner places and limits, web page (staff check-in, owner day view and setup) | yes | database suite (all migrations on an empty Postgres) incl. new `0110` test; unit/jsdom tests for the page and domain | not applied to the live project; not seen on a phone | owner: apply `0110`; grant `attendance.check_in` per person |
| 2026-11-25 | Android data layer: `app_devices`, `app_push_rules`, widget reader (`1401`) | yes | 41 database assertions; mutation check on the widget permission rule | not applied live | owner: apply `1401` |
| 2026-11-25 | Firebase push sender `notify-push` and widget endpoint `widget-today` | yes | Deno type-check; 19 unit tests for signing, message building, Firebase answers, widget request | never run against real Firebase | owner: Firebase project, secret `FCM_SERVICE_ACCOUNT`, deploy both functions |
| 2026-11-25 | Web bridge `js/core/native.js` (push registration, widget secret, sign-out cleanup); Gmail hidden in the app | yes | 11 + 3 unit tests | not seen on a phone | phone test script §10 |
| 2026-11-25 | Capacitor shell, native plugin, widget, build workflow | yes (written) | `check-shell.mjs`, Java syntax pass, actionlint | **never compiled**; authoring environment cannot reach Android build servers | first CI build; fix any compile errors |

## Handoff
The first GitHub Actions run of `android-build.yml` is the first real compile of the Java. Expect to fix a small error or two (API signature, resource). Do not switch the `notify-drain` cron job to `notify-push` until one phone shows a registered device (`select * from app_push_tokens_for('closing.submitted')` as service role). Cutover and rollback steps are in `docs/ANDROID_ARCHITECTURE.md` §8.
