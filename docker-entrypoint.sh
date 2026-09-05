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
#   EMPTY     → setup mode. NO migrations. Issue the one-time setup token and
#               point the operator at the /setup wizard (D-039/D-101/D-187).
#   PARTIAL   → setup was interrupted. Resume setup mode. Still no migrations.
#   PENDING_ENROLMENT
#             → the administrator exists and has not enrolled a second factor.
#               Setup mode; the token is already spent and the remaining step is
#               authenticated, so this branch issues none (D-185/D-186).
#   TAMPERED  → data present, and it is not an unfinished setup. REFUSE (D-099).
#   FAILED    → a migration is recorded unfinished/rolled back. REFUSE.
#   AHEAD     → the schema is newer than this image. REFUSE (D-043).
#   EXISTING  → pre-migration backup, then `migrate deploy`, then serve (D-044).
#   CURRENT   → serve.
#
# The state is not re-derived here. `boot:state` prints `<STATE> <ACTION>` on
# stdout and its explanation on stderr, and this script branches on the ACTION —
# so there is exactly one implementation of the predicates, in code that is
# covered by `tests/integration/boot-state-matrix.test.ts`.
#
# THE ACTION DECIDES WHAT HAPPENS; THE STATE DECIDES WHAT IS SAID. Two states
# reach SETUP_MODE with different remedies, and printing the wrong one is not a
# cosmetic failure — an operator who has already run `admin:create` and is told
# to run `admin:create` concludes their instance is broken. So the SETUP_MODE
# branch below reads ${STATE} to choose its message, and nothing else does.

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

      docker compose run --rm secret-init

  then set SECRET_KEY_FILE to where you mounted it. That command names the
  `secret-init` service and NOT `app`, deliberately: the reference compose file
  bind-mounts this key into `app`, and Docker will not create a container whose
  bind-mount source does not exist — so `app` cannot be the service that
  creates it."
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

    if [ "${STATE}" = "PENDING_ENROLMENT" ]; then
      # The administrator already exists, so the setup token has been spent and
      # the remaining step is authenticated. Issuing a fresh token here would
      # put an unusable credential on disk and invite an operator to try it.
      log "  The administrator account already exists and has NOT yet enrolled"
      log "  a second factor. There is nothing left to run on this host."
      log ""
      log "  Finish setup in a browser:"
      log ""
      log "      ${BETTER_AUTH_URL}/setup"
      log ""
      log "  Sign in with the password you chose. You are taken straight to a"
      log "  page showing a QR code for your authenticator; scan it, enter the"
      log "  six digits it shows, and this installation is set up. The TOTP"
      log "  secret is shown there and nowhere else — not in this log, not in a"
      log "  file, not on a terminal."
      log ""
      log "  Until then every page serves the setup notice, and the account may"
      log "  do exactly two things: sign in, and enrol."
      log ""
      log "  If you have lost that password, create another administrator from"
      log "  the host: admin:create is allowed and audited until setup"
      log "  completes."
      log ""
    else
      # ── The one-time setup token (D-101) ────────────────────────────────
      #
      # `--ensure` and NOT `--new`: an operator who restarts the container
      # mid-install must not find the token they wrote down silently replaced,
      # and one who comes back after the hour has run out must not find an
      # expired token with no instruction attached.
      #
      # ONLY THE PATH IS PRINTED, EVER. F-99: self-hosters paste
      # `docker compose logs app` into public issues and this repository is
      # public, so a token in this stream is a stranger becoming the
      # administrator of a school's instance. The command itself is what
      # guarantees that — it has no code path that prints the value.
      splashtrack setup:token --ensure || fail \
"A setup token could not be written to the data directory.

  The wizard at ${BETTER_AUTH_URL}/setup cannot open without one, and it is a
  file (D-101) rather than a line in this log for the reason above.

  Check that the data volume is mounted and writable by uid 10001. The
  reference compose file mounts \`splashtrack-data\` at /app/data; the image
  creates that directory owned by 10001 at mode 0700."

      log "  SET THIS INSTALLATION UP IN YOUR BROWSER:"
      log ""
      log "      ${BETTER_AUTH_URL}/setup"
      log ""
      log "  It asks for the one-time token whose path is printed just above."
      log "  Read it with:"
      log ""
      log "      docker compose exec app cat /app/data/setup-token"
      log ""
      log "  Then the wizard asks for the organisation's name, the first"
      log "  administrator's email and password, and shows a QR code for an"
      log "  authenticator. SETUP IS NOT COMPLETE until that second factor is"
      log "  verified (D-185) — and when it is, /setup closes for good."
      log ""
      log "  The token is in a file and not in this log ON PURPOSE. Logs get"
      log "  pasted into public issues, and whoever holds this token becomes"
      log "  the administrator of this installation (D-101)."
      log ""
      log "  NO RESTART IS NEEDED at any point: the application re-reads how"
      log "  far setup has got on every request."
      log ""
      log "  If you cannot use a browser here, the host path still exists and"
      log "  is audited:  docker compose exec app splashtrack admin:create"
      log "  --email you@example.org"
      log ""
    fi
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

    # Re-assert the role model even when nothing migrated.
    #
    # The MIGRATE branch above is not the only way a schema gets here. On a new
    # installation the tables are created by `splashtrack setup:init`, run from
    # the host inside this container while the server is already up in SETUP
    # MODE — and an instance built by an image whose `setup:init` did not yet
    # apply the grants reaches this branch on its next start with the runtime
    # role still holding DELETE on `AuditEvent`. Applying the model on every
    # serving start is idempotent, costs one short-lived connection, and means
    # "we ran that once" is never the only evidence.
    #
    # It refuses the start on failure for the same reason the MIGRATE branch
    # does: serving while the web process can delete audit rows is the outcome
    # D-149 part 2 exists to prevent.
    log "Asserting the ADR-0002 role model over the current schema…"
    splashtrack db:apply-grants || fail \
"The ADR-0002 role model is not in force on this database. The reason is above.

  Refusing to serve: the runtime role may currently hold UPDATE or DELETE on
  AuditEvent, which is exactly the state D-149 part 2 exists to prevent."
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
