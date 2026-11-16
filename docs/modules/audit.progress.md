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

## Next
- A2: domain maths and `audit_compile_round`, with SQL parity against the old app's 31 tests.
