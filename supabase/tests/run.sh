#!/usr/bin/env bash
# Applies every migration to an empty database and runs every *_test.sql. Uses PG* env vars.
set -euo pipefail
cd "$(dirname "$0")"
DB="${TEST_DB:-dua_test}"
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists $DB" -c "create database $DB"
export PGDATABASE="$DB"
psql -v ON_ERROR_STOP=1 -q -f stub_auth.sql
# Supabase provisions this publication in hosted projects. The bare PostgreSQL
# service used by CI does not, so create the empty publication before migrations
# that add application tables to it (for example, closings in migration 0217).
psql -v ON_ERROR_STOP=1 -q -c "create publication supabase_realtime"
for f in ../migrations/*.sql; do echo "== migrate $f"; psql -v ON_ERROR_STOP=1 -q -f "$f"; done
# The app counts days in Pakistan time (Asia/Karachi). Run the tests in the same zone so current_date agrees with the functions at any hour;
# in UTC, tests that build dates from current_date fail between 19:00 and 24:00 UTC, when Karachi is already on the next day.
export PGTZ=Asia/Karachi
for t in *_test.sql; do echo "== test $t"; psql -v ON_ERROR_STOP=1 -f "$t" 2>&1 | grep -E "pass|FAIL|ERROR" ; done
echo "ALL DATABASE TESTS PASSED"
