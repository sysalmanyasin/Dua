# Audit module — progress

## Done (slice A1, database core)
- `supabase/migrations/0401_audit_core.sql`: 14 new `audit.*` permissions (17 in total), 6 tables with RLS, guard triggers, and the RPCs `audit_engagement_create`, `audit_member_set`, `audit_round_create`, `audit_assign_auto`, `audit_assign_move`, `audit_assign_revoke` and `audit_round_lock`.
- `supabase/tests/0401_audit_core_test.sql`: 16 blocks covering permissions, RLS visibility, idempotency, the state machine, the version conflict and the activity log.
- The full DB suite and `npm run verify` pass.

## Notes
- A reopened assignment can move a round from compiled back to counting. The brief's lifecycle table does not list this move.
- A revoke after lock leaves the items unassigned until a reassignment slice is built.
- `audit_my_items` (the counter-read function) is deferred.
- An item may belong to only one live assignment. This is stricter than the old overlap warning.
- Round creation uses `inventory_products_for_scope`, which is not built yet. The tests use a stand-in. Until it exists, the RPC refuses with `inventory_interface_missing`.

## Done (slice A2, counting, compile and parity)
- `supabase/migrations/0402_audit_counting_compile.sql`: append-only `audit_count_events`, immutable `audit_submissions` and lines, `audit_corrections` (table only), `audit_compilations`, `audit_compiled_rows`, `audit_conflicts`. RPCs: `audit_round_start`, `audit_count_batch` (idempotent, batch of up to 500, auto-match takes the system quantity on the server, row time capped at 600 s), `audit_submit` (new revision, safe to repeat), `audit_reopen` (owner, with a reason), `audit_compile_round` (new revision each time, conflicts stored, never resolved).
- `js/modules/audit/domain/compile.js`: the same maths in integer paisa and thousandths, plus family merge, row timing, duration format and note cap.
- `tests/fixtures/audit/compile-cases.json`: 18 hand-worked cases shared by `tests/unit/audit-compile.test.js` and `supabase/tests/0402_audit_compile_test.sql`. JS and SQL agree to the paisa on all of them.
- The full DB suite and `npm run verify` pass (946 unit tests).

## Notes from A2
- Money rounds half away from zero in both JS and SQL (variance value per row, then summed).
- An overlap (one item given to two people) cannot happen: A1 allows one live assignment per item. The old overlap warning test has no equivalent.
- A count for an item outside the assignment is refused (`item_not_assigned`) instead of ignored, which is stricter than the old app. The JS maths still ignores such a line for previews.
- A reopened assignment counts as missing at compile until it submits again. Its latest earlier submission still supplies the counts.
- Results visibility follows membership (AUD-3): `audit.review` and `audit.report` show results only for engagements the person was added to. The brief's "all engagements" wording should be read that way unless you say otherwise.
- Conflict match: when a company and code repeat in one round, the row with the highest position is the one compared.
- Not yet built: correction and conflict functions, finalize, family merge in SQL, Force Submit, the three difference modes, spot-check seed (all slice B1/B2).

## Next
- A3: shell, hub and `/audit/team` bundles.
