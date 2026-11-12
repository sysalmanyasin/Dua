#!/usr/bin/env bash
# Daily encrypted backup (Foundation F7).
# Takes a consistent snapshot, dumps public + auth + supabase_migrations, fingerprints the same snapshot, then encrypts
# everything to a public key. The private key is never on the runner, so a leak of the runner cannot read old backups.
#
# Needs (environment): SUPABASE_DB_URL (session-mode pooler URL), BACKUP_AGE_RECIPIENT (age public key, starts with age1)
# Optional: OUT_DIR (default: a temp dir), BACKUP_DAY (YYYY-MM-DD, default: today UTC)
# Writes:   $OUT_DIR/dua-<day>.tar.age and $OUT_DIR/result.json (size, hashes and the manifest; no business values)
set -euo pipefail
umask 077
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}" "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set}"
case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must be an age public key (age1...)" >&2; exit 2;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${OUT_DIR:-$(mktemp -d)}"; mkdir -p "$OUT_DIR"
DAY="${BACKUP_DAY:-$(date -u +%F)}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# One session holds a snapshot open while pg_dump and the fingerprint both read from it.
coproc PSQL { psql "$SUPABASE_DB_URL" -qAtX -v ON_ERROR_STOP=1 2>"$WORK/psql.err"; }
exec 3>&"${PSQL[1]}" 4<&"${PSQL[0]}"
echo "begin isolation level repeatable read read only; select 'SNAP:' || pg_export_snapshot();" >&3
SNAP=""
while read -r line <&4; do case "$line" in SNAP:*) SNAP="${line#SNAP:}"; break;; esac; done
[ -n "$SNAP" ] || { echo "could not open a snapshot" >&2; exit 1; }

printf '\\o %s\n\\i %s\n\\o\nselect %s;\n' "$WORK/manifest.txt" "$HERE/manifest.sql" "'DONE'" >&3
while read -r line <&4; do [ "$line" = "DONE" ] && break; done

pg_dump "$SUPABASE_DB_URL" --format=custom --compress=6 --no-owner \
  --schema=public --schema=auth --schema=supabase_migrations --snapshot="$SNAP" -f "$WORK/dua.dump"

printf 'commit;\n\\q\n' >&3
wait "$PSQL_PID" 2>/dev/null || true

# Sanity: an empty or tiny dump must never look like a success.
SIZE_DUMP=$(stat -c %s "$WORK/dua.dump")
TABLES=$(grep -c '^table:' "$WORK/manifest.txt" || true)
if [ "$SIZE_DUMP" -lt 20000 ] || [ "$TABLES" -lt 5 ]; then echo "dump looks too small ($SIZE_DUMP bytes, $TABLES tables)" >&2; exit 1; fi

printf '{"day":"%s","pg_dump":"%s"}\n' "$DAY" "$(pg_dump --version | tr -d '\n')" > "$WORK/meta.json"
OUT="$OUT_DIR/dua-$DAY.tar.age"
tar -C "$WORK" -cf - dua.dump manifest.txt meta.json | age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT"

python3 - "$OUT" "$WORK/manifest.txt" "$OUT_DIR/result.json" "$DAY" <<'PY'
import hashlib, json, os, sys
out, mpath, rpath, day = sys.argv[1:5]
raw = open(out, 'rb').read()
manifest = {}
for line in open(mpath).read().splitlines():
    parts = line.split('|')
    if len(parts) == 3: manifest[parts[0]] = {'rows': parts[1], 'md5': parts[2]}
json.dump({'day': day, 'file': os.path.basename(out), 'size_bytes': len(raw),
           'sha256': hashlib.sha256(raw).hexdigest(), 'md5': hashlib.md5(raw).hexdigest(), 'manifest': manifest}, open(rpath, 'w'))
PY
echo "backup ok: $(basename "$OUT") $(stat -c %s "$OUT") bytes, $TABLES tables"
