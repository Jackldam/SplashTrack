# Phase 1.2 — The database role model

**What this phase did:** implemented ADR-0002 §5–§7 (D-182), moved the ADR to
**Accepted**, and made `splashtrack audit:grants` able to say *"D-149 part 2 is
IN FORCE"* truthfully — which it previously refused to say, correctly, because
it was not.

**Branch:** `build/v1-foundation`. **Suite:** 394 green before, **413 green
after**. Not pushed — Jack verifies and pushes.

> **Status lives in `docs/design/09-decision-register.md`, not here.** This
> report records what a phase *did* and what it *asked*. Phase 1.0 §9 wrote a
> status into a build report, four decisions were closed the same evening, and a
> status automation read the heading and told Jack they were still open. That
> §9 is corrected in this change; this report is written not to repeat it.

---

## 1. The one-sentence version

The audit trail was append-only because the *code* was careful. It is now
append-only because the *database refuses* — and the thing that makes the
difference is not the `REVOKE`, which was already written, but **who owns the
table**.

---

## 2. What was actually wrong, and why the fix is ownership

`infra/audit-database-role.sql` already revoked `UPDATE` and `DELETE` on
`AuditEvent` from the application role. ADR-0002 §3 found that this bought
nothing:

- **A table's owner holds its privileges by ownership, not by grant**, and
  re-grants them to itself in one statement. The actor D-149 names is an
  external SQL primitive — an injection, a stolen `DATABASE_URL` — and a
  primitive that can issue `DELETE` can generally issue `GRANT`.
- **And on the reference stack it bought nothing at all**, because
  `POSTGRES_USER` is created by the Postgres image as a **superuser**, and a
  superuser bypasses privilege checks outright. The revoke was not weak there.
  It was inert.

Every table was owned by the role in `DATABASE_URL`, because `prisma migrate
deploy` ran as it. So the precondition was: **move ownership to a role the
application never connects as.** That is what this phase did, and everything
else follows from it.

---

## 3. The four roles, as they exist now

Measured on the running database, from an empty volume:

```
        rolname        | rolsuper | rolcreatedb | rolcreaterole | rolcanlogin | rolbypassrls | rolinherit
-----------------------+----------+-------------+---------------+-------------+--------------+------------
 splashtrack           | t        | t           | t             | t           | t            | t
 splashtrack_app       | f        | f           | f             | t           | f            | t
 splashtrack_owner     | f        | f           | f             | f           | f            | t
 splashtrack_retention | f        | t           | f             | t           | f            | f

        member         |     member_of     | inherit_option
-----------------------+-------------------+----------------
 splashtrack_retention | splashtrack_owner | f

    tableowner     | count
-------------------+-------
 splashtrack_owner |    30
```

| Role | Credential | What it holds |
|---|---|---|
| `splashtrack_owner` | **none — `NOLOGIN`, no password** | Owns the schema, all 30 tables and every sequence. The identity that owns the data is one no connection string can name. |
| `splashtrack_app` | `DATABASE_URL` | Owns nothing. `SELECT, INSERT` on `AuditEvent`; `SELECT` on `AuditCheckpoint`; ordinary DML elsewhere. **This role *is* D-149's append-only writer** — there is no separate writer connection (ADR-0002 §7.5). |
| `splashtrack_retention` | `DATABASE_MAINTENANCE_URL` | The only `DELETE` on `AuditEvent`. A **non-inheriting** member of the owner, which is how `prisma migrate deploy` runs as a role that cannot log in. `CREATEDB` in development only. |
| `splashtrack` (the superuser) | `POSTGRES_PASSWORD` | Runs the provisioning SQL once. **In neither connection string.** That is the fix: it used to be in `DATABASE_URL`. |

---

## 4. `audit:grants`, before and after

**Before** (the honest red this phase had to earn its way out of):

```
D-149 part 2 is NOT in force, despite the grants above: the application role
OWNS AuditEvent and AuditCheckpoint.
```

**After**, run against the provisioned database:

```
Application database role: splashtrack_app

Owner of the audit tables:
  AuditCheckpoint  splashtrack_owner
  AuditEvent       splashtrack_owner

Grants on the audit tables:
  AuditCheckpoint  splashtrack_app              SELECT
  AuditEvent       splashtrack_app              INSERT
  AuditEvent       splashtrack_app              SELECT

D-149 part 2 is IN FORCE: the application role holds neither UPDATE nor DELETE
on AuditEvent, and does not own the table, so it cannot grant them back.
```

The same output from **inside the built image**, not only from a checkout:

```
$ docker compose run --rm app splashtrack db:apply-grants
Applying the ADR-0002 role model:
  owner     splashtrack_owner   (non-connecting)
  runtime   splashtrack_app
  retention splashtrack_retention

Applied as splashtrack_owner (session splashtrack_retention).
D-149 part 2 is in force: splashtrack_app holds SELECT and INSERT on
AuditEvent, owns nothing, and cannot grant itself more.
```

---

## 5. Where provisioning lives, and why (the question §7 left open)

| Step | Who | Where |
|---|---|---|
| Create the three roles | provisioning superuser, once per cluster | `infra/provision-roles.sql`, run **for** the operator by the Postgres image's `docker-entrypoint-initdb.d` hook on a fresh volume |
| Apply the model to a database | the maintenance credential, **after every migration** | `splashtrack db:apply-grants`, from `docker-entrypoint.sh` |

**Not a Prisma migration**, for the three reasons `infra/audit-database-role.sql`
already gave: role names belong to the operator, a migration would run as the
role it is revoking from, and granting needs privileges the runtime role must
not hold.

**Not a README step either**, and that is the change of mind this phase made.
**OD-15** fixes the audience at *"comfortable with `docker compose` on a host you
control"*, and says in as many words that this is **not** thereby comfortable
with PostgreSQL role grants. A README asking for four `CREATE ROLE` statements as
a superuser is a step most installs skip — and an install that skips it runs the
web application as a superuser, which via `COPY … FROM PROGRAM` is command
execution in the database container. The reference compose file is documentation
that executes, so it executes this too:

```
postgres-1  | /usr/local/bin/docker-entrypoint.sh: sourcing /docker-entrypoint-initdb.d/10-provision-roles.sh
postgres-1  | SplashTrack: provisioning database roles (createdb=on)…
postgres-1  |   splashtrack_retention: CREATEDB granted (development/CI only).
postgres-1  | SplashTrack roles provisioned. Next: splashtrack db:apply-grants (after migrations).
```

**The second half runs repeatedly, not once.** `ALTER DEFAULT PRIVILEGES` is what
keeps a table added by a future migration from being invisible to the runtime
role — and the same default hands that role `DELETE` on a re-created
`AuditEvent`. So the audit exception is re-applied after every migration.
`db:apply-grants` **verifies what it wrote and exits non-zero**, and the
entrypoint refuses to serve on that failure. `audit:grants` remains a report that
never refuses a start; the two have different jobs and now behave differently.

**An operator with an existing volume or a managed database** runs the same file
by hand; the exact command is in its header, and `infra/` ships in the image, so
`docker compose exec app cat infra/provision-roles.sql` works. Telling somebody
to fetch a file from GitHub to repair their own instance is a step that does not
happen at 23:00.

---

## 6. Configuration: one new variable, checked against D-037 rather than assumed

**`DATABASE_MAINTENANCE_URL`** is the only new application-owned variable.

- **It cannot live in the database** — it is how the database is reached. That is
  the justification D-037 accepts on its face, and ADR-0002 §8/§12.5 is the ADR
  D-037 requires.
- **It cannot be derived from `DATABASE_URL`**: different username *and*
  different password. Deriving it would put the maintenance role one string
  manipulation away from the runtime role, which is the entire separation.
- **The migration connection *is* derived, so it is not a third variable** —
  `DATABASE_MAINTENANCE_URL` plus `options=-c role=splashtrack_owner`, computed
  in `src/lib/database/role-model.ts` and nowhere else. Prisma's schema engine
  honours it: all 30 tables are owned by `splashtrack_owner` **at birth**, not
  reassigned afterwards.

**`SPLASHTRACK_APP_PASSWORD`, `SPLASHTRACK_RETENTION_PASSWORD` and
`SPLASHTRACK_PROVISION_CREATEDB` are COMPOSE variables, not application ones** —
read by the Postgres image's init hook, never by SplashTrack, exactly like
`POSTGRES_PASSWORD` and `APP_PORT`. They are not part of D-037's surface. The
duplication between a password and the same password inside a URL is
unavoidable — the image needs a value, the application needs a URL — and is
documented rather than hidden.

`DATABASE_MAINTENANCE_URL` is **required at boot**, not merely when retention
runs (`src/lib/env.ts`). D-181 makes upgrades apply migrations unattended, so an
instance missing it would start fine, serve fine, and fail at the moment recovery
is hardest — the next upgrade, against a schema the image has already moved past.

---

## 7. The test harness: `CREATEDB`, never `SUPERUSER`

Phase 1.0 §9.3 gave as the blocker for D-116 that a least-privilege role *"would
break the test harness's ability to create its `_test` databases"*. **That
conflates `CREATEDB` with `SUPERUSER`.** They are different role attributes and
only the first is needed; ADR-0002 §6 measured it both directions. §9 of that
report is corrected in this change, and the claim retracted there.

`CREATEDB` now sits on **`splashtrack_retention`**, in development and CI only,
and never on the runtime role. §6 says "the owner role carries `CREATEDB`", which
is unavailable once the owner is `NOLOGIN`; the maintenance credential is the
same trust zone and is what the harness actually connects as.

Putting it there rather than on the runtime role is the stronger choice, for §4's
own reason: **a checkout's runtime role is now shaped exactly like a production
one**, so a missing grant on a table a new migration created fails on a laptop
instead of for the first time after a deploy.

What moved onto the maintenance credential, and why each genuinely needs it:

| Harness step | Needs |
|---|---|
| `scripts/setup-test-db.ts` — create `splashtrack_test` | `CREATEDB` |
| `tests/integration/boot-state-matrix.test.ts` — a throwaway database per case, the only way to produce the `EMPTY` and `PARTIAL` states D-055 branches on | `CREATEDB` |
| `prisma migrate deploy` against either | schema ownership |
| the `pretest` audit-trail reset | `TRUNCATE`, which **no application role holds** on `AuditEvent` — not the runtime role, which is append-only, and not the retention role, which may only `DELETE` behind a checkpoint |

`npm test` needed no argument about privileges. It needed those four steps moved
onto the credential that legitimately has them.

---

## 8. What the new tests prove, and that they are not vacuous

`tests/integration/database-role-model.test.ts` (13 tests) and a rewritten
`tests/integration/audit-role-ownership.test.ts`.

1. **The runtime role cannot rewrite the trail.** `UPDATE`, `DELETE`, `TRUNCATE`
   and a raw `UPDATE` are each refused by PostgreSQL; it cannot `GRANT` the
   privilege back; it cannot `ALTER TABLE … OWNER TO` itself. `AuditCheckpoint`
   is `SELECT`-only, so it cannot forge a gap's alibi either.
2. **It is not a superuser and owns nothing** — `rolsuper`, `rolbypassrls`,
   `rolcreaterole` and `rolcreatedb` all false, both audit tables owned by
   `splashtrack_owner`, and zero tables in the schema owned by it.
3. **Retention prunes and the runtime role cannot.** The retention role prunes an
   expired prefix behind a checkpoint and the chain still verifies across the gap
   (`prunedSegments: 1`); the **identical call** — same function, same cutoff,
   one different client — is refused on the runtime connection.
4. **`audit:grants` tells the truth in both directions.** It reports IN FORCE on
   the provisioned database, and NOT in force against a database built with the
   runtime role owning the audit tables *and the revoke applied* — the exact
   state ADR-0002 §3 found, where the grant list looks right. Same function, two
   databases, two answers.

**Non-vacuity, measured rather than claimed.** The proofs were run against a
deliberately sabotaged database, twice:

```
GRANT UPDATE, DELETE ON "AuditEvent" TO splashtrack_app;
  × is refused an UPDATE by the database, not by the application
  × is refused a DELETE, a TRUNCATE and a raw UPDATE alike
  × cannot grant itself the privilege back, and cannot take the table
  × reports IN FORCE on the provisioned database
  Tests  4 failed | 12 passed

ALTER TABLE "AuditEvent" OWNER TO splashtrack_app;
  × owns neither audit table, and owns nothing at all
  × reports IN FORCE on the provisioned database
  × gives the runtime role no way to become an owner
  Tests  3 failed | 5 passed | 8 skipped
```

Restored: **413 passed**. Remove either half of the control and these go red,
including the report itself. That is the property phase 1.0's singleton tests
were held to, applied here.

---

## 9. A real defect the proofs found, which reading did not

**PostgreSQL role membership inherits by default.** `GRANT splashtrack_owner TO
splashtrack_retention` silently gave the retention role every privilege the owner
holds — `UPDATE` and `TRUNCATE` on `AuditEvent` included — with no `SET ROLE`
required:

```
UPDATE "AuditEvent" SET reason = 1;   -- UPDATE 0   ← permitted, silently
```

That would have made "the retention role holds `SELECT`, `INSERT` and `DELETE`
and nothing more" false at the moment it was written. **And `audit:grants` could
not have caught it**: a privilege held through an inherited membership does not
appear beside the role in `information_schema.table_privileges`, so the report
would have listed exactly the three intended privileges while the role held five.

The membership is now non-inheriting. Getting that portably is an **ordering**,
not a syntax: PostgreSQL 16 fixes the inherit option *on the membership, at grant
time*, from the member role's own `INHERIT` attribute — so `ALTER ROLE …
NOINHERIT` afterwards changes nothing, which is a quiet way to believe you have
fixed it. `GRANT … WITH INHERIT FALSE` is explicit but is PG16+ syntax. Setting
`NOINHERIT` **first** and then re-granting works on both, and is what
`infra/provision-roles.sql` does:

```
UPDATE "AuditEvent" …          -- ERROR: permission denied  ✓
SET ROLE splashtrack_owner …   -- permitted                 ✓
inherit_option                 -- f
```

**The cost, and how it was paid.** A non-inheriting member cannot drop a database
owned by the owner. So the throwaway databases — `splashtrack_test`,
`db:recreate`'s scratch, `boot-state-matrix`'s per-case ones — are created owned
by **retention**, and hand their `public` schema to the owner before anything is
created in it (`claimSchemaForOwner`). The tables still end up owned by
`splashtrack_owner`, which is the part ADR-0002 §3 requires.

---

## 10. Two places ADR-0002 contradicted D-182, and what was built

Both were put to Jack before implementation. No answer arrived inside the
window, so **the reading that makes the governing decision (D-182) coherent** was
implemented, and both are recorded in ADR-0002 §12.1. **Both are still Jack's to
overturn**, and neither is expensive to reverse.

**(a) `LOGIN` on the owner.** §7.2 gives `splashtrack_owner` `LOGIN` and makes it
the second configuration credential (§8); D-182 calls it *"a non-connecting
owner/migrator"*. Taken literally, §7.2 leaves §7.4's `splashtrack_retention`
with no connection string and therefore no way to run — a role that exists in the
document and nowhere else, which is the shape §3 argues against at length.

**Built as D-182 states it:** the owner is `NOLOGIN` with no password, and
`splashtrack_retention` is the second credential. The gain is concrete rather
than theoretical — one fewer password exists in the world.

**(b) The `INSERT` §7.4 omits.** §7.4 grants retention `SELECT, DELETE` on
`AuditEvent`. But a retention run is itself an audited action: `pruneAuditTrail`
appends `audit.retention_pruned` once its transaction commits, which D-168
requires. The role §7.4 describes could delete audit rows and could not record
having done so — the unaccounted gap this design exists to prevent. **`INSERT` is
granted**, and `infra/audit-database-role.sql` says why where the grant is made.

---

## 11. Where ADR-0002 §5 is now too strong

> "That job — retention — … gets the *second* username, the only one that may
> delete, **and the web application never holds it**." — §5

With **D-181**, upgrades apply migrations unattended, so the application
container must hold a credential that can migrate — and migrating means owning
the schema, which means being able to grant. The web application therefore *does*
hold `DATABASE_MAINTENANCE_URL`.

**What survives is the property the control was written for.** The actor named
throughout is an external SQL primitive: an injection, a stolen `DATABASE_URL`,
an exposed port — which, on the evidence of §2 of that ADR, is the one that was
actually reachable. That actor gets the **runtime** role, and the runtime role
cannot change or delete an audit row, cannot grant itself the ability, and cannot
own or drop the table. Reading the container's environment is host access, which
FM-7 and D-168 already concede is outside what any of this reaches.

There is no arrangement that avoids this while keeping D-181. Stated here rather
than left for a reader to find.

---

## 12. Definition of done — run, with output

| Check | Result |
|---|---|
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid 🚀` |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm run build` | `✓ Compiled successfully` |
| `npm test` | **413 passed (34 files)** — 394 before |
| `npm run db:recreate && npx prisma migrate deploy` | passes **from empty, with the role model in force**, not as a superuser |
| `docker compose build app` | image builds; verified in-image below |

`db:recreate` now ends where the container does, because since this change the
fresh-install path does not end at `migrate deploy`:

```
All migrations have been successfully applied.
[recreate-database] Role model in force on "splashtrack_freshcheck" (applied as splashtrack_owner).
```

**From a genuinely empty volume** (`docker compose down -v`), which is the state
this whole phase had to be right for:

```
postgres-1  | SplashTrack: provisioning database roles (createdb=on)…
postgres-1  | SplashTrack roles provisioned.
$ npx prisma migrate deploy      → All migrations have been successfully applied.
$ splashtrack db:apply-grants    → D-149 part 2 is in force.
$ splashtrack audit:grants       → D-149 part 2 is IN FORCE.
```

**Against the built image**, not only a checkout: `boot:state` reports
`EMPTY SETUP_MODE` on the empty database, `db:apply-grants` applies as
`splashtrack_owner` on a session authenticated as `splashtrack_retention`,
`audit:grants` reports IN FORCE, and `infra/` (including `provision-roles.sql`)
is present in the runner.

---

## 13. What a self-hoster must change in an existing `.env`

**Three lines added, one line changed.** `POSTGRES_*` variables are read only
when a Postgres volume is first initialised, so an existing instance keeps its
superuser until an operator acts.

```
# 1. CHANGE: DATABASE_URL now names the runtime role, not the superuser
DATABASE_URL=postgresql://splashtrack_app:<app-password>@postgres:5432/splashtrack

# 2. ADD: the second credential
DATABASE_MAINTENANCE_URL=postgresql://splashtrack_retention:<retention-password>@postgres:5432/splashtrack

# 3. ADD: the two role passwords the provisioning SQL creates the roles with
SPLASHTRACK_APP_PASSWORD=<app-password>
SPLASHTRACK_RETENTION_PASSWORD=<retention-password>
```

`POSTGRES_PASSWORD` stays, and becomes the **provisioning superuser's** password
— no longer an application credential.

Generate the passwords with **`openssl rand -hex 24`, not `-base64`**: base64
output contains `/`, and a `/` in a password ends the authority section of a URL,
so every command fails at once with `Invalid URL`. This bit the first run of this
change; the message now carries the fix, and `.env.example` says so.

**On an existing volume the roles do not exist yet**, because the init hook runs
only on a fresh one. One command, from `infra/provision-roles.sql`'s header:

```
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="…" -v retention_password="…" -v createdb=off \
  < infra/provision-roles.sql
```

then `docker compose up -d app`, whose entrypoint applies the rest. In a
**checkout**, add `SPLASHTRACK_PROVISION_CREATEDB=on` — `npm test` builds its own
databases.

The UAT volume additionally still needs the credential rotation ADR-0002 §2
asked for; that credential was disclosed and is unrelated to this change.

---

## 14. What CI needs, since `.github/workflows/` is outside write scope (D-025)

The integration job's database service must provision the roles, or every
role-model test fails and the rest of the suite fails to migrate at all.

1. **Provision before the suite.** After the Postgres service is healthy, run
   `infra/provision-roles.sql` as the service's superuser with
   `-v createdb=on` — CI creates databases exactly as a developer machine does.
2. **Set both connection strings** in the job environment:
   `DATABASE_URL` (`splashtrack_app`) and `DATABASE_MAINTENANCE_URL`
   (`splashtrack_retention`). `pretest` does the rest, including applying the
   role model to the `_test` database.
3. **Passwords with `openssl rand -hex 24`**, for the URL-parsing reason in §13.
   A base64 password in a CI secret fails with `Invalid URL` and no other clue.
4. **Worth adding as a gate:** assert `audit:grants` prints `IN FORCE` after
   `migrate deploy`. It is one line, it is the property this phase exists for,
   and it catches a provisioning regression that the unit tests would not.

---

## 15. What this phase deliberately did not do

- **`prisma migrate dev`** is untouched. It takes `--name` and not
  `--skip-seed`; it runs against the same maintenance connection as everything
  else and needs no change.
- **Row-level security and a `BEFORE DELETE` trigger** (ADR-0002 option E) stay
  rejected *for now*. That ADR says they become worth reconsidering **after**
  ownership is split, as defence in depth. Ownership is now split, so the
  reconsideration is live — but it is a separate decision and not a quiet
  addition to this one.
- **The audit retention FLOOR** is still not computed. `audit:verify
  --prune-before` still takes an operator-stated cutoff, because the floor is
  computed from the retention-policy columns and belongs with them (D-168,
  D-014/D-065). This phase gave retention a role to run as; it did not give it a
  schedule or a policy.
- **`docker-compose.yml`'s `POSTGRES_USER`** is still named `splashtrack`.
  Renaming it to `postgres` would read better now that it is only the
  provisioning superuser, and would break every existing volume. Not worth it.
