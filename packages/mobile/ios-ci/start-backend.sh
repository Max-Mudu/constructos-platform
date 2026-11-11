#!/usr/bin/env bash
# Starts a throwaway PostgreSQL and the API on this runner, applies the Prisma
# migrations and creates one company with one user for the smoke test.
# The user's password is generated here, masked in the log and never printed.
set -euo pipefail
: "${OUT:?}" "${RUNNER_TEMP:?}" "${DATABASE_URL:?}"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
API_ORIGIN="http://localhost:3001"
DB_NAME="constructos_ios_ci"

show_logs() {
  echo "--- api.log (last 60 lines)"
  tail -n 60 "$OUT/logs/api.log" 2>/dev/null || true
  echo "--- postgres.log (last 30 lines)"
  tail -n 30 "$OUT/logs/postgres.log" 2>/dev/null || true
}
trap show_logs ERR

# PostgreSQL 16 (same major version as ci.yml).
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1
PG_FORMULA="postgresql@16"
if ! brew list --versions "$PG_FORMULA" >/dev/null 2>&1; then
  brew install "$PG_FORMULA"
fi
PG_BIN="$(brew --prefix "$PG_FORMULA")/bin"
"$PG_BIN/postgres" --version

PGDATA_DIR="$RUNNER_TEMP/pgdata"
# Trust authentication, loopback only: nothing outside this runner can connect.
"$PG_BIN/initdb" -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C > "$OUT/logs/postgres-initdb.log"
"$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -l "$OUT/logs/postgres.log" -o "-p 5432 -c listen_addresses=localhost" -w start
"$PG_BIN/createdb" -h localhost -p 5432 -U postgres "$DB_NAME"

# Schema.
cd "$REPO_ROOT/packages/api"
npx prisma generate
npx prisma migrate deploy

# API on localhost:3001.
nohup npx tsx src/server.ts > "$OUT/logs/api.log" 2>&1 &
echo $! > "$RUNNER_TEMP/api.pid"

up=0
for i in $(seq 1 90); do
  if curl -fsS -o /dev/null "$API_ORIGIN/health" 2>/dev/null; then
    echo "API answered /health after about ${i}s"
    up=1
    break
  fi
  sleep 1
done
if [ "$up" != 1 ]; then
  echo "::error::The API did not answer on $API_ORIGIN/health within 90 s"
  show_logs
  exit 1
fi

# Test company and user. Letters and digits only, with an upper-case letter
# and a digit to satisfy the password rules. Valid only for the database on
# this runner.
SMOKE_PASSWORD="Aa1$(openssl rand -hex 12)"
echo "::add-mask::$SMOKE_PASSWORD"
SMOKE_EMAIL="ios-ci-${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}@example.com"
( umask 077; printf 'SMOKE_EMAIL=%s\nSMOKE_PASSWORD=%s\n' "$SMOKE_EMAIL" "$SMOKE_PASSWORD" > "$RUNNER_TEMP/smoke-credentials" )

# post <path> <json>: prints only the HTTP status, never the response body.
post() {
  curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_ORIGIN/api/v1$1" -H 'Content-Type: application/json' --data "$2"
}

code="$(post /auth/register "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\",\"firstName\":\"Ios\",\"lastName\":\"Smoke\",\"companyName\":\"iOS CI Smoke Co\"}")"
echo "Create test company and user: HTTP $code"
[ "$code" = 201 ]

code="$(post /auth/login "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")"
echo "API login with the generated password: HTTP $code"
[ "$code" = 200 ]

code="$(post /auth/login "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"Wrong-password-1\"}")"
echo "API login with a wrong password: HTTP $code"
[ "$code" = 401 ]

echo "Backend ready: PostgreSQL on localhost:5432, API on $API_ORIGIN, test user $SMOKE_EMAIL"
