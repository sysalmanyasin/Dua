# iPhone attendance: Phase 1 technical design

Status: **design for approval. Nothing in this document is built, applied or deployed.** Written 28 Nov 2026 from the Phase 0 inspection of `main` and the live Supabase project. Companion to `docs/ANDROID_ARCHITECTURE.md` (Android, live).

Goal: iPhone employees get automatic check-in and check-out through ready-made Apple Shortcuts and Arrive/Leave personal automations, using the **same** database tables, the **same** decision function and the **same** Edge Function as Android. No native iOS app. No second attendance system.

Everything said about Apple Shortcuts below comes from knowledge of iOS, not from a test. Section 11 is the on-phone test (the "spike") that must pass before anything is built on those assumptions.

## 0. Decisions needed before Phase 2 (defaults are what this design assumes)

| # | Decision | Default used in this design |
|---|---|---|
| D1 | **Accept the weaker iPhone security tier** (section 3): the employee's own phone holds the secret and the location comes from their own shortcut, so a determined employee can fake it. Mitigated by a rolling secret, one-time enrolment, revocation and alerts. | Needs your explicit yes. Without it, Phase 2 does not start. |
| D2 | iPhone geometry (section 5): "arrived" accepted within site radius + 100 m; "left" accepted when at least 50 m from the place. | 100 m and 50 m, owner-adjustable. Confirmed or changed by the spike. |
| D3 | One active personal attendance device per employee **across platforms**. Enrolling an iPhone retires the person's Android attendance key (and the reverse is refused until the iPhone is revoked). | Yes, across platforms. |
| D4 | Who may enrol: `attendance.manage` plus the owner's authenticator code (the existing rule for every Manager owner function). | Yes. |
| D5 | Vendor a small QR generator (about 14 KB, MIT). The repo has a QR reader but no generator. | Yes (`qrcode-generator`, exact version pinned, listed in `vendor/README.md`). |
| D6 | Accuracy: if a shortcut cannot report accuracy, accept an "arrived" only when inside the plain site radius (no margin). | Yes. Decided by the spike. |

Also needed from you: **how many iPhone employees, which iOS versions, and a person with an iPhone and (for Phase 4) an Apple device that can build and share the shortcuts**. A shortcut file must be created and signed on an Apple device. I can write the exact action list; I cannot produce an importable file from here.

## 1. Principles

1. **The phone reports, the server decides.** Same rule as Android.
2. **The server derives the employee from the registered device.** The shortcut never sends an employee id, and nothing it sends is trusted as identity.
3. **No permanent credential in a QR code, link, shared shortcut or source code.** The shared shortcut is identical for everyone and contains only public addresses.
4. **Honest about what iOS hides.** Setup is classed as *verified*, *employee-confirmed* or *cannot be verified* (section 8). iPhone cannot report its own tracking state, so the Android guarantee "cannot be switched off silently" does **not** carry over. Section 9 says what replaces it.
5. **Android must not change behaviour.** Every change touching shared code is guarded by `platform`, and the existing Android database tests (`1403` and `1404` test files) must pass unchanged.

## 2. Device and enrolment model

### 2.1 What exists (verified)

`staff` (20 rows) → `profiles` (`staff_id`, `user_id`) → `app_devices` (`user_id`, `platform`, `attendance_secret_hash`). The event function finds the device by id and secret hash, takes `user_id`, then `profiles.staff_id`, and checks `attendance.check_in` on every event. `app_devices.user_id` is `NOT NULL` and references `auth.users`, so **every iPhone employee needs a Dua login first** (10 of 20 staff have none today; the owner creates them in Users & Access with the existing `create_login`). No role preset carries `attendance.check_in`; it is granted per person.

### 2.2 Migration `1405_app_ios_attendance` (app range, after 1404)

Changes to `app_devices`:

- `platform` check becomes `('android', 'ios_shortcuts')`.
- New columns: `device_name`, `enrolled_by`, `enrolled_at`, `revoked_at`, `revoked_by`, `revoked_reason`, `attendance_next_hash` (rolling secret, 3.2), `test_ok_at`, `test_result`, `confirmed_at`, `first_event_at`, `last_event_at`, `stale_secret_count`, `stale_secret_at`.
- Partial unique index: at most one **active** `ios_shortcuts` device per user (`attendance_secret_hash is not null`).

New table `app_device_enrolments` (no client grants, row-level security on):

| Column | Meaning |
|---|---|
| `id`, `staff_id`, `user_id` | who the token is for (chosen by the administrator) |
| `token_hash` | SHA-256 of a 256-bit random token; the token itself is never stored |
| `created_by`, `created_at`, `expires_at` | the administrator; lifetime **15 minutes** |
| `used_at`, `device_id` | set once, atomically, when exchanged |
| `cancelled_at`, `cancel_reason` | set when cancelled, replaced by a newer token, or the person loses the right |

Creating a new token for a person cancels their earlier open one. A used, expired or cancelled token is refused with the same answer as a wrong one.

`mgmt_attendance_auto_events` gets `platform text not null default 'android'` (history outlives the device row). `mgmt_attendance.source` stays `'auto'` for both platforms: every existing page, week summary and alert keeps working, and the platform is shown by joining the event history.

### 2.3 Functions

| Function | Who | Purpose |
|---|---|---|
| `app_ios_enrol_create(p_staff, p_reason, p_key)` | `attendance.manage`, MFA | Makes a token (returned once). Refuses a person with no login, a disabled login, or no `attendance.check_in`. Idempotent by key; logged. |
| `app_ios_enrol_cancel(p_enrolment, p_reason, p_key)` | `attendance.manage` | Cancels an open token. |
| `app_ios_enrol_peek(p_token_hash)` | service role | Returns the first name only, so the shortcut can ask "Set up for Ayesha? Yes/No" before anything is consumed (prevents scanning the wrong QR on the wrong phone). |
| `app_ios_enrol_consume(p_token_hash, p_device_name)` | service role | Atomically marks the token used, creates the device (server-made id), retires the person's previous attendance key (any platform), returns `{device_id, secret}` once. |
| `app_attendance_device_revoke(p_device, p_reason, p_key)` | `attendance.manage` | Clears both hashes, sets `revoked_*`. The next event gets 401 and the shortcut stops. |
| `app_attendance_ios_signal(...)` | service role | Handles `test` and `confirm` (4.4). Records nothing in attendance. |
| `mgmt_attendance_phones()` / `mgmt_attendance_device_journal(p_device, p_limit)` | `attendance.view_all` | Admin lists (section 6). |

Existing functions **changed for safety** (the guards only add conditions for the new platform; Android results are unchanged):

- `app_device_register` currently does `ON CONFLICT (id) DO UPDATE SET user_id = auth.uid()`. Someone who knew an iPhone device id could take the row over, which would clear its secret and silently disable that phone. It will refuse any existing row whose platform is not `android`. `app_device_unregister`, `app_widget_clear` and `app_device_attendance_enroll` get the same platform condition.
- `app_device_attendance_enroll` refuses while the person has an active iPhone device (D3), with the message "another phone is registered".
- `mgmt_attendance_health` returns `platform` so the owner page does not say "No report from this phone yet" about an iPhone.

## 3. Credentials

### 3.1 The limitation

Shortcuts has no Keychain access. In an unattended run it can read data stored in the shortcut itself or in a file in the Shortcuts folder. Both can be read, copied or edited by anyone who unlocks the phone, including the employee. A shared iCloud link is the same for everyone, so it can never carry a per-person secret.

### 3.2 Chosen scheme (needs D1): one-time token, device secret, rolling

1. **Enrolment token** (256-bit, 15 minutes, single use): exists only in the QR/link and on the administrator's screen. Exchanged for the device secret by the setup shortcut. It is carried in the URL **fragment** (`#t=…`), which browsers never send to a server, so it is not in any server log.
2. **Device secret** (256-bit, hash only on the server): saved by the setup shortcut to a file in the Shortcuts folder on the phone (local storage if the spike shows that works; iCloud Drive only if it does not, which also copies it to the person's other Apple devices).
3. **Rolling:** the server keeps `attendance_secret_hash` (current) and `attendance_next_hash`.
   - A request that uses the **current** secret is answered normally and the server mints a **new** next secret (overwriting any unused one), returned as `next_secret` in the response.
   - A request that uses the **next** secret promotes it to current (the old one stops working).
   - The shortcut saves `next_secret` before doing anything else. If a response is lost, the device still holds the current secret, which still works, and the server simply mints another next. A legitimate phone therefore never gets locked out by a failed save.
   - A request with a secret that is **neither** is the sign of a copy (or a restored old backup): it gets the same 401 as any wrong secret, is counted (`stale_secret_count`), and the owner gets one alert per day ("a phone's key was refused"). The administrator re-enrols or revokes.
4. The secret works for one purpose only, and the person's right to check in is checked on every request (a revoked person gets nothing).

### 3.3 What this does and does not protect

| Threat | Result |
|---|---|
| Someone else enrols as an employee | Prevented: only an administrator makes tokens, bound to one employee; the phone confirms the name first. |
| QR / link photographed or forwarded | Useful for at most 15 minutes and once; the administrator sees "completed" and can cancel. |
| Secret copied (screenshot, iCloud sync, backup) and used later | Detected within one event of the real phone, because only one of the two copies can hold the current secret. Not prevented. |
| Replay of an old request | Event ids are unique and the time window is checked (existing rules). |
| **Employee fakes their own location** | **Not prevented.** The shortcut sends whatever it is told, and iOS has no mock-location flag. Android is also not tamper-proof, but its geofence and mock flag are harder to fake. This is the weakening that needs D1. |
| Lost or stolen phone | Revoke in Dua. |

### 3.4 Fallbacks (only with your approval, never silently)

- If the spike shows the shortcut cannot **write a file unattended**: rolling is impossible. The alternative is a static per-device secret with the same server checks. This is weaker (a copy cannot be detected) and needs a separate approval.
- If the spike shows unattended runs cannot be relied on at all: the honest alternative is a native iOS app (Keychain, region monitoring). It needs an Apple Developer account and TestFlight. Excluded by the brief, so this would be your call.

## 4. Enrolment flow

### 4.1 Administrator

Attendance → **iPhone** card → choose a person (only people with a login and the check-in right are offered; others show "needs a Dua login" or "needs the check-in right" with a link to Users & Access) → **Make setup code**. Dua shows a QR code, a "Copy link" button (for WhatsApp), a 15-minute countdown and a **Cancel** button. Status updates to "Waiting for the phone" → "Phone set up" when consumed.

### 4.2 The setup page: `enrol.html` (static, outside the app)

The QR contains `https://dua.duapharma.com/enrol.html#t=<token>`. A separate static page is used instead of an app route because every app route requires a sign-in, and the employee is not signed in on this phone. It has its own strict CSP, no app code, and reads only the fragment. Steps shown, with screenshots captured on a real phone in Phase 4:

1. **Add the Dua shortcuts** (three buttons linking to the iCloud share links for *Dua Setup*, *Dua Check-in*, *Dua Check-out*; links are non-secret constants in the page's script). The employee taps **Add Shortcut** on each.
2. **Set up this phone:** a button opens `shortcuts://run-shortcut?name=Dua%20Setup&input=text&text=<token>`, so no copying is needed. If that is blocked, the setup shortcut asks the employee to paste the link text.
3. **Create the two automations** (cannot be done for them): Shortcuts → Automation → New → *Arrive* → Dua location, **Run Immediately** → run *Dua Check-in*; the same with *Leave* → *Dua Check-out*.
4. The setup shortcut's last step asks "Have you made both automations?" and records the answer (4.4).

### 4.3 Exchange: Edge Function `attendance-enrol` (public, like `attendance-event`)

| Call | Result |
|---|---|
| `{action:'peek', token}` | `{name}` (first name) or 401 |
| `{action:'consume', token, device_name}` | `{device_id, secret, site}` once, or 401 |

One answer (401) for wrong, expired, used, cancelled and "person no longer allowed". 400 for a malformed body. The token's entropy (256 bits) makes guessing pointless, so no rate-limit table is added.

### 4.4 Test and confirmation (setup shortcut, then the real ones)

- **Test:** the setup shortcut takes a location and sends `kind: 'test'`. The server measures it with the iPhone rules (section 5) and returns `ok`, `outside` or `weak_signal`; it records `test_ok_at`/`test_result` on the device and **nothing in attendance**. Do the test standing at the pharmacy.
- **Confirm:** `kind: 'confirm'` records `confirmed_at` (employee-confirmed, not verifiable).
- **First real event:** the first accepted Arrive or Leave sets `first_event_at` ("verified by use").

## 5. Event processing for iPhone

Same Edge Function and same decision function (`app_attendance_event`); platform comes **from the device row**, never from the request.

Unchanged for both platforms: device and right check, per-person lock, duplicate event id returns the same answer, stale (older than 24 h or more than 5 minutes ahead), "something later is already recorded", already in / not in, accuracy limit, no place set, Asia/Karachi business date, owner alert on mock.

Differences for `ios_shortcuts` (parameters in `mgmt_attendance_config`, owner-adjustable):

| Rule | Android | iPhone (default, D2) | Why |
|---|---|---|---|
| in: distance to place | at most the site radius (200 m live) | at most radius + `ios_arrive_margin_m` (100 m) | Arrive fires at the edge of a region the employee picks, which cannot be enforced |
| out: distance to place | more than the radius | at least `ios_leave_min_m` (50 m) | At Leave the phone is near the edge of that region, usually still inside our radius; Android's rule would reject a real exit |
| mock flag | reported | always false | iOS cannot report it |
| accuracy | required | optional (D6); unknown accuracy: "in" only inside the plain radius | the shortcut may not provide it |
| fresh-fix retries, 2-minute stability | phone does it | not possible | iOS runs the shortcut once |

Request fields: as Android (`device_id`, `secret`, `event_id`, `kind`, `at` epoch ms, `latitude`, `longitude`, `accuracy`) plus `kind` may also be `test` or `confirm`. The parser accepts a null accuracy; the database still rejects it for an Android device, so Android behaviour is unchanged. The response adds `next_secret` when the secret rolled.

Event id: must be a UUID. If the shortcut cannot generate one (spike S3), the parser will accept 32 hex characters and normalise it; the unique index is unchanged.

## 6. Administrator interface (Attendance page)

New card **iPhone** (consistent with the existing `.at-*` cards; same permission model: view = `attendance.view_all`, change = `attendance.manage`):

- **People list** with a status chip per person, in this order of strength:
  - *Not set up* · *Waiting for the phone (expires 10:42)* · *Phone set up (not tested)* · *Tested at the pharmacy* · *Automations confirmed by employee* · *Working (first real event 12 Nov 09:04)* · *Revoked*.
  - Last activity, rejected events in the last 7 days, and a warning *Key refused: possible copy*.
- **Incomplete setups** list at the top: people with a token never used, a phone never tested, or no event in 7 days (a quiet phone and a day off look the same on iOS; the list says so).
- **Actions:** Make setup code, Cancel code, **Revoke**, **Replace phone** (revoke + new code in one step), **Journal** (that device's events with outcome, reason, distance, accuracy).
- The existing Attendance records and refused-attempts views already include iPhone events (same table).
- The owner's "Who is at work" card shows for an iPhone: "iPhone · last activity 2 h ago · Setup: tested". It never shows "gone quiet" or "no report".

## 7. Shortcut specification (built on an Apple device in Phase 4)

Three shortcuts. All public values are the function addresses only.

**Dua Setup** (run once): receive input or ask for the setup text → `peek` → "Set up for *name*?" → `consume` → save `dua-device.json` (`device_id`, `secret`) → location → `test` → show result → ask "Both automations made?" → `confirm`.

**Dua Check-in / Dua Check-out**:
1. If `dua-device.json` is missing: notify "Run Dua Setup" and stop.
2. If `dua-pending.json` exists, send it first (same event id, so the server answers "duplicate" at worst).
3. Get current location (best accuracy; read latitude, longitude, accuracy if available).
4. Build the event (new event id, time as epoch ms) and POST it to `attendance-event`.
5. On success: **save `next_secret` first**, delete the pending file, notify "Checked in 09:05" or the reason in plain words (for example "Not recorded: you are outside the pharmacy").
6. On failure or no network: save the event to `dua-pending.json` and notify "Will try again at your next Arrive or Leave". The server never invents an event for a failed trigger.

An old pending event is only sent if it is under 24 hours old (the server ignores older ones as stale and says so).

## 8. Setup classes (what Dua may claim)

| Class | What | How known |
|---|---|---|
| **Verified** | Token exchanged; the pharmacy test was measured by the server; real events arrive | the server saw it |
| **Employee-confirmed** | Permissions allowed; both automations made; "Run Immediately" chosen | the employee said so in the setup shortcut |
| **Cannot be verified** | Automations still enabled, location permission still on, background execution working, "Run Immediately" not changed to "Ask" | iOS exposes none of it |

## 9. Reliability, failure handling and monitoring

| Situation | Handling |
|---|---|
| Duplicate Arrive/Leave | existing: `already_in`, `not_in`, duplicate event id |
| Delayed run | event time is when the shortcut ran; the 24 h and 5 min windows apply |
| No network / failed request | pending file, retried at the next trigger; no invented events |
| Wrong / revoked / replaced device | 401 and a notification on the phone; owner sees the revoked device |
| Copied key | stale-secret count and owner alert |
| Wrong place / poor accuracy | refused with the reason; visible in the journal and the refused-attempts list |
| Phone replaced | Replace phone: old key revoked, new code made |
| Missed check-in or check-out | not detectable directly; existing alert for a check-in open over 14 hours; "no event in 7 days" in the Incomplete list |

**Honest gap:** on Android the phone reports "location off" and a missing report raises an alert. An iPhone cannot, so a person who deletes the automations or turns location off is invisible until events stop. This is a property of iOS, and it is stated in the owner guide.

New alert kinds (dates only, no names, same wording style as Phase 6): `attendance.key_refused`, `attendance.ios_rejects` (three or more refused iPhone events for one person in a day).

## 10. Android compatibility

- Behaviour changes for Android: **none intended.** Guards added to four functions (2.3), one extra condition in the event function's device lookup, platform column on the history table (default `android`).
- Regression proof: migration 1403 and 1404 test files pass unchanged; plus new tests that an Android event gives the same answer before and after, that an Android device cannot be re-registered over an iPhone row, and that enrolling an iPhone retires the Android key.
- No APK change is required.

## 11. On-phone spike (before Phase 2)

One person, one iPhone, about 30 minutes, using a throwaway shortcut and a public echo address (nothing from Dua). Each item is pass/fail with a note.

| # | Test | Needed for |
|---|---|---|
| S1 | Personal automation *Arrive* and *Leave* with **Run Immediately**, phone locked, Dua closed: does it run with no tap? Which iOS version? | everything |
| S2 | *Get Current Location* during an automation: is the fix fresh, and is **accuracy** available? | D6, accuracy rule |
| S3 | Can a shortcut generate a UUID? | event id |
| S4 | Can an unattended run **write and read a file** in the local Shortcuts folder (not iCloud)? Survives a reboot? | rolling secret (3.2) |
| S5 | `Get Contents of URL` POST with JSON, and a **parse of the JSON reply** | next_secret |
| S6 | Offline: does the run fail cleanly so the pending file path works? | retry |
| S7 | Run time after crossing the region boundary: seconds or minutes? Distance from the place when it fires (walk out and in at 100 m, 200 m, 300 m automation sizes) | D2 |
| S8 | `shortcuts://run-shortcut?...&text=` hand-off from Safari: does the shortcut receive the text? | enrolment |
| S9 | Notifications from an unattended run: shown? silent? | messages |

Decision after the spike: all pass → build as designed. S4 fails → ask for a decision on the fallback (3.4). S1 or S2 fail → the shortcut route is not reliable enough; present the native-app alternative.

## 12. Implementation plan

| Phase | Work | Files (new unless marked "changed") |
|---|---|---|
| **2 Supabase** (needs D1–D4, spike) | migration 1405, `attendance-enrol` function, extend `attendance-event` and `_shared/attendance.ts` (kinds, optional accuracy, 32-hex event id if needed), config and CI lists, new alert wording | `supabase/migrations/1405_app_ios_attendance.sql`, `supabase/functions/attendance-enrol/index.ts`, `supabase/functions/attendance-event/index.ts` (changed), `supabase/functions/_shared/attendance.ts` (changed), `supabase/config.toml` (changed), `.github/workflows/ci.yml` (changed), `supabase/functions/_shared/ntfy.ts`, `fcm.ts` (changed), `js/shared/alerts.js` (changed), tests `supabase/tests/1405_app_ios_attendance_test.sql`, `0199_mgmt_exposure_test.sql` (changed), `tests/unit/fcm.test.js` (changed) |
| **3 Admin UI** | iPhone card, QR (vendored generator), device list, revoke/replace, journal, incomplete list, platform-aware owner health | `js/modules/manager/ui/attendance.js`, `data/attendanceApi.js`, `domain/attendance.js` (all changed), `css/manager.css` (changed), `vendor/qrcode-generator-<version>.js` + `vendor/README.md` (changed), tests |
| **4 Shortcuts and setup page** (needs an Apple device) | `enrol.html` + script + styles, three shortcut specs and iCloud links, screenshots, employee guide | `enrol.html`, `js/enrol.js` (or inline-free script), `css/enrol.css`, `sw.js` list (via `tools/sw-precache.mjs`), `docs/ios/*` |
| **5 Android compatibility** | regression tests only; code changes only if a test finds one | tests |
| **6 Tests on real devices** | iPhone test script and Android regression on the same events table | `docs/IPHONE_ATTENDANCE_TESTS.md` |
| **7 Documentation** | administrator guide, employee iPhone guide, Android guide, troubleshooting, limitations, final diagram | `docs/` |

Each phase is a separate pull request with its own tests. Migration `1405` is applied by hand and registered (as for `1403` and `1404`) only after the pull request is merged and the owner says so. Nothing is deployed without approval.

## 13. Limitations to document for administrators and employees

- A shortcut cannot be installed, permissioned or automated by a QR code. The employee confirms the shared shortcut, allows location, and creates the Arrive and Leave automations by hand, once.
- Dua cannot see whether an automation is still enabled, whether location is still allowed, or whether iOS ran it.
- iOS may run automations late, or not at all, when the phone is off, in low-power mode or has poor signal. Background execution is not guaranteed.
- An iPhone employee can edit their own shortcut; fake locations cannot be detected (D1).
- A missed check-in or check-out is corrected by the owner from Attendance, as today.
