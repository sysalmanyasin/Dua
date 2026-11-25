# Android app: progress

Branch: `feature/android-app` · Migration ranges: `0110` (attendance, Manager range), `1400`–`1499` (prefix `app_`) · Brief: `docs/ANDROID_ARCHITECTURE.md`

| Date | Task | Done | Tested | Failed / not done | Next |
|---|---|---|---|---|---|
| 2026-11-25 | Attendance: tables, geofence check-in function, owner places and limits, web page (staff check-in, owner day view and setup) | yes | database suite (all migrations on an empty Postgres) incl. new `0110` test; unit/jsdom tests for the page and domain | not applied to the live project; not seen on a phone | owner: apply `0110`; grant `attendance.check_in` per person |
| 2026-11-25 | Android data layer: `app_devices`, `app_push_rules`, widget reader (`1401`) | yes | 41 database assertions; mutation check on the widget permission rule | not applied live | owner: apply `1401` |
| 2026-11-25 | Firebase push sender `notify-push` and widget endpoint `widget-today` | yes | Deno type-check; 19 unit tests for signing, message building, Firebase answers, widget request | never run against real Firebase | owner: Firebase project, secret `FCM_SERVICE_ACCOUNT`, deploy both functions |
| 2026-11-25 | Web bridge `js/core/native.js` (push registration, widget secret, sign-out cleanup); Gmail hidden in the app | yes | 11 + 3 unit tests | not seen on a phone | phone test script §10 |
| 2026-11-25 | Capacitor shell, native plugin, widget, build workflow | yes (written) | `check-shell.mjs`, Java syntax pass, actionlint | **never compiled**; authoring environment cannot reach Android build servers | first CI build; fix any compile errors |

## Handoff
The first GitHub Actions run of `android-build.yml` is the first real compile of the Java. Expect to fix a small error or two (API signature, resource). Do not switch the `notify-drain` cron job to `notify-push` until one phone shows a registered device (`select * from app_push_tokens_for('closing.submitted')` as service role). Cutover and rollback steps are in `docs/ANDROID_ARCHITECTURE.md` §8.
