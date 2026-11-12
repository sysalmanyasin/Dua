#!/usr/bin/env bash
# Restore a backup into a SEPARATE database and prove it matches what was backed up (Foundation F7 restore drill).
# Usage: restore-test.sh BACKUP.tar.age AGE_IDENTITY_FILE TARGET_DB_URL
#        restore-test.sh BACKUP.tar.gpg -               TARGET_DB_URL   (passphrase in the environment variable BACKUP_PASSPHRASE)
#   MODE=local     (default) an empty plain Postgres; creates the Supabase roles it needs
#   MODE=supabase  a fresh, empty Supabase project: auth rows first (data only), then public + migrations
# It refuses to touch the live project, and prints names and PASS/FAIL only, never row values.
set -euo pipefail
umask 077
BACKUP="${1:?backup file}"; IDENT="${2:?age identity file}"; TARGET="${3:?target db url}"
MODE="${MODE:-local}"
BLOCK="${PROD_REF_BLOCK:-sdsynzsflubdxnelgthh}"
case "$TARGET" in *"$BLOCK"*) echo "REFUSING: the target looks like the live project" >&2; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
case "$BACKUP" in
  *.tar.age) age -d -i "$IDENT" "$BACKUP" | tar -C "$WORK" -xf - ;;
  *.tar.gpg) : "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE for a .tar.gpg backup}"
             gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$BACKUP" 3<<<"$BACKUP_PASSPHRASE" | tar -C "$WORK" -xf - ;;
  *) echo "unknown backup file type" >&2; exit 2 ;;
esac
[ -s "$WORK/dua.dump" ] && [ -s "$WORK/manifest.txt" ] || { echo "FAIL: backup is missing its dump or manifest" >&2; exit 1; }

empty=$(psql "$TARGET" -qAtX -c "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$empty" = "0" ] || { echo "REFUSING: the target's public schema is not empty" >&2; exit 2; }

# A scratch target already has a public schema (and maybe an old registry): do not re-create those, and start the registry clean.
psql "$TARGET" -qAtX -v ON_ERROR_STOP=1 -c "drop schema if exists supabase_migrations cascade"
pg_restore -l "$WORK/dua.dump" > "$WORK/all.list"
if [ "$(psql "$TARGET" -qAtX -c "select count(*) from pg_namespace where nspname = 'public'")" != "0" ]; then
  grep -v -E '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public( |$)' "$WORK/all.list" > "$WORK/use.list"
else
  cp "$WORK/all.list" "$WORK/use.list"
fi

if [ "$MODE" = "local" ]; then
  psql "$TARGET" -qAtX -v ON_ERROR_STOP=1 -c "do \$\$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end \$\$"
  pg_restore --no-owner --exit-on-error -L "$WORK/use.list" -d "$TARGET" "$WORK/dua.dump"
else
  # Supabase: the new project already has its own auth schema, so load the auth rows first (data only), then the app schemas.
  pg_restore --no-owner --exit-on-error --data-only -n auth -d "$TARGET" "$WORK/dua.dump"
  pg_restore --no-owner --exit-on-error -L "$WORK/use.list" -n public -n supabase_migrations -d "$TARGET" "$WORK/dua.dump"
fi

psql "$TARGET" -qAtX -v ON_ERROR_STOP=1 -f "$HERE/manifest.sql" | grep -v '^$' | sort > "$WORK/restored.txt"
sort "$WORK/manifest.txt" > "$WORK/expected.txt"
fail=0
while IFS='|' read -r name rows md5; do
  got=$(grep -F "$name|" "$WORK/restored.txt" | head -1 || true)
  if [ "$got" = "$name|$rows|$md5" ]; then echo "PASS  $name"; else echo "FAIL  $name"; fail=1; fi
done < "$WORK/expected.txt"
extra=$(cut -d'|' -f1 "$WORK/restored.txt" | sort | comm -13 <(cut -d'|' -f1 "$WORK/expected.txt" | sort) - || true)
[ -z "$extra" ] || { echo "FAIL  unexpected extra items in the restored copy:"; echo "$extra"; fail=1; }
[ "$fail" = "0" ] && echo "RESTORE VERIFIED" || { echo "RESTORE FAILED" >&2; exit 1; }
