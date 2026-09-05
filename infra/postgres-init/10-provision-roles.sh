#!/bin/sh
#
# Runs `infra/provision-roles.sql` when the Postgres volume is first
# initialised — ADR-0002 §7, and OD-15's "the reference compose file is
# documentation that executes".
#
# The postgres image executes everything in /docker-entrypoint-initdb.d as the
# superuser, before the server accepts its first outside connection. That is the
# one moment a superuser is legitimately present and the roles do not exist yet,
# so it is where they get created — rather than in a README step an install will
# skip, leaving the web application running as a superuser.
#
# A SHELL script and not a plain .sql, because the passwords arrive as
# environment variables and psql substitutes `-v` variables, not `$VARS`. The
# .sql itself is therefore mounted OUTSIDE this directory (the image would
# otherwise run it a second time, without the variables, and fail).
#
# THIS RUNS ON A FRESH VOLUME ONLY. An instance whose volume already exists
# keeps its superuser until an operator runs the same SQL by hand; the file's
# header has the exact command.

set -eu

: "${SPLASHTRACK_APP_PASSWORD:?SPLASHTRACK_APP_PASSWORD is not set. It is the runtime role's password (the one in DATABASE_URL) and has no default — see .env.example.}"
: "${SPLASHTRACK_RETENTION_PASSWORD:?SPLASHTRACK_RETENTION_PASSWORD is not set. It is the retention role's password (the one in DATABASE_MAINTENANCE_URL) and has no default — see .env.example.}"

# `off` unless explicitly asked for. CREATEDB is a developer-machine privilege
# (ADR-0002 §6): the test harness creates its own `_test` and throwaway
# databases, production never creates a database at all.
CREATEDB="${SPLASHTRACK_PROVISION_CREATEDB:-off}"

echo "SplashTrack: provisioning database roles (createdb=${CREATEDB})…"

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  -v app_password="${SPLASHTRACK_APP_PASSWORD}" \
  -v retention_password="${SPLASHTRACK_RETENTION_PASSWORD}" \
  -v createdb="${CREATEDB}" \
  -f /opt/splashtrack/provision-roles.sql
