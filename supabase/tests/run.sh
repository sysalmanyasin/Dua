#!/usr/bin/env bash
# Applies every migration to an empty database and runs every *_test.sql. Uses PG* env vars.
set -euo pipefail
cd "$(dirname "$0")"
DB="${TEST_DB:-dua_test}"
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists $DB" -c "create database $DB"
export PGDATABASE="$DB"
psql -v ON_ERROR_STOP=1 -q -f stub_auth.sql
for f in ../migrations/*.sql; do echo "== migrate $f"; psql -v ON_ERROR_STOP=1 -q -f "$f"; done
for t in *_test.sql; do echo "== test $t"; psql -v ON_ERROR_STOP=1 -f "$t" 2>&1 | grep -E "pass|FAIL|ERROR" ; done
echo "ALL DATABASE TESTS PASSED"
