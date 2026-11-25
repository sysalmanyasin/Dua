# Tasks (Task Master) — progress

Database layer: applied live 24 Nov 2026 (1200–1203, D-65). Screens: Stage 3b, built 24 Nov 2026 on `ops-redesign-stage3b` (D-67).

Done and tested (unit, jsdom, data layer mocked): My Tasks, To Verify, All Tasks, Requests, Schedules, Team, and the Home sections. Action Centre rules in migration 0703 (applied live 25 Nov 2026).

Not done on purpose: attendance (D-51), notifications and reminders (Stage 4, D-58), AI proposals (Stage 5).

Not verified: the screens on a real phone; the Action Centre task rules with real overdue tasks (none exist yet, so only the empty case was checked live); realtime (the pages refresh every 60 seconds, on return and when back online).

Known limits: the Owner has no screen to edit Action Centre rule severity yet (the database function exists). A task's detail opens inside the list, so there is no link to one task.
