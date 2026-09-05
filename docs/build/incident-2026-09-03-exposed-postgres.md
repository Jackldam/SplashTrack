# Incident — Postgres exposed to the internet, 2026-09-02 → 2026-09-03

**Severity: high. No data was at risk; a container-compromise path was open for
roughly 22 hours.** Written up because it is the first real incident on this
project and the lesson is worth more than the incident.

## What was exposed

The reference `docker-compose.yml` published Postgres as `'5432:5432'`, which
binds `0.0.0.0`. Combined with:

- `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-splashtrack}` — a default credential
  that also appeared in the committed file, on a **public** repository;
- the `postgres:16-alpine` image creating that role as a **superuser**
  (`rolsuper = t`);
- Docker publishing ports via `nat`/`FORWARD` with an empty `DOCKER-USER` chain,
  so the host firewall never saw the port at all.

Superuser access to Postgres is not merely data access. `COPY … FROM PROGRAM`
executes commands as the database user — demonstrated during the review,
returning `uid=70(postgres)`. So this was **command execution reachable from an
unauthenticated network position**.

## Window

- Container created **2026-09-02 23:04 UTC**, stopped **2026-09-03 20:55 UTC**.
- First hostile-looking log line **2026-09-03 00:43 UTC**.
- Approximately **22 hours**.

## What the log shows

156 `FATAL` entries. Two kinds:

- **Protocol probes** — `unsupported frontend protocol 0.0` / `255.255`,
  `no PostgreSQL user name specified in startup packet`. These are internet-wide
  scanners fingerprinting the port, in bursts at 00:43, 17:21 and 20:18 UTC.
- **Password attempts against user `postgres`** — repeatedly, in threes.

**Every failed attempt targeted `postgres`, a role that does not exist on this
instance.** The role is `splashtrack`.

## What cannot be proven

`log_connections` was **off**. Successful authentications were therefore never
logged. A scanner that tried `splashtrack` / `splashtrack` — the default in the
public repository — would have succeeded and left no line at all.

So: no evidence of compromise, and **no ability to prove its absence**. That
distinction is the honest one and it is why the response below assumes the
credential was disclosed rather than assuming it was not.

## What was actually at risk

Nothing of substance, verified before acting:

- `Person`: **0 rows**
- user-defined functions: **0** (only `plpgsql`)
- extensions: `plpgsql` only
- databases: only the expected set
- roles: only `splashtrack` plus the two audit roles created hours earlier

No pupil, guardian, medical note or audit record existed. The exposure was a
route into a container, not a route to data about children.

## Response

1. **Both containers stopped**, closing the port. (`docker compose stop` could
   not run — the hardened compose now *requires* `POSTGRES_PASSWORD`, which was
   not set in the shell. `docker stop` by container name worked.)
2. **Volume destroyed and recreated** rather than rotating in place. The
   compose variable is only read on first initialisation, so editing the file
   would have changed nothing on an existing volume. Since the database held
   nothing, destroying it is the cleaner fix: the default credential is *gone*
   rather than superseded.
3. **Fresh 40-character credential** generated into `.env` and `.env.uat`, both
   gitignored and `chmod 600`. The value was never printed to a terminal, a log
   or a chat.
4. **Binding changed to `127.0.0.1:5432`** and the default removed, so an unset
   password is now a loud failure.
5. Schema rebuilt, **307 tests green** against the new volume.

## Why it happened, and what the design says about it

The design was not silent on this. D-033 requires **no default credentials**,
and D-116 requires a least-privilege database role. Both were written down and
neither was enforced by anything that runs.

Two compounding factors made it worse than a missed checklist item:

- **The reference compose is documentation that executes.** A convenience
  default in an example file is a real credential the moment somebody runs the
  example — and this project's whole distribution model is "somebody runs the
  example".
- **The blocker for the least-privilege role was false.** The phase 1.0 report
  recorded that a non-superuser role breaks the test harness. Measured: the
  harness needs `CREATEDB`, never `SUPERUSER`. 305/305 pass as
  `NOSUPERUSER NOCREATEROLE NOBYPASSRLS CREATEDB`; 13 fail with `NOCREATEDB`.
  An unverified blocker kept a known control switched off.

## Follow-ups

- [ ] **ADR-0002's role model** — proposed, not adopted. It changes
      `DATABASE_URL` for every environment and is the owner's call.
- [ ] **`log_connections = on`** in the reference compose. This incident could
      not be characterised because it was off, and that is exactly when it
      matters.
- [ ] **A test that fails on a `0.0.0.0` published port** in the compose file.
      The rule now lives in a comment; comments do not run.
- [ ] **Audit-table ownership** — the `INSERT`-only revoke is inert while the
      application role owns the table (an owner re-grants itself in one
      statement; a superuser skips ACLs entirely). `audit:grants` now refuses to
      report "IN FORCE" in that state.
- [ ] The UAT instance on port 3100 was also published on `0.0.0.0`. It is
      stopped; it comes back behind the reverse proxy, not on a published port.

## The lesson worth keeping

**A control that is written down and not executed is not a control.** Three
decisions (D-033, D-116, D-149) all pointed at this and none of them ran. The
only reason this is a write-up rather than a breach notification is that the
database happened to be empty — which is luck, not design.
