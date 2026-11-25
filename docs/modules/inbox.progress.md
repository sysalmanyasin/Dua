# Inbox (Stage 4) — progress

Built 25 Nov 2026 on `ops-redesign-stage4` (D-68). Applied live 25 Nov 2026 (1300, 1301, 1204; backup `schema_migrations_backup_20261125_prentf`). Merge pending.

Done and tested: database (1300, 1301, 1204, guard 1399), Inbox page, Home Messages section, unit and jsdom tests.

Not done on purpose: staff push (D-58), announcements with acknowledgement (later), reminders before a deadline (the owner chose overdue only).

Not verified: anything on the live database; the screens on a real phone; the 08:00 reminder job running by itself (it can only be seen after it first runs live).

Known limits: the bell count is on Home only (the status bar is Foundation); the Inbox page reuses the Task Master screen controller (`js/modules/tasks/ui/kit.js`), which could move to `js/shared` through a Foundation request; the reminder time, retention and the 500-message cap are fixed defaults, not settings.
