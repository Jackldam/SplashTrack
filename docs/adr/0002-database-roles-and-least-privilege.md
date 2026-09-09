# ADR-0002 — Database roles, least privilege, and how many connections this needs

- **Status:** **Accepted**, and implemented in phase 1.2.
- **Date:** 2026-09-03. **Accepted 2026-09-04 by Jack** — *"ADR-0002 ja doen"* — and recorded as **D-182**.
- **Implemented:** 2026-09-04, `docs/build/phase-1.2-database-roles-report.md`. §5–§7 are in force on this branch; §10 records what the earlier commit did and §12 what acceptance changed.
- **Decided by:** proposed by the security review Jack asked for ("laat een security agent hier met specialisme naar kijken"); the role model in §5–§7 was Jack's to accept or reject, and he accepted it.
- **Governs:** D-116 (the application role is not a superuser), D-149 part 2 (`INSERT`-only on `AuditEvent`), D-168 (checkpointed retention), D-037 (what may live in the environment)
- **Supersedes:** the "open, Jack's to decide" items 1 and 3 in `docs/build/phase-1.0-deployment-and-breakglass-report.md` §9

---

## 1. Summary

The question asked was whether the reference compose's superuser is acceptable.
Answering it turned up something more urgent, which §2 covers and which is
already fixed. The rest of this ADR answers the question as asked:

- **Three application connections are one too many.** D-149's separate
  append-only *writer* role earns nothing. Two are right: the runtime role and a
  maintenance role. §5.
- **The superuser is a real risk in UAT and in any self-hosted deployment, and a
  tolerable one on a laptop** — but only once the port is loopback-bound, which
  it was not. §4.
- **The stated blocker for D-116 is false.** The harness needs `CREATEDB`. It has
  never needed `SUPERUSER`, and the two are different privileges. Proved. §6.
- **D-149 part 2 has a precondition nobody wrote down**, and without it the
  control is decorative — on today's stack, entirely inert. §3.

---

## 2. Worse than the question I was asked, and already fixed

The reference compose published PostgreSQL on **every interface** and supplied a
**default password**:

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-splashtrack}
ports:
  - '5432:5432'
```

The comment beside it argued the default was "safe there and only there: the
service is reachable from the host". It was not, and this was live on the UAT
host at the time of review:

| Observation | Evidence |
|---|---|
| Bound to `0.0.0.0`, not loopback | `ss -ltnp` → `0.0.0.0:5432 docker-proxy` |
| DNAT'd from any non-bridge interface | `iptables -t nat -S DOCKER` → `! -i br-… --dport 5432 -j DNAT --to 172.22.0.2:5432` |
| Not filtered by ufw | `iptables -S DOCKER-USER` → **empty**. Published ports traverse `nat`/`FORWARD`, not `INPUT`, so the `ufw-user-input` blocklist never sees them |
| Password was the literal default | `.env.uat` `POSTGRES_PASSWORD` == `splashtrack`, 11 chars, one character class |
| Password auth accepted from anywhere | `pg_hba.conf` → `host all all all scram-sha-256`; `listen_addresses = '*'` |
| The role is a **superuser** | `SELECT rolsuper FROM pg_roles WHERE rolname='splashtrack'` → `t` (also `rolcreatedb`, `rolcreaterole`, `rolbypassrls`) |

Username, database name and password were all the string `splashtrack`. So the
whole of `postgresql://splashtrack:splashtrack@<host>:5432/splashtrack` was
guessable, and it reached a superuser.

**Superuser is not "read the data". It is command execution.** Measured on a
throwaway `postgres:16-alpine`:

```
COPY probe FROM PROGRAM 'id; uname -n';
→ uid=70(postgres) gid=70(postgres) groups=70(postgres)
```

That is a shell in the database container, plus every password hash in
`pg_authid`, from an unauthenticated network position. For an instance holding
children's medical and pastoral records this is the most severe finding in the
deployment surface, and it is not what the register was worried about.

**Fixed in this change** (`docker-compose.yml`):

- `ports: - '127.0.0.1:5432:5432'` — loopback only, and deliberately **not** a
  variable, because leaving it configurable puts re-exposure one typo away. The
  application never used this mapping; it reaches the database over the compose
  network at `postgres:5432`. It exists so `npm test` and `prisma` can run from
  the host, and that is loopback by definition.
- `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?…}` — required, no default, matching
  the treatment `DATABASE_URL` already had and the "no default credentials,
  ever" rule in `03-deployment-model.md` §1.2 that the compose file itself
  admitted it was breaking.

Either change alone would have prevented this. Both are cheap.

> **Jack — two things to do by hand, which this commit cannot do for you.**
> The password lives in the Postgres volume; the compose variable is read only
> when a volume is first initialised. So: `ALTER ROLE splashtrack PASSWORD '…'`
> on the existing UAT volume, then update `.env.uat` and `DATABASE_URL`. And
> treat the old credential as disclosed — it sat on a public IP under a
> guessable password for as long as the UAT stack has been up.

---

## 3. The precondition D-149 part 2 was missing

`infra/audit-database-role.sql` §3 revokes `UPDATE`/`DELETE` on `AuditEvent`
from the application role, and `splashtrack audit:grants` reported the resulting
empty grant list as **"D-149 part 2 is IN FORCE"**.

That reading is only true if the application role does not **own** the table. An
owner holds privileges by ownership rather than by grant, and re-grants them to
itself at will. Measured, on `postgres:16-alpine`:

```sql
REVOKE DELETE ON "AuditEvent" FROM app;
SET ROLE app; DELETE FROM "AuditEvent";            -- ERROR: permission denied   ✓
SET ROLE app; GRANT DELETE ON "AuditEvent" TO app;
              DELETE FROM "AuditEvent";            -- DELETE 1                   ✗
```

The actor D-149 names is *an external SQL primitive — an injection, a stolen
`DATABASE_URL`*. A primitive that can issue `DELETE` can generally issue `GRANT`
on the same primitive. So against the exact actor the control is written for,
the revoke buys one statement of delay while reading as though it buys the
property.

**And on the reference stack it buys nothing at all**, because the role is a
superuser and a superuser bypasses privilege checks outright. The suite now pins
both failure modes —
`tests/integration/audit-role-ownership.test.ts` — and on the current dev
database it takes the superuser branch, which is the honest description of every
instance built from today's compose file.

With ownership held by a role the application never connects as, the same
attempt fails on every door:

```
GRANT DELETE …               → WARNING: no privileges were granted
ALTER TABLE … OWNER TO app   → ERROR: must be owner of table
DROP / TRUNCATE              → ERROR: must be owner / permission denied
```

**Fixed in this change:** `audit:grants` now prints the table owner beside the
grants and refuses to say "IN FORCE" while the application role owns the table;
`infra/audit-database-role.sql` states the precondition where §3 is applied and
explains why those lines stay commented out. A security report that can be wrong
in the *reassuring* direction is worse than not having one.

---

## 4. Is the superuser a real risk? Three different answers

The reference compose is read as three different documents by three different
readers, and it deserves three different answers.

**The developer's laptop — tolerable, but not worth keeping.** A superuser
behind a loopback-only port with a non-default password is an acceptable risk:
the attacker already has the machine. The reason to change it anyway is not risk
but *fidelity*. Grant bugs — a missing `GRANT` on a table a new migration
created — are invisible to a superuser and appear for the first time in
production. A dev role shaped like the production role is where those surface
cheaply. Cost: one `CREATEDB`.

**UAT — not acceptable, on the design's own terms.** D-022 promotes **one image**
DEV → UAT → PROD, which makes UAT the rehearsal. A UAT running as superuser
rehearses nothing about the grants production depends on, and it is the instance
most likely to hold realistic data while being reachable. This one was reachable
from the internet (§2).

**A real self-hosted deployment — not acceptable, and this is the decision that
matters.** The stake is health data about children, self-hosted by swim schools
without a DBA, from AGPL source an attacker can read at leisure. The application
role is the blast radius of every SQL-injection class in the product, which is
D-116's own argument. As a superuser that radius includes:

- `COPY … FROM PROGRAM` — command execution as the `postgres` OS user (proved).
- `pg_authid` — every password hash on the server.
- `rolbypassrls` — any future row-level security silently ignored.
- `ALTER`/`DROP` on every table, and `pg_read_server_files`.

As a non-superuser non-owner it is confined to the rows the application is
supposed to touch. The difference is not incremental.

**So: no, the superuser is not a development convenience that is fine to keep.**
It is fine on a laptop and nowhere else, and since the reference compose *is*
what self-hosters deploy, it should not ship it.

---

## 5. Why more than one connection

*Written for a reader who has not read the decision register. This is the
question the daily report asked.*

A connection to PostgreSQL carries a username, and that username decides what
the connection is allowed to do. One username for everything means every part of
the application can do everything — including the parts an attacker reaches
first.

SplashTrack keeps an **audit trail**: an append-only log of who looked at which
child's medical note, who changed an exam result, who exported the member list.
Under GDPR Article 33 it is the thing that answers "what happened, to whom, and
when" after a breach. Its value depends entirely on being unfalsifiable — an
attacker who can delete four rows from it can make their visit never have
happened.

If the web application and the audit trail share one username, then anything
that hijacks the web application inherits the ability to erase the record of
doing so. The log is guarded by the same key as the door it is watching.

So the login page's connection gets a username that may **add** audit rows and
never change or remove them. It is not a restriction on *our* code — our code
does not delete audit rows anyway. It is a restriction on code we did not write:
a SQL injection, a stolen connection string in a leaked `.env`, a careless
script an operator pastes at 23:00.

But something must eventually delete old audit rows, because keeping them
forever is itself a GDPR problem. That job — retention — runs on a schedule from
the host, writes a signed checkpoint accounting for what it removed, and then
deletes. It gets the *second* username, the only one that may delete, and the
web application never holds it.

**That is the whole reason for the plural.** Two connections, because there are
two different levels of trust in one program: the part strangers can reach, and
the part only the operator can start. It costs one extra line in a `.env` file.

Two things it does not do, stated so nobody over-trusts it:

- It does not stop an administrator with access to the server. They hold
  `SECRET_KEY` and can forge a checkpoint. D-168 says so; the separation is
  aimed at the attacker who has a database, not a machine.
- It is not free. §8 is the price.

---

## 6. Resolving the test-harness conflict

The phase 1.0 report gave this as the blocker for D-116:

> Fixing it properly means a separate least-privilege role … would break the
> test harness's ability to create its `_test` databases.
> — `docs/build/phase-1.0-deployment-and-breakglass-report.md` §9.3

**The claim conflates `CREATEDB` with `SUPERUSER`.** They are different role
attributes, and only the first is needed. Measured, both directions:

| Role attributes | Result |
|---|---|
| `NOSUPERUSER NOCREATEROLE NOBYPASSRLS **CREATEDB**` | **305/305 passed, 25 files** |
| `NOSUPERUSER NOCREATEROLE NOBYPASSRLS **NOCREATEDB**`, test database pre-created | **13 failed** — `error: permission denied to create database` |

So `CREATEDB` is genuinely required, and the report was right that the harness
creates databases. It is required by more than `scripts/setup-test-db.ts`:
`tests/integration/boot-state-matrix.test.ts:69-70` drops and creates a
throwaway database per case, because that is the only way to produce the `EMPTY`
and `PARTIAL` states D-055 branches on. That is correct test design and should
not change.

But `CREATEDB` is a **developer-machine** privilege. Production never creates a
database — `docker-entrypoint.sh` runs `migrate deploy`, never `CREATE DATABASE`.
So the two needs do not conflict at all; they were only ever coupled by one role
serving both:

- **Development and CI:** the owner role carries `CREATEDB`. Nothing else changes,
  and `npm test` works untouched.
- **Production and UAT:** the same roles without `CREATEDB`.

No change to the harness is required, and none is proposed. The harness was
never the obstacle.

---

## 7. The decision: how many roles, and what each holds

Four named roles, of which **two** appear in application configuration.

### 7.1 `postgres` — the provisioning superuser

Already exists in any PostgreSQL. Used once, by the operator, to run the
provisioning SQL. **Never appears in a connection string the application holds.**
Today this is `POSTGRES_USER`, and the mistake is that `DATABASE_URL` points at
it.

*Stops:* nothing directly — it is the role whose absence from the application is
the point.

### 7.2 `splashtrack_owner` — owner and migrator

`LOGIN`, `NOSUPERUSER`, `NOCREATEROLE`. `CREATEDB` **in development only**. Owns
the schema and every table. Used by `prisma migrate deploy` at boot and by
nothing else.

*Stops:* the escalation in §3. Because the runtime role is not the owner, an SQL
primitive in the web process cannot `GRANT` itself back, cannot `ALTER TABLE …
OWNER`, cannot `DROP` and cannot `TRUNCATE`. This role is what converts D-149
part 2 from a comment into a property.

### 7.3 `splashtrack_app` — the runtime role (`DATABASE_URL`)

`LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`. Owns
nothing.

- `SELECT, INSERT, UPDATE, DELETE` on business tables
- `AuditEvent`: **`INSERT, SELECT` only**, plus `USAGE` on `AuditEvent_sequence_seq`
- `AuditCheckpoint`: `SELECT` only

*Stops:* the whole external-SQL-primitive class. An injection or a leaked
`DATABASE_URL` reaches application rows and cannot tamper with the record of
having done so, cannot execute commands, cannot read `pg_authid`, cannot drop a
table.

### 7.4 `splashtrack_retention` — the only role that may delete audit rows

`LOGIN`, `NOSUPERUSER`. Owns nothing. `SELECT, DELETE` on `AuditEvent`;
`SELECT, INSERT` on `AuditCheckpoint`. Used by `audit:verify --prune-before`
(D-168), invoked from the host or a scheduler, **never by the web process**.

*Stops:* the collapse of D-149 part 2 into nothing. Retention legitimately needs
`DELETE`; if that lived on the runtime role, the append-only property would be
void by construction. Separating it is what lets the runtime role be
`INSERT`-only at all.

### 7.5 Which one D-149 asked for that is not here

D-149 part 2 specifies *"a separate database role with `INSERT`-only grant on
`AuditEvent`"* — a distinct **audit writer** connection alongside the ordinary
application connection. The phase 1.0 report reads this as three application
connections. **It should be dropped.**

A second connection only buys something when the two credentials sit in
different trust zones. These would not: both pools would live in the same Node
process, in the same address space, reachable from the same injection. An
attacker with a SQL primitive in that process picks whichever pool suits them.
The separation would be a diagram, not a boundary.

Once §7.3 holds — the runtime role owns nothing and has `INSERT, SELECT` on
`AuditEvent` and nothing more — **the application role simply *is* the
append-only writer.** D-149's intent is met exactly; its literal role count is
not, and the count was the incidental part.

So: two connection strings, not three. **One new environment variable**, not two.

---

## 8. Consequences, and what it costs

**One new environment variable.** `DATABASE_MIGRATION_URL` (`splashtrack_owner`,
also used by retention). D-037 requires an ADR for a new application-owned
variable; this is it, and the justification is the one D-037 accepts on its face
— a connection string is how the database is reached, so it cannot live in the
database.

**Default privileges are the sharp edge, and they will bite.** With ownership
split, a table created by a future migration is invisible to the runtime role
until it is granted. Measured:

```sql
SET ROLE owner; CREATE TABLE "Later"(id int); RESET ROLE;
-- as the app role:
SELECT * FROM "Later";   → ERROR: permission denied for table Later
```

The mitigation is `ALTER DEFAULT PRIVILEGES FOR ROLE splashtrack_owner IN SCHEMA
public GRANT … TO splashtrack_app`, run once at provisioning, plus an explicit
`REVOKE` for the two audit tables afterwards because the default would otherwise
hand the runtime role `DELETE` on them. **This is the real cost of the
proposal:** a provisioning step that must be right, and whose failure mode is a
`permission denied` after an upgrade rather than at the moment of the mistake.
`audit:grants` at every boot is the counterweight, and it is why that command
exists.

**Existing instances do not migrate themselves.** `POSTGRES_*` variables are read
only when a volume is first initialised. Every existing checkout and the UAT
volume keep the superuser until an operator runs the provisioning SQL and
changes `DATABASE_URL`. This is the reason §7 is *proposed* rather than
implemented: it changes the connection string every existing environment uses,
and doing that silently inside a security review is exactly the class of
unannounced change this repository is careful about.

**Managed PostgreSQL keeps working, and gets better.** D-116 already notes that an
operator on a managed database creates the role themselves. On RDS or Cloud SQL
the provider's "superuser" is not one anyway, so this model is closer to what
those operators already have.

**What is not solved, stated plainly.** None of this reaches the compromised
administrator FM-7 names. They hold host access and therefore `SECRET_KEY`, and
can forge a checkpoint (D-168 says so). This ADR raises the floor under the
attacker who has a *database* — an injection, a leaked connection string, an
exposed port — which, on the evidence of §2, is the one that was actually
reachable.

---

## 9. Options considered

**A. Keep the superuser; document it.** Zero work, and it is what a self-hoster
will actually deploy. Rejected: it makes every injection a host compromise, and
D-116 exists precisely to refuse this.

**B. Least-privilege runtime role, but keep ownership with it.** One role, no new
variable, no default-privileges problem. Rejected: §3 — it cannot hold D-149
part 2 at all, because the owner re-grants itself. It would produce a green
`audit:grants` over an absent control, which is worse than the current honest
red.

**C. D-149 as literally written — three application connections.** Rejected in
§7.5: the writer/runtime split is not a trust boundary, and it costs a second
environment variable for a diagram.

**D. Owner + runtime + retention; two connection strings.** **Recommended.**
Holds every property D-116 and D-149 ask for, at one new variable and one
provisioning step.

**E. Row-level security or a `BEFORE DELETE` trigger on `AuditEvent` instead of
roles.** Tempting, and it needs no new connection. Rejected: both are owned by
the table owner, so under today's arrangement the application role can drop the
trigger or `ALTER TABLE … DISABLE TRIGGER` — the same ownership defect one level
up, with more machinery. It becomes worth reconsidering *after* D, as
defence in depth, not instead of it.

---

## 10. What this change actually did

Implemented, suite green before (305) and after (307):

1. `docker-compose.yml` — Postgres bound to `127.0.0.1`; `POSTGRES_PASSWORD`
   required with no default. (§2)
2. `.env.example` — `POSTGRES_PASSWORD` documented as required; the
   `CREATEDB` ≠ `SUPERUSER` distinction recorded next to `TEST_DATABASE_URL`.
3. `src/cli/commands/audit.ts` — `audit:grants` reports table ownership and no
   longer claims "IN FORCE" while the application role owns the audit tables.
   (§3)
4. `infra/audit-database-role.sql` — the ownership precondition stated where §3
   is applied, with the measurement that shows why.
5. `tests/integration/audit-role-ownership.test.ts` — two tests pinning the
   PostgreSQL behaviour the argument rests on, so it is re-checked rather than
   believed.

Deliberately **not** implemented, and left for Jack:

- The role model in §7. It changes `DATABASE_URL` for every existing
  environment and needs a provisioning script plus a documented migration for
  the existing UAT volume. Not small, and not a reviewer's call to make quietly.
- The `ALTER ROLE splashtrack PASSWORD` rotation on the UAT volume (§2).

---

## 11. Also checked, and clean

Verified against the running image rather than read from the Dockerfile:

| Property | Result |
|---|---|
| Secrets in image layers | **Clean.** `/app/secrets` and `/app/.env` absent from the final image; `.dockerignore` excludes `secrets/`, `.env`, `.env.*`, `*.pem`, `*.key` |
| Secrets via `docker inspect` | **`SECRET_KEY_FILE` holds a path, not a value** — D-112 holds. But `DATABASE_URL` carries its password in plain environment, visible to `docker inspect`. The design argues carefully that env vars are readable that way and then puts the database password in one. Worth a follow-up; not this ADR's scope |
| Non-root user | **Holds.** `docker run --entrypoint sh` → `uid=10001(splashtrack)`; the application tree is root-owned and read-only to it |
| Break-glass CLI reachable over the network | **No.** No import of `src/cli` from `src/app` or any route; its authority is host access, as documented |
| `SECRET_KEY_FILE` silently producing a wrong key (D-166) | **No silent path found.** File-first with a hard throw if unreadable — no fallback to `SECRET_KEY`; empty file rejected; under 32 bytes rejected; the base64-vs-passphrase decision in `decodeSecret` is a pure function of file content, and whitespace-insensitive on the base64 path. One rough edge worth knowing: 64 hex characters (`openssl rand -hex 32`) are all in the base64 alphabet and round-trip, so such a file is read as 48 decoded bytes rather than 64 text bytes. Deterministic, so not a D-166 violation, but the documentation should say "base64 or a passphrase" rather than leaving hex to chance |
| D-142 egress filtering | **Not implemented, and not yet a gap** — `grep` finds no outbound `fetch()` call site in `src/`. It becomes live with the first admin-configured destination (OIDC discovery, SMTP test, backup endpoint, version check) |
| Container network reach | The compose file declares no `networks:`, so the app container reaches the host LAN and any cloud metadata endpoint. That is the default for every Compose stack and D-142 is the intended control; noted, not faulted |

---

## 12. What acceptance changed, and where this ADR was wrong

*Added 2026-09-04, on implementing §5–§7. The sections above are left as they
were written, because a decision record that quietly edits its own reasoning is
worth less than one that shows where the reasoning was corrected.*

### 12.1 Two places where this ADR and D-182 disagreed

Both were resolved toward **D-182**, which is the governing decision. Both were
put to Jack before implementation; no answer arrived inside the window, so the
reading that makes D-182 coherent was implemented and is flagged here and in the
phase report.

**(a) §7.2 gives `splashtrack_owner` `LOGIN`. D-182 calls it *"a non-connecting
owner/migrator"*.** Taken literally, §7.2 also makes the owner the second
configuration credential (§8), which leaves §7.4's `splashtrack_retention` with
no connection string and therefore no way to run — a role that exists in the
document and nowhere else. That is the shape §3 spends a page arguing against.

**Implemented as D-182 states it.** `splashtrack_owner` is `NOLOGIN` and has no
password, so the identity that owns every table is one no connection string can
name and no leak can carry. `splashtrack_retention` is the second credential; it
is a **member** of the owner, and `prisma migrate deploy` runs as the owner by
`SET ROLE`. The gain over §7.2 is not theoretical: one fewer password exists.

**(b) §7.4 grants the retention role `SELECT, DELETE` on `AuditEvent`, and omits
`INSERT`.** But a retention run is itself an audited action — `pruneAuditTrail`
appends `audit.retention_pruned` once its transaction commits, which D-168
requires. The role §7.4 describes could delete audit rows and could not record
having done so, which is the unaccounted gap this whole design exists to
prevent. **`INSERT` is granted**, and `infra/audit-database-role.sql` says why
where the grant is made.

### 12.2 The membership inherits by default, which nearly made §7.4 false

Found by the proof tests, not by reading. PostgreSQL role membership is
**inheriting** unless told otherwise, so `GRANT splashtrack_owner TO
splashtrack_retention` silently handed the retention role every privilege the
owner holds — `UPDATE` and `TRUNCATE` on `AuditEvent` included — with no
`SET ROLE` required:

```
UPDATE "AuditEvent" SET reason = 1;   -- UPDATE 0   ← permitted, silently
```

**And it is invisible to the report.** A privilege held through an inherited
membership does not appear beside the role in
`information_schema.table_privileges`, so `audit:grants` would have listed
exactly the three intended privileges while the role held five.

The membership is now non-inheriting. The portable way to get that is an
ordering rather than a syntax: PostgreSQL 16 fixes the inherit option **on the
membership, at grant time**, from the member role's own `INHERIT` attribute — so
`ALTER ROLE … NOINHERIT` afterwards changes nothing, which is a quiet way to
believe you have fixed it. `GRANT … WITH INHERIT FALSE` is explicit but is PG16+
syntax. Setting `NOINHERIT` **first** and then re-granting works on both:

```
UPDATE "AuditEvent" …          -- ERROR: permission denied  ✓
SET ROLE splashtrack_owner …   -- permitted                 ✓
inherit_option                 -- f
```

### 12.3 §5 overstates one thing, and the correction matters

> "That job — retention — … gets the *second* username, the only one that may
> delete, **and the web application never holds it**." — §5

With **D-181**, upgrades apply migrations unattended, so the application
container must hold a credential that can migrate — and migrating means owning
the schema, which means being able to grant. The web application therefore
*does* hold `DATABASE_MAINTENANCE_URL`.

**What survives is the property the control was written for.** The actor named
throughout this ADR is an external SQL primitive: an injection, a stolen
`DATABASE_URL`, an exposed port. That actor gets the **runtime** role, and the
runtime role cannot change or delete an audit row, cannot grant itself the
ability, and cannot own or drop the table. Reading the container's environment
is host access — FM-7's actor, whom §8 already states this does not reach.

There is no arrangement that avoids this while keeping D-181. It is stated here
rather than left for a reader to notice.

### 12.4 Where role creation lives, and why (§7 left this open)

| Step | Who runs it | Where |
|---|---|---|
| Create the three roles | the provisioning superuser, once per cluster | `infra/provision-roles.sql`, run **for** the operator by the Postgres image's `docker-entrypoint-initdb.d` hook on a fresh volume |
| Apply the model to a database — ownership, schema access, default privileges, the audit exception | the maintenance credential, **after every migration** | `splashtrack db:apply-grants`, from `docker-entrypoint.sh` |

**Not a migration**, for the three reasons `infra/audit-database-role.sql`
already gave: role names belong to the operator, a migration would run as the
role it is revoking from, and granting needs privileges the runtime role must
not hold. **Not a README step either**, and that is the change of mind: OD-15
fixes the audience at *"comfortable with `docker compose`"* and says explicitly
that this is not thereby comfortable with PostgreSQL role grants. A README
asking for four `CREATE ROLE` statements as a superuser is a step most installs
skip, and an install that skips it runs the web application as a superuser —
which via `COPY … FROM PROGRAM` is command execution. The reference compose file
is documentation that executes, so it executes this.

The second half must run **repeatedly**, not once, because `ALTER DEFAULT
PRIVILEGES` hands the runtime role `DELETE` on any table a future migration
creates — including a re-created `AuditEvent`. Unlike `audit:grants`, which is a
report and never refuses a start, `db:apply-grants` is an action: it verifies
what it wrote and exits non-zero, and the entrypoint refuses to serve on that
failure.

### 12.5 The D-037 analysis §8 promised, done against the rule

**One new application-owned variable: `DATABASE_MAINTENANCE_URL`.** It cannot
live in the database — it is how the database is reached — which is the
justification D-037 accepts on its face.

**It cannot be derived from `DATABASE_URL`.** It carries a different username
*and* a different password; a scheme that derived one from the other would put
the maintenance role one string manipulation away from the runtime role, which
is the whole separation.

**The migration connection *is* derived, and is therefore not a third
variable** — `DATABASE_MAINTENANCE_URL` plus `options=-c role=<owner>`, computed
in `src/lib/database/role-model.ts` and nowhere else. Verified: Prisma's schema
engine honours it, and all 30 tables are owned by `splashtrack_owner` at birth
rather than reassigned afterwards.

**`SPLASHTRACK_APP_PASSWORD`, `SPLASHTRACK_RETENTION_PASSWORD` and
`SPLASHTRACK_PROVISION_CREATEDB` are COMPOSE variables, not application ones**,
exactly like `POSTGRES_PASSWORD` and `APP_PORT`: they are read by the Postgres
image's init hook and never by SplashTrack. They are not part of D-037's
surface. The duplication between a password and the same password inside a URL
is unavoidable — the image needs a value, the application needs a URL — and is
documented rather than hidden.

### 12.6 §6's resolution, implemented

`CREATEDB` sits on **`splashtrack_retention`**, in development and CI only
(`SPLASHTRACK_PROVISION_CREATEDB=on`), and never on the runtime role. §6 says
"the owner role carries `CREATEDB`", which is not available once the owner is
`NOLOGIN`; the maintenance credential is the same trust zone and is what the
harness actually connects as.

Putting it there rather than on the runtime role is the stronger choice for §4's
own reason: a checkout's runtime role is then shaped **exactly** like a
production one, so a missing grant on a table a new migration created fails on a
laptop instead of for the first time after a deploy. `npm test` needed no
argument about privileges — it needed its `CREATE DATABASE`, `migrate deploy`
and audit-trail `TRUNCATE` moved onto the credential that legitimately has them.

### 12.7 A trap for the operator, found the hard way

`.env.example` used to suggest `openssl rand -base64 24` for the database
password. base64 output contains `/` and `+`, and a `/` in a password ends the
authority section of a URL: `postgresql://user:a/b@host:5432/db` does not parse,
and every command fails at once with `Invalid URL` — four words that name
neither the password nor which of the two variables is at fault. The
documentation now says `openssl rand -hex 24`, and the parse failure carries the
fix. This bit the first run of this change.
