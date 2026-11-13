#!/usr/bin/env bash
# Daily encrypted backup (Foundation F7).
# Takes a consistent snapshot, dumps public + auth + supabase_migrations, fingerprints the same snapshot, then encrypts
# everything to a public key. The private key is never on the runner, so a leak of the runner cannot read old backups.
#
# Needs (environment): SUPABASE_DB_URL (session-mode pooler URL) and ONE of:
#   BACKUP_AGE_RECIPIENT  an age public key (age1...). Best: the private key stays offline, so the runner can never read old backups.
#   BACKUP_PASSPHRASE     a long passphrase (20+ characters), used when no key pair is available. The runner holds it, so keep the
#                         GitHub environment locked to main. File is gpg symmetric AES-256 (authenticated), named .tar.gpg.
# Optional: OUT_DIR (default: a temp dir), BACKUP_DAY (YYYY-MM-DD, default: today UTC)
# Writes:   $OUT_DIR/dua-<day>.tar.age and $OUT_DIR/result.json (size, hashes and the manifest; no business values)
set -euo pipefail
umask 077
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must be an age public key (age1...)" >&2; exit 2;; esac
  EXT=age
elif [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  [ "${#BACKUP_PASSPHRASE}" -ge 20 ] || { echo "BACKUP_PASSPHRASE must be at least 20 characters" >&2; exit 2; }
  EXT=gpg
else
  echo "Set BACKUP_AGE_RECIPIENT (preferred) or BACKUP_PASSPHRASE" >&2; exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${OUT_DIR:-$(mktemp -d)}"; mkdir -p "$OUT_DIR"
DAY="${BACKUP_DAY:-$(date -u +%F)}"
WORK="$(mktemp -d)"
# Any failure leaves a short, safe reason in error.txt (the workflow sends it to the Tools tab). Passwords are never printed by
# psql/pg_dump; connection strings are masked anyway.
ERRFILE="$OUT_DIR/error.txt"; rm -f "$ERRFILE"
fail() { printf '%s\n' "$1" > "$ERRFILE"; printf '%s\n' "$1" >&2; exit 1; }
on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ ! -s "$ERRFILE" ]; then
    detail=""
    for f in "$WORK/dump.err" "$WORK/psql.err"; do
      if [ -s "$f" ]; then detail="$(tail -n 3 "$f" | tr '\n' ' ' | cut -c1-300)"; break; fi
    done
    printf '%s\n' "${detail:-backup.sh stopped with exit code $rc}" | sed -E 's#postgres(ql)?://[^ ]*#postgresql://***#g' > "$ERRFILE" || true
  fi
  rm -rf "$WORK"
}
trap on_exit EXIT

# Check the connection string for the usual mistakes before connecting.
DBHOST="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's#^[a-zA-Z]+://[^@]*@##; s#[:/?].*##')"
DBPORT="$(printf '%s' "$SUPABASE_DB_URL" | sed -nE 's#^[a-zA-Z]+://[^@]*@[^:/?]+:([0-9]+).*#\1#p')"
[ "$(printf '%s' "$SUPABASE_DB_URL" | tr -cd '@' | wc -c)" -le 1 ] || fail "SUPABASE_DB_URL has more than one @: a special character in the database password must be percent-encoded (@ becomes %40)."
[ "$DBPORT" != "6543" ] || fail "SUPABASE_DB_URL uses port 6543 (Transaction pooler). Use the Session pooler string (port 5432): a consistent dump needs one connection."
case "$DBHOST" in db.*.supabase.co) fail "SUPABASE_DB_URL is the Direct connection (IPv6 only); GitHub cannot reach it. Use the Session pooler string (host ends in pooler.supabase.com, port 5432).";; esac

# One session holds a snapshot open while pg_dump and the fingerprint both read from it.
coproc PSQL { psql "$SUPABASE_DB_URL" -qAtX -v ON_ERROR_STOP=1 2>"$WORK/psql.err"; }
exec 3>&"${PSQL[1]}" 4<&"${PSQL[0]}"
echo "begin isolation level repeatable read read only; select 'SNAP:' || pg_export_snapshot();" >&3
SNAP=""
while read -r line <&4; do case "$line" in SNAP:*) SNAP="${line#SNAP:}"; break;; esac; done
[ -n "$SNAP" ] || fail "could not open a snapshot: $(tail -n 2 "$WORK/psql.err" 2>/dev/null | tr '\n' ' ' | cut -c1-220)"

printf '\\o %s\n\\i %s\n\\o\nselect %s;\n' "$WORK/manifest.txt" "$HERE/manifest.sql" "'DONE'" >&3
while read -r line <&4; do [ "$line" = "DONE" ] && break; done

pg_dump "$SUPABASE_DB_URL" --format=custom --compress=6 --no-owner \
  --schema=public --schema=auth --schema=supabase_migrations --snapshot="$SNAP" -f "$WORK/dua.dump" 2>"$WORK/dump.err" \
  || { cat "$WORK/dump.err" >&2; exit 1; }

printf 'commit;\n\\q\n' >&3
wait "$PSQL_PID" 2>/dev/null || true

# Sanity: an empty or tiny dump must never look like a success.
SIZE_DUMP=$(stat -c %s "$WORK/dua.dump")
TABLES=$(grep -c '^table:' "$WORK/manifest.txt" || true)
if [ "$SIZE_DUMP" -lt 20000 ] || [ "$TABLES" -lt 5 ]; then fail "dump looks too small ($SIZE_DUMP bytes, $TABLES tables)"; fi

printf '{"day":"%s","pg_dump":"%s"}\n' "$DAY" "$(pg_dump --version | tr -d '\n')" > "$WORK/meta.json"
OUT="$OUT_DIR/dua-$DAY.tar.$EXT"
if [ "$EXT" = "age" ]; then
  tar -C "$WORK" -cf - dua.dump manifest.txt meta.json | age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT"
else
  tar -C "$WORK" -cf - dua.dump manifest.txt meta.json | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 --compress-algo none -o "$OUT" 3<<<"$BACKUP_PASSPHRASE"
fi

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
