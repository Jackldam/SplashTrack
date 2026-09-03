# ADR-0001 — `LOG_LEVEL` is an environment variable, not a database-backed setting

- **Status:** Accepted
- **Date:** 2026-09-03
- **Decided by:** Jack (owner), on the daily report's question "LOG_LEVEL wordt uit config gelezen maar hoort volgens spec in de database — ADR maken of verwijderen?"
- **Governs:** D-037 (what may live in the environment), D-036/D-038 (in-app configuration)

## Context

`src/lib/logging/logger.ts:53` reads `process.env.LOG_LEVEL`, defaulting to `info`
in production and `debug` otherwise.

**D-037 is deliberately strict.** An application-owned environment variable is
permitted only when the value must be known *before the database can be read*, or
when it determines *where persistent state lives*. Everything else belongs in the
database-backed settings registry, and adding a variable requires an ADR
explaining why it cannot live in the database. This is that ADR.

At the time of writing the permitted set is `DATABASE_URL`, `APP_URL` and
`SECRET_KEY` (supplied as `SECRET_KEY_FILE`, D-112).

## The problem

`LOG_LEVEL` fails the letter of D-037's first test only if you assume logging
starts after the database is reachable. It does not.

The logger is constructed during module initialisation, before any connection is
opened, and it is the thing that reports **why** a connection failed. The boot
state machine (D-055) logs its state transitions — `EMPTY`, `PARTIAL`,
`EXISTING`, `AHEAD`, `FAILED` — and `AHEAD` and `FAILED` are precisely the states
in which the database is unusable or refuses to serve. A log level fetched from
the database would be unavailable in every situation where an operator most needs
to raise it.

## Options considered

**A. Move it to the settings registry, drop the variable.**
Consistent with D-036/D-038 and the smaller environment surface. But it makes
verbosity unavailable during boot failures, and it inverts the dependency: the
logger would depend on the database, which depends on the logger to report its
own failure. Rejected.

**B. Keep the variable, and add a database-backed *runtime* level that overrides
it once the application is serving.**
Gives an administrator in-app control (D-036's actual requirement) while keeping
a floor that works before the database does. Rejected for v1 — two sources for
one value is exactly the duplication D-134 forbids, and the second source buys
convenience rather than capability. Revisit if an operator ever needs to raise
verbosity without a restart.

**C. Keep the variable, and state plainly that it is not SplashTrack application
configuration.** — chosen.

## Decision

**`LOG_LEVEL` stays an environment variable, and is classified as a *platform*
variable rather than an application-owned one.**

D-037 already carves out this class explicitly: `TZ`, `NODE_ENV`, proxy settings,
CA bundle paths and container runtime settings are not counted as SplashTrack
configuration. `LOG_LEVEL` belongs in that group. It configures the process, not
the swim school: it holds no domain meaning, changing it alters no behaviour a
user can observe, and it is exactly the kind of knob a container platform expects
to set.

Consequences:

- The application-owned count is unchanged. `DATABASE_URL`, `APP_URL` and
  `SECRET_KEY` remain the only three.
- `LOG_LEVEL` is documented in `.env.example` under platform variables, not
  alongside the three.
- Changing it requires a container restart. Accepted: a self-hoster raising
  verbosity to diagnose something is already restarting.
- The settings registry gains no logging entry, and must not later grow one
  without superseding this ADR.

## Consequences for the reader of D-037

This ADR is the precedent for the rule's *shape*: the question is not "can this
value be stored in the database" but "does this value configure the product or
the process". A value that configures the process, has no domain meaning, and is
needed before the database opens is a platform variable. One that a swim school
would ever want to change belongs in the settings registry, whatever the
implementation convenience.
