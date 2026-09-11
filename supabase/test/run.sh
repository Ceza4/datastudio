#!/usr/bin/env bash
# ============================================================================
#  supabase/test/run.sh — apply every migration to a throwaway Postgres and
#  run both verification suites against it.
#
#  WHY THIS EXISTS.
#
#  Migration 0004 broke every client write — docs.org_id went NOT NULL with no
#  default and no trigger to fill it, so every push failed — and it shipped,
#  because the only thing exercising the schema was supabase/rls_pentest.sql,
#  which hand-writes the columns the client omits. It proved the policies were
#  right about a request the application never makes.
#
#  Nothing could run the migrations locally, so nothing did, so the first place
#  a mistake could surface was production.
#
#  Needs postgres 16 on PATH (Debian/Ubuntu: apt install postgresql-16).
#  Touches nothing outside its own temp directory and no remote project.
#
#  Usage:  bash supabase/test/run.sh
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(dirname "$HERE")"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-5439}"
DATA="$(mktemp -d)/pg"

export PATH="$PGBIN:$PATH"
command -v initdb >/dev/null || { echo "postgres 16 not found — set PGBIN"; exit 1; }

# initdb refuses to run as root. In a container that is the normal user, so
# drop to `postgres` (or nobody) rather than telling the reader to figure it
# out — a test nobody can start is a test nobody runs, which is how 0004 got
# out in the first place.
AS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="postgres"; id "$RUNAS" >/dev/null 2>&1 || RUNAS="nobody"
  AS="su $RUNAS -s /bin/bash -c"
  chmod 777 "$(dirname "$DATA")"
fi
run() { if [ -n "$AS" ]; then $AS "PATH=$PATH $*"; else eval "$@"; fi; }

cleanup() { run "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$(dirname "$DATA")"; }
trap cleanup EXIT

echo "→ starting a throwaway postgres on :$PORT"
run "initdb -D $DATA -U postgres --auth=trust" >/dev/null
run "pg_ctl -D $DATA -o '-p $PORT -k $(dirname "$DATA")' -l $(dirname "$DATA")/log start" >/dev/null
sleep 2
PSQL=(psql -h "$(dirname "$DATA")" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)

echo "→ supabase shim"
"${PSQL[@]}" -f "$HERE/00_supabase_shim.sql" >/dev/null

echo "→ migrations"
for f in "$SUPA"/migrations/0*.sql; do
  printf '   %s\n' "$(basename "$f")"
  "${PSQL[@]}" -f "$f" 2>&1 | grep -viE "already exists|skipping|does not exist" || true
done

echo
echo "→ rls_pentest.sql — are the POLICIES right"
"${PSQL[@]}" -f "$SUPA/rls_pentest.sql" 2>&1 | sed 's/^psql:[^ ]*: //' | grep -E "PASS|FAIL|ERROR" || true

echo
echo "→ 01_repair_checks.sql — are the TRIGGERS and GRANTS right, against the"
echo "   payloads the client actually sends"
"${PSQL[@]}" -f "$HERE/01_repair_checks.sql" 2>&1 | sed 's/^psql:[^ ]*: //' | grep -E "^NOTICE:|ERROR" | sed 's/^NOTICE:  //' || true

echo
echo "→ 02_sharing_checks.sql — does a grant actually reach ONE sheet and stop"
"${PSQL[@]}" -f "$HERE/02_sharing_checks.sql" 2>&1 | sed 's/^psql:[^ ]*: //' | grep -E "^NOTICE:|ERROR" | sed 's/^NOTICE:  //' || true

echo
echo "→ 03_chat_checks.sql — can the people you shared with actually talk"
"${PSQL[@]}" -f "$HERE/03_chat_checks.sql" 2>&1 | sed 's/^psql:[^ ]*: //' | grep -E "^NOTICE:|ERROR" | sed 's/^NOTICE:  //' || true

echo
echo "✓ done"
