# Tasks: Owner manual

The in-app version is the **Owner guide** page (`#/tasks/guide`, needs `tasks.manage`, so only the Owner sees it). The text lives in
`js/modules/tasks/ui/guide.js`; keep the two in step.

## Permissions

- `tasks.view_own`: carried by the Junior and Senior roles.
- `tasks.verify`: a personal grant from the Owner to one trusted Senior. A Junior can never verify.
- `tasks.manage`: Owner only. Since migration 1205 the database refuses to grant `tasks.manage`, `ops.view` or `notifications.view` to staff.
  If a staff member sees "Owner controls", they hold `tasks.manage`: remove it in Access.

## Messages (migrations 1204 and 1206)

| Event | Who is told |
| --- | --- |
| Task given to someone | That person |
| Sent back, deadline changed, cancelled | The person holding it |
| Work handed in | The Owner only (1206) |
| Change request made | The Owner |
| Change request decided | The person who asked |
| Overdue, 08:00 Pakistan time each morning | Only the person holding the task |

The "waiting for you to check" message is marked read when the task is approved, sent back or cancelled.

## Known limits

Verifiers still see every staff member's handed-in work in To Verify (D-53). Narrowing that to one named verifier per task is a larger change.
