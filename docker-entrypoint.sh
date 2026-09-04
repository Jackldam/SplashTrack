#!/bin/sh
#
# SplashTrack container entrypoint — D-055's boot state machine.
#
# THE RULE, in one sentence: the container never migrates a database whose
# purpose is not yet known. An empty database is either a fresh installation or
# the first minute of a restore, and `migrate deploy && start` answers that
# question in the wrong direction — the operator ends up with a migrated empty
# schema and a backup that no longer restores cleanly into it.
#
# So this script detects state FIRST (`splashtrack boot:state`, whose predicates
# are D-098's and live in `src/lib/boot/state.ts`) and treats migration as a
# consequence of the state:
#
#   EMPTY     → setup mode. NO migrations. Serve the setup notice.
#   PARTIAL   → setup was interrupted. Resume setup mode. Still no migrations.
#   TAMPERED  → data present with no bootstrap record. REFUSE (D-099).
#   FAILED    → a migration is recorded unfinished/rolled back. REFUSE.
#   AHEAD     → the schema is newer than this image. REFUSE (D-043).
#   EXISTING  → pre-migration backup, then `migrate deploy`, then serve (D-044).
#   CURRENT   → serve.
#
# The state is not re-derived here. `boot:state` prints `<STATE> <ACTION>` on
# stdout and its explanation on stderr, and this script branches on the ACTION —
# so there is exactly one implementation of the predicates, in code that is
# covered by `tests/integration/boot-state-matrix.test.ts`.

set -eu

log() { printf '%s\n' "$*" >&2; }
fail() { log ""; log "$*"; log ""; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# 0. `secret:init` runs BEFORE anything is validated.
#
# It is the command that CREATES the bootstrap secret, so it necessarily runs on
# a host that has none and cannot start the application. Validating the
# environment first would make the only way out of "no key" require a key.
# ─────────────────────────────────────────────────────────────────────────────
case "${1:-} ${2:-}" in
  "splashtrack secret:init") exec "$@" ;;
esac
if [ "${1:-}" = "secret:init" ]; then exec splashtrack "$@"; fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. The four environment variables, checked before anything is attempted.
#
# D-037 permits an application-owned variable only when the value must be known
# before the database can be read, or when it selects where state lives. These
# are that whole surface. There is NO default for any of them: a default
# DATABASE_URL would let a misconfigured instance quietly reach the wrong
# database, which for a system holding children's records must never be a quiet
# outcome.
#
# The fourth is DATABASE_MAINTENANCE_URL, added by D-182 and ADR-0002 §8.
# ─────────────────────────────────────────────────────────────────────────────

[ -n "${DATABASE_URL:-}" ] || fail \
"DATABASE_URL is not set.

  It is where this instance's data lives and it has no default, deliberately:
  a default would let a misconfigured container connect somewhere unintended
  without saying so. Set it in your compose file or environment.

  It names the RUNTIME role, which owns nothing and can neither change nor
  delete an audit row (ADR-0002)."

[ -n "${DATABASE_MAINTENANCE_URL:-}" ] || fail \
"DATABASE_MAINTENANCE_URL is not set.

  It is the second of the two credentials D-182 requires, and this container
  cannot start without it. Migrations run through it, because the runtime role
  is deliberately NOT the schema owner — an owner re-grants itself in one
  statement, which is what made D-149 part 2 decorative. So does the audit
  exception, which has to be re-applied after every migration.

  It carries the retention role, which holds the only DELETE on AuditEvent.

      DATABASE_MAINTENANCE_URL=postgresql://splashtrack_retention:<password>@postgres:5432/splashtrack

  On a FRESH volume the reference compose file creates the three roles for you.
  On an EXISTING one, run infra/provision-roles.sql once — its header carries
  the exact command. See docs/adr/0002-database-roles-and-least-privilege.md."

[ -n "${BETTER_AUTH_URL:-}" ] || fail \
"BETTER_AUTH_URL is not set.

  It is this instance's public origin. Cookie and redirect origins come from
  it, and so does the WebAuthn relying-party id — which is why it cannot be a
  database-backed setting: it is read once when the auth context is built.

  WARNING (D-132): changing its HOST later invalidates every enrolled passkey
  at once. Set it to the address people will actually use."

# SECRET_KEY_FILE, and the deprecated plain SECRET_KEY (D-112 keeps the second
# so an install supplying it is not bricked; it is reported as a warning).
if [ -n "${SECRET_KEY_FILE:-}" ]; then
  [ -r "${SECRET_KEY_FILE}" ] || fail \
"SECRET_KEY_FILE is set to ${SECRET_KEY_FILE}, which cannot be read.

  Check the mount and its permissions. The file must be readable by the
  container's runtime user (uid 10001)."
elif [ -n "${SECRET_KEY:-}" ]; then
  log "WARNING: SECRET_KEY is supplied as a plain environment variable."
  log "  It is readable through \`docker inspect\`, /proc/<pid>/environ, crash"
  log "  dumps and — most often — a compose file committed to a repository."
  log "  Prefer SECRET_KEY_FILE (D-112). This fallback is deprecated."
else
  fail \
"There is no bootstrap secret, so this container refuses to start.

  SECRET_KEY is the root of every key this application uses: the Better Auth
  signing secret, TOTP secret encryption, settings secrets, encrypted columns,
  the backup master key and the audit checkpoint MAC are all HKDF derivations
  of it.

  THE APPLICATION WILL NOT GENERATE ONE FOR YOU, and that is the point. A key
  generated at start is a key that changes on the next start, and everything
  written under the old one — every medical remark, every stored secret, every
  TOTP enrolment — becomes permanently undecryptable while MFA is mandatory for
  administrators (D-166). Refusing to start is recoverable in one command;
  silently generating is not recoverable at all.

  Generate one, once, and keep it with your backups:

      docker compose run --rm app splashtrack secret:init --out /app/secrets/secret_key

  then set SECRET_KEY_FILE to where you mounted it."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Subcommands. `serve` is the default; anything else is executed as given, so
#    `docker compose exec app splashtrack …` and `docker compose run --rm app
#    splashtrack …` reach the same binary.
# ─────────────────────────────────────────────────────────────────────────────

case "${1:-serve}" in
  serve) ;;
  *) exec "$@" ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# 3. Detect the state, then act on it.
# ─────────────────────────────────────────────────────────────────────────────

log "SplashTrack: detecting database state before doing anything to it…"

# `set -e` would abort on boot:state's non-zero exit for a REFUSE state before
# this script could print anything useful, so the call is guarded and the exit
# code inspected.
if ! DECISION="$(splashtrack boot:state)"; then
  DECISION="${DECISION:-REFUSE REFUSE}"
fi

STATE="${DECISION%% *}"
ACTION="${DECISION##* }"

case "${ACTION}" in
  REFUSE)
    fail "SplashTrack refuses to start in state ${STATE}. The reason is above."
    ;;

  SETUP_MODE)
    log ""
    log "SETUP MODE (${STATE}). No migrations have been run."
    log ""
    log "  This installation has no administrator yet. Public self-registration"
    log "  is closed by design, so the first account is created from the host —"
    log "  host access is the proof of ownership every privileged operation"
    log "  here rests on:"
    log ""
    log "      docker compose exec app splashtrack admin:create \\"
    log "          --email you@example.org --name 'Your Name'"
    log ""
    log "  Until then every page serves the setup notice."
    log ""
    ;;

  MIGRATE_THEN_SERVE)
    log ""
    log "The schema is behind this image and migrations will be applied."
    log ""

    # D-044: an automatic pre-migration backup is taken whenever a start would
    # apply migrations. THE BACKUP ENGINE DOES NOT EXIST YET — D-095/D-169 make
    # the backup a structured logical export the application writes itself,
    # `pg_dump` is explicitly out of v1 scope and `postgresql-client` is
    # therefore not in this image, and the export/import engine is Phase-1 work
    # that has not landed.
    #
    # Migrating anyway with a warning would be exactly the shape the design
    # rejects everywhere else: doing the dangerous thing loudly. Refusing every
    # upgrade forever would be worse. So the operator acknowledges it ONCE PER
    # MIGRATING START, from the host, by creating a marker file — the same
    # host-access-is-authority pattern as D-101's setup token — and the marker
    # is consumed, so the next migrating start asks again.
    MARKER="/app/data/allow-unbacked-migration"
    if [ ! -f "${MARKER}" ]; then
      fail \
"Refusing to migrate: there is no pre-migration backup, and D-044 requires one.

  The backup engine is not built yet. D-095/D-169 make a SplashTrack backup a
  structured export the application writes and reads itself; \`pg_dump\` is out
  of v1 scope and is not in this image. So this container cannot take the
  snapshot D-044 asks for before it changes your schema.

  Take your own backup of the database, then acknowledge it once:

      docker compose exec app touch /app/data/allow-unbacked-migration
      docker compose restart app

  The marker is consumed by the migration, so the next upgrade asks again.
  This whole gate disappears when the export engine lands."
    fi

    log "Pre-migration acknowledgement found; consuming it."
    rm -f "${MARKER}"

    # Runs as DATABASE_MAINTENANCE_URL acting as splashtrack_owner —
    # prisma.config.ts derives that connection, so it is not spelled here and
    # no credential passes through this shell. Every table the migration
    # creates is therefore owned by a role that cannot log in.
    node /app/node_modules/prisma/build/index.js migrate deploy

    # Re-assert the role model over what the migration just created. NOT
    # optional and NOT once-per-install: `ALTER DEFAULT PRIVILEGES` hands the
    # runtime role ordinary DML on every new table — which is what keeps a
    # table added next month from being invisible to it — and that includes a
    # re-created `AuditEvent`. So the audit exception is taken back out here,
    # after each migration.
    #
    # This one DOES refuse the start on failure, unlike the report below it: a
    # migration that half-applied the grants leaves an instance whose audit
    # trail is deletable by the web process, and serving in that state is the
    # outcome D-149 exists to prevent.
    log "Re-applying the ADR-0002 role model over the new schema…"
    splashtrack db:apply-grants || fail \
"The database migrated, but the ADR-0002 role model could not be put back in
  force over the new schema. The reason is above.

  Refusing to serve: the runtime role may currently hold UPDATE or DELETE on
  AuditEvent, which is exactly the state D-149 part 2 exists to prevent."

    log "Migrations applied. Verifying the resulting state…"
    VERIFY="$(splashtrack boot:state)" || fail \
"The database is not in a serviceable state after migrating. See above."
    log "Post-migration state: ${VERIFY}"
    ;;

  SERVE)
    log "Schema is current. Serving."
    ;;

  *)
    fail "Unrecognised boot action '${ACTION}' from state '${STATE}'."
    ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# 4. The D-149 grant report — informational, never a reason to refuse.
#
# The INSERT-only role is a DEPLOYMENT step an operator runs as a privileged
# role (see `infra/audit-database-role.sql` for why it cannot be a migration).
# Printing what is actually true at every start is what stops "we ran that once"
# being the only evidence anyone has.
# ─────────────────────────────────────────────────────────────────────────────
splashtrack audit:grants || true

exec node /app/node_modules/next/dist/bin/next start --port "${PORT:-3000}" --hostname 0.0.0.0
