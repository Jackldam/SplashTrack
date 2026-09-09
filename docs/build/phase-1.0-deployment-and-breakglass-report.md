# Phase 1.0 — the deployment surface and the break-glass CLI

**Branch** `build/v1-foundation`. **From** `bbd644b` (end of phase 0.4b).
**Date** 2026-09-03.

Phase 0 built mechanisms nobody could reach. This phase is the part that makes
an instance exist: a container image, a boot sequence that will not damage a
database whose purpose it does not know, and a route to a first administrator on
a system where public self-registration is closed by design.

The goal it was measured against is not "the code compiles". It is **Jack signs
in**, with MFA, on a real instance, from an empty database. §5 is that, with the
output.

---

## 1. What landed

Five commits, each with the suite green before and after.

| Commit | What |
|---|---|
| `72e0ce2` | The boot state machine and the record it reads (D-055, D-098, D-099, D-100) |
| `eca7a72` | The break-glass CLI and the D-141 invariant (D-141, D-112, D-146) |
| `41a6e6e` | The container image, its entrypoint and the reference compose (D-033, D-037, D-112) |
| `4b31305` | The `INSERT`-only audit role, reported at every boot (D-149) |
| `5b3ec60` | **Fix:** D-098's predicate 3 makes its own recovery unreachable |
| *(this file)* | The report |

Suite: **281 → 305 tests, 23 → 25 files**, green before and after every commit.
`tsc --noEmit` clean, `eslint .` clean.

---

## 2. The container image (D-033)

One application image. PostgreSQL stays a second service in the reference
compose: bundling it would trap the data in a container and break every upgrade
and backup story.

Four stages — `deps`, `build`, `prod-deps`, `runner`. The runner copies build
*output* and never the toolchain.

### 2.1 The properties `03-deployment-model.md` §1.2 asks for, and which hold

| Property | Status | Evidence |
|---|---|---|
| No default credentials, ever | **Holds** | No `ENV` in the image carries a value; the entrypoint refuses to start without a readable bootstrap secret (§5.1) |
| No secret in any layer | **Holds** | `.dockerignore` excludes `secrets/`, `.env*`, `*.pem`, `*.key` in its first block. `/app/secrets` does not exist in the image (§5.2) |
| Runs as non-root | **Holds** | `USER splashtrack`, uid 10001. `id` inside the image reports `uid=10001(splashtrack)` |
| Multi-stage build | **Holds** | Four stages |
| Digest-pinned base image | **Holds** | `node:22-alpine@sha256:c610fcdf…` |
| Health and readiness endpoints | **Holds** | `/api/health`, `/api/ready`; `HEALTHCHECK` uses readiness |
| Migrations never run against an unknown state | **Holds** | §3, and the matrix in `tests/integration/boot-state-matrix.test.ts` |
| No devDependencies in the final layer | **Partly — see below** | `npm ci --omit=dev`, but upstream ships some anyway |
| Read-only root filesystem | **Not done** | Needs every writable path enumerated and proven; a flag added blind is worse than the gap |
| Published SBOM | **Not done** | §8 — CI is outside write scope (D-025) |
| `postgresql-client` present | **Deliberately absent** | D-169 puts `pg_dump`/`pg_restore` out of v1 scope entirely; shipping the client would ship tooling for a mechanism this version does not have |

**The devDependency claim is weaker than the flag implies, and it is measured
rather than assumed.** `npm ci --omit=dev` removes every devDependency *this
project* declares, and it does. It does not produce a layer free of development
tooling, because upstream packages declare some as ordinary dependencies:

```
├─┬ @prisma/client@7.10.0 └── typescript@5.9.3
├─┬ better-auth@1.7.2     └─┬ vitest@4.1.11 └─┬ vite@8.2.2 ├── esbuild
│                                                          └─┬ tsx
└─┬ next@16.3.4           └─┬ @playwright/test@1.62.1 └── playwright
```

No flag here removes them; the fixes are upstream, or a bundler that traces only
what is reached. The Dockerfile says so in its own header rather than letting the
flag imply otherwise. Image size is **359 MB**.

### 2.2 Two changes to the build that are not cosmetic

**`prisma` moved from `devDependencies` to `dependencies`.** It is a runtime
need: `migrate deploy` is what the boot state machine runs on an `EXISTING`
database, so an image without the Prisma CLI could not upgrade itself.

**`@prisma/engines`' postinstall is run explicitly in `prod-deps`.**
`npm ci --ignore-scripts` skips it, and without the schema-engine binary on disk
the first migrating start tries to *download* it — as the non-root runtime user,
into a root-owned tree. Found by running it:

```
Error: Can't write to /app/node_modules/@prisma/engines please make sure you
install "prisma" with the right permissions.
```

A start-up that reaches the network to fetch an executable is exactly what a
self-hosted image must not do. It is fetched at build time, once.

### 2.3 The CLI is a bundle

The runtime image has no TypeScript toolchain, and `tsc` alone cannot help
because it does not rewrite path aliases. `scripts/build-cli.ts` bundles
`src/cli/index.ts` with esbuild, `--packages=external` (our source is inlined;
other people's stays in `node_modules`), **with code splitting on** so the
dynamic `import()`s in the dispatcher stay dynamic — `secret:init` must run on a
host with no key and no database, and a single-file bundle would have loaded the
auth instance and the Prisma client on the way in.

One sharp edge, found twice by running it: Next.js has no `exports` map, so
`next/server`, `next/headers` and `next/navigation` are bare subpaths only a
CommonJS resolver can find. Node's ESM resolver does not guess the `.js`, so the
external import failed with `ERR_MODULE_NOT_FOUND` inside the image. A small
esbuild plugin rewrites single-segment `next/<name>` specifiers to their real
filenames; they stay external.

### 2.4 The reference compose

The existing `postgres` service is kept as it was. The `app` service carries
**no `DATABASE_URL` default at all** — Compose's required-variable form:

```yaml
DATABASE_URL: ${DATABASE_URL:?set DATABASE_URL in .env; there is deliberately no default}
```

An unset value stops `docker compose up` with that message rather than starting
an instance against something unintended.

The bootstrap secret is a **Docker secret**, not an environment variable (D-112):
an env var is readable through `docker inspect`, `/proc/<pid>/environ`, crash
dumps and — most commonly — the operator's own compose file, committed.

One ownership trap is documented in the file because it bit during this work:
Compose bind-mounts a `file:` secret with the host file's own uid and mode, so a
key written by root at 0600 is unreadable to uid 10001 and the container refuses
to start. Generating the key *through* the compose file avoids it entirely — the
command runs as uid 10001, so the file it creates is already owned correctly.

### 2.5 The environment surface is still exactly three variables

`DATABASE_URL`, `BETTER_AUTH_URL`, `SECRET_KEY_FILE` (with the deprecated plain
`SECRET_KEY` fallback D-112 keeps). No fourth was added, so no ADR is owed.

Two near-misses worth recording:

- **`DATA_DIR` was not read.** `13-…` §3.1 permits it and D-101 names
  `$DATA_DIR/setup-token`, but it arrives with the wizard that needs it. The
  MFA enrolment artefact takes a `--out` flag instead, defaulting to `./data`
  relative to the working directory — which in the image is `/app`, and
  `/app/data` is the volume the compose file mounts. When the wizard lands, that
  default becomes `$DATA_DIR` and the flag stays.
- **`APP_PORT` in the compose file is a Compose variable, not an application
  one.** It chooses which host port maps to the container's 3000. The
  application never reads it.

---

## 3. The boot state machine (D-055, D-098, D-099)

`src/lib/boot/state.ts`, called by the entrypoint through
`splashtrack boot:state`, which prints `<STATE> <ACTION>` on stdout and the
human explanation on stderr — so the shell branches on the first without losing
the second, and there is exactly one implementation of the predicates.

Raw SQL throughout: every predicate has to be answerable on a database whose
tables may not exist, and a Prisma model call against a missing table throws a
driver error that would have to be string-matched back into a state — the shape
of bug this machine exists to prevent. `prisma migrate status` exit codes are
not used; D-098 says they are not a stable API.

### 3.1 Behaviour in each state

| State | Predicate | What the container does |
|---|---|---|
| **EMPTY** | `_prisma_migrations` absent and no other tables | Setup mode. **No migrations.** Every page serves the setup notice naming the host command |
| **AHEAD** | a recorded migration this image does not ship | **Refuse to start**, naming the migration and therefore the image version required (D-043) |
| **FAILED** | a migration stuck mid-flight — `finished_at IS NULL` **and** `rolled_back_at IS NULL` | **Refuse to start**, naming the migration and the P3009 class, because restarting fails identically |
| **PARTIAL** | no completed bootstrap record, and zero `UserAccount`, `Person`, `RoleAssignment` | Setup mode, resumed. Still no migrations |
| **TAMPERED** | no completed bootstrap record, but data exists (D-099) | **Refuse to serve**, naming `bootstrap:clear-tampered` |
| **EXISTING** | bootstrap complete, image migrations unapplied | Pre-migration gate (§6.1), then `migrate deploy`, then serve |
| **CURRENT** | schema matches | Serve |

Also handled, and not one of D-098's six: **tables present with no
`_prisma_migrations` at all** is a schema this image did not create, and is
treated as `TAMPERED` — refuse, do not guess.

### 3.2 The test matrix

`tests/integration/boot-state-matrix.test.ts`, 14 cases, one per state plus the
ordering and correction cases. **Every case is a real throwaway database**, not
a stub: the failure this suite has to catch is a predicate that reads the wrong
thing, and a stub would only test the branch structure. `FAILED` and `AHEAD` are
not states a successful `migrate deploy` can produce, which is why the
`_prisma_migrations` rows are constructed directly.

The suite also asserts the property the whole machine is *about*, against the
real state→action mapping rather than inferring it from the cases:
`MIGRATE_THEN_SERVE` is reachable from exactly one state.

---

## 4. The break-glass CLI (D-141)

`splashtrack` on the image's PATH, so every command in `13-…` §7 reads exactly
as the design writes it. Its authority is **host access** — no token, no
password, no network path.

```
boot:state                      setup:init
admin:create --email <e>        admin:reset-mfa --email <e>
admin:grant-admin --email <e>   bootstrap:clear-tampered [--yes]
audit:verify [--prune-before]   audit:grants
secret:init --out <path>
```

Every command that changes anything writes an audit event **before** the change,
with the throwing `recordAuditEvent`: these are "no access without a record"
operations, and an MFA reset that happened with no trail is worse than one that
did not happen.

### 4.1 The `system:cli` actor

`system:cli` goes on `actorAuthMethod`, **not** on `actorPersonId`. That column
is a foreign key to a real `Person`, and the whole point of this CLI is that it
runs without one — its authority is host access, not an identity the application
can name. Putting a person id there would be a guess dressed as attribution.
What *is* knowable goes into `changedFields`, which is exactly the "machine
tokens, never values" shape that column is typed for:

```
sequence        | 1
eventType       | security.break_glass.admin_create
outcome         | SUCCESS
actorPersonId   |
actorAuthMethod | system:cli
changedFields   | {"role": "instance_administrator", "scope": "ORGANIZATION",
                   "command": "admin:create", "hostUser": "splashtrack",
                   "containerId": "11b0b604737a"}
reason          | break_glass_cli
```

### 4.2 The banner somebody else must dismiss

A `BreakGlassAlert` row per invocation. It is a table and not a read of the
audit trail because a notification has to carry "has a human acknowledged this",
and `AuditEvent` is append-only with no update path at all (D-149, D-168) — the
dismissal state cannot live there without breaking the one property the trail
exists for.

**There is deliberately no CLI command that dismisses one.** Host access is what
let the command run; it must not also be what makes the warning about it go
away. It is dismissed by a signed-in administrator holding
`organization.settings.manage` at `ORGANIZATION` scope, resource-referenced
(D-030), and that dismissal is itself audited — which is where *who* acknowledged
it is recorded. The alert carries no person column for the same reason: the
accountability belongs on the trail, not in a second mutable copy.

The banner renders **nothing** for a caller who cannot dismiss it. Not a
disabled control — a banner an instructor cannot act on is noise on the one
screen that has to stay fast at the poolside.

### 4.3 How a human enrols MFA without the secret landing in a transcript

**This is the constraint the whole of `src/cli/commands/admin.ts` is shaped
around, and the report was asked to say how it was solved.**

The threat is the paste, not the process. F-20 states as a design assumption
that self-hosters debugging a problem paste logs and terminal output into public
issues, and D-101 already redesigned the setup token around exactly that: the
token goes to a 0600 file and only its *path* is printed. A TOTP secret is
strictly worse than a setup token — it does not expire, and it is the second
factor on the highest-privilege account in the product. A terminal QR code is no
better than the URI: a screenshot is a paste.

So, four things together:

1. **The secret is never written to stdout, stderr or the logger.** It goes to
   one file, opened with `flag: "wx"` and `mode: 0o600` (and `chmodSync` after,
   because `mode` is masked by the umask on some platforms), in a directory
   created `0700`. The command prints only the path. Opening that file is a
   deliberate act on the operator's own host, not something that scrolls past in
   a terminal they were about to copy.
2. **The command then asks for a code from the authenticator and verifies it.**
   That is what makes the artefact *spent* by the time the command returns, so
   "delete this file" is real advice rather than a suggestion to destroy the only
   copy of something still needed. It also satisfies D-141's word *verified*:
   enrolled-but-unverified is a login nobody can complete, and counting it would
   satisfy the invariant with an unusable account.
3. **A failed verification rolls the account back.** No half-created
   `ORGANIZATION`-scoped account is left with no second factor.
4. **The password never enters an argument vector.** `--password-file`, or a TTY
   prompt with echo disabled. No command takes a password as a flag value — a
   flag value is in the shell history and in `ps` output for every user on the
   host. The CLI's own session, held only to drive the enrolment endpoints, is
   deleted before the command returns.

The enrolment goes through Better Auth's **public** API (`enableTwoFactor`,
`verifyTOTP`) with the real session cookie, rather than writing the `TwoFactor`
table directly. Writing it directly would mean owning Better Auth's TOTP secret
encryption format by hand — a thing that silently breaks on a library upgrade
and is discovered by an administrator who cannot log in.

Measured on the live instance (§5.6): the TOTP secret appears **zero** times in
`docker compose logs app`.

### 4.4 `admin:reset-mfa` re-enrols in the same command

Not a convenience. D-141 says a verified factor must exist **at all times**, and
a reset that only *deleted* the factor would break the invariant on the sole
administrator of a single-administrator installation — which is precisely the
installation this command exists for. Delete and re-enrol in one command means
the invariant is false for the length of one command and true again before it
returns; if verification fails, the previous factor is restored rather than left
absent.

### 4.5 `admin:grant-admin` is 24 hours

`13-…` §7: *"the use case is recovery, not provisioning"*. `grantedByPersonId`
is left NULL, which is what that column means for a grant issued from outside
the grant service — seeding, the wizard and this CLI are host-access-proven
rather than issued by a person the application can name.

### 4.6 The D-141 invariant, as a database question

`src/lib/auth/local-admin-invariant.ts`, with a test per clause
(`tests/integration/local-admin-invariant.test.ts`, 10 cases). Each clause is
load-bearing and each is checked: **local** (a `credential` account row with a
non-null password — an account that can only sign in through an external
provider is no help recovering from a broken external provider), **verified**
(`TwoFactor.verified = true`), **`ORGANIZATION`-scoped**, **live window**,
**active account**.

It binds to the `roles.assign` **permission** and never to a role name: roles are
user-definable, so a name is not a predicate (D-130).

`countLocalOrganizationAdmins(excludeUserAccountId)` answers the question a
caller actually has — *would it still hold **after** I do this?* — without a
speculative write. The two call sites that do not exist yet (the settings write
path for `Authentication`/`Security`, and role revocation / account disable)
import `assertLocalAdminInvariantHolds` rather than re-deriving it.

**What was deliberately not built:** a `testConnection()` gate. F-140 is explicit
that "working authentication method" is not decidable, and calling a
test-connection a safety net is how an implementer builds the bypassable check
and ships.

### 4.7 Seeding

`src/lib/boot/seed.ts`, idempotent by construction (every write an upsert on a
stable machine key), because `PARTIAL` means "setup was interrupted; resume".

Seeded: the 63-permission catalogue, the `Organization` singleton, and **two**
system roles — `instance_administrator` (the whole catalogue; D-139 lets a
granter grant only what they hold, and there is no principal above them to add
the rest) and `self` (D-146's closed set, an explicit seeded assignment, never an
implicit match).

**The other eight starter roles in `02-…` §2.4 are not seeded.** §2.4 gives each
a typical scope and a sentence of purpose; no document in the design set states
their permission sets, and those sets are not derivable from a sentence.
Inventing them here would put a guess into the table that decides who can read a
child's medical remark. §2.4 itself says every starter role is "a starting point,
not a fixed object" — they belong to the modules that define the permissions they
carry. An empty seeded role would be worse than none: it looks like a
misconfiguration.

---

## 5. Proving it end to end

Everything below is real output from a `docker compose` stack on this host, app
image `splashtrack:local`, against `splashtrack_uat` — an **empty** database
created for the purpose.

### 5.1 The image refuses to start with no bootstrap secret

```
$ docker run --rm -e DATABASE_URL=… -e BETTER_AUTH_URL=… splashtrack:local

There is no bootstrap secret, so this container refuses to start.

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

  then set SECRET_KEY_FILE to where you mounted it.
```

An unreadable `SECRET_KEY_FILE` is a distinct message naming the path and the
uid. A missing `DATABASE_URL` is its own. All three are refusals, not warnings.

### 5.2 `secret:init` runs with no environment at all, and refuses to overwrite

```
$ docker run --rm -v /tmp/st-secret-proof:/out splashtrack:local \
      splashtrack secret:init --out /out/secret_key
Wrote a new bootstrap secret to /out/secret_key (mode 0600).
Point SECRET_KEY_FILE at that path, and BACK THE FILE UP:
losing it means every encrypted value and every TOTP enrolment is gone.

$ ls -la /tmp/st-secret-proof/
-rw-------   1 10001 10001   44 secret_key

$ docker run --rm -v /tmp/st-secret-proof:/out splashtrack:local \
      splashtrack secret:init --out /out/secret_key
Refusing to overwrite /out/secret_key: it already holds a bootstrap secret.
Replacing it makes every encrypted value and every TOTP enrolment permanently
unreadable. Rotation is a separate, re-encrypting operation (design 13 §5.3).
exit=1
```

Note the ownership: `10001:10001`, because the container ran as its own
non-root user. That is what makes the documented generation path also the one
that mounts correctly.

`/app/secrets` does not exist inside the image — nothing is copied from the
host's `secrets/`:

```
$ docker run --rm --entrypoint sh splashtrack:local -c 'ls /app/secrets'
ls: /app/secrets: No such file or directory
$ docker run --rm --entrypoint sh splashtrack:local -c 'id'
uid=10001(splashtrack) gid=10001(splashtrack) groups=10001(splashtrack)
```

### 5.3 EMPTY — setup mode, and nothing is migrated

```
$ docker compose up -d app
$ docker compose logs app

SplashTrack: detecting database state before doing anything to it…
SplashTrack 0.1.0 — boot state EMPTY
  The database holds no tables. This is either a fresh installation or the first
  minute of a restore, and only the operator knows which — so nothing is
  migrated. Setup mode.

SETUP MODE (EMPTY). No migrations have been run.

  This installation has no administrator yet. Public self-registration
  is closed by design, so the first account is created from the host —
  host access is the proof of ownership every privileged operation
  here rests on:

      docker compose exec app splashtrack admin:create \
          --email you@example.org --name 'Your Name'

  Until then every page serves the setup notice.

The audit tables do not exist yet — this installation has not been migrated.
Nothing to report; run this again after setup.
▲ Next.js 16.3.4  ✓ Ready in 223ms
```

The database is genuinely untouched, and the app genuinely serves:

```
$ psql -d splashtrack_uat -tAc "SELECT count(*) FROM information_schema.tables
                                 WHERE table_schema='public'"
0
$ curl -s http://localhost:3100/api/ready
{"status":"ready","checks":[{"name":"process","status":"ok"},
                            {"name":"database","status":"ok"}], …}
```

What a browser gets at `/`:

> **Deze installatie is nog niet ingericht**
> Er is nog geen beheerder. Maak de eerste aan vanaf de host — toegang tot de
> host is hier het eigendomsbewijs:
> `docker compose exec app splashtrack admin:create --email you@example.org …`
> Zelfregistratie bestaat niet: accounts worden door een beheerder aangemaakt.

`/sign-in` returns `307 → /` while the installation is unconfigured: there is no
account to sign in to.

### 5.4 Creating the first administrator

```
$ docker compose exec app splashtrack admin:create \
      --email jack@sysadminheaven.nl --name 'Jack' \
      --password-file /app/data/pw --out /app/data

Boot state EMPTY: applying migrations…
  Applying migration `20260902230852_foundation_identity_authorization_settings_audit`
  … 11 migrations …
  All migrations have been successfully applied.
Migrations applied.
Seeding the permission catalogue and the system roles…
  63 permission(s), roles: instance_administrator, self, organisation singleton created

MFA enrolment written to:
    /app/data/mfa-enrolment-1788453967543-jack_sysadminheaven_nl.txt

That file holds the TOTP secret and the backup codes. It is NOT printed here and
must not be pasted anywhere. Open it on this host, add the account to your
authenticator, then delete the file.

Six-digit code from your authenticator: ******

Administrator created: jack@sysadminheaven.nl
  role       instance_administrator @ ORGANIZATION
  MFA        TOTP, verified
  audit      xxpir1hukaoo88l5frztnpmb
  banner     raised for all administrators; it is dismissed in-app, not from here

Delete /app/data/mfa-enrolment-1788453967543-jack_sysadminheaven_nl.txt once your
authenticator is set up.
```

The artefact, and only the artefact:

```
$ docker compose exec app ls -la /app/data/mfa-enrolment-*.txt
-rw-------  1 splashtrack splashtrack  678  mfa-enrolment-…-jack_sysadminheaven_nl.txt
```

### 5.5 Signing in — through the browser surface, MFA included

Driven against the rendered forms (Next.js Server Actions, no client
JavaScript), which is what a browser posts:

```
$ curl -c jar http://localhost:3100/sign-in     # the password form
  <label class="form-label" for="email">E-mailadres
  <label class="form-label" for="password">Wachtwoord

$ curl -b jar -c jar -X POST http://localhost:3100/sign-in \
       -F email=jack@sysadminheaven.nl -F password=… -F "$ACTION_ID_…="
HTTP 303
--- cookies now ---
better-auth.two_factor            ← a challenge, not a session

$ curl -b jar http://localhost:3100/sign-in     # the page now asks for the code
  Voer de code uit je authenticator-app in.
  <label class="form-label" for="code">Zescijferige code

$ curl -b jar -c jar -X POST http://localhost:3100/sign-in \
       -F code=<from the authenticator> -F "$ACTION_ID_…="
HTTP 303
Location: /
--- cookies now ---
better-auth.session_token         ← a real session
```

And the same flow at the API level, showing the intermediate state explicitly:

```
$ POST /api/auth/sign-in/email          {"twoFactorRedirect":true,"twoFactorMethods":["totp"]}
$ GET  /api/auth/get-session            null                    ← the password alone is not a session
$ POST /api/auth/two-factor/verify-totp {"code":"000000"}       → HTTP 401 {"code":"INVALID_CODE"}
$ POST /api/auth/two-factor/verify-totp {"code":<real>}         → HTTP 200
$ GET  /api/auth/get-session
{
  "session": { "expiresAt": "2026-09-04T16:37:16.566Z", "ipAddress": "172.22.0.1", … },
  "user":    { "email": "jack@sysadminheaven.nl", "twoFactorEnabled": true,
               "personId": "sb565ictw1b6xo75v25tqavp", … }
}
```

The landing page, signed in:

> **Noodtoegang gebruikt**
> Iemand met toegang tot de host heeft een break-glass-commando uitgevoerd.
> Controleer of dat klopte voordat je deze melding wegklikt.
> `admin:create` 2026-09-03T16:46:07.260Z **[Gezien]**
>
> SplashTrack — Ingelogd als jack@sysadminheaven.nl.

Dismissing it (as the signed-in administrator, not from the CLI):

```
$ psql -c 'SELECT command, "dismissedAt" IS NOT NULL AS dismissed FROM "BreakGlassAlert";'
   command    | dismissed
--------------+-----------
 admin:create | t
```

### 5.6 The secret is nowhere it should not be

```
$ docker compose logs app | grep -c "$TOTP_SECRET"
0
```

### 5.7 The other boot states, against the live container

**CURRENT**, on restart:

```
SplashTrack 0.1.0 — boot state CURRENT
  The schema matches this image (11 migration(s) applied). Serving.
```

**TAMPERED** — the bootstrap record deleted on a populated database:

```
SplashTrack 0.1.0 — boot state TAMPERED
  There is no completed InstallationBootstrap record, but the installation holds
  data (1 person row(s), 1 account(s), 2 role assignment(s)). Setup mode is an
  UNAUTHENTICATED administrative surface and must never open on a populated
  database (D-099), so this refuses to serve. Clear it deliberately from the host
  with `splashtrack bootstrap:clear-tampered` once you know why the record is
  missing.

SplashTrack refuses to start in state TAMPERED. The reason is above.
```

and its recovery, which does not delete anything:

```
$ docker compose run --rm app splashtrack bootstrap:clear-tampered --yes
This installation holds data but has no completed InstallationBootstrap record.
Clearing this state writes the record and closes setup mode. It does not delete
anything, and it does not explain how the record went missing — a deleted row
here is also what an attacker would produce to reopen the unauthenticated setup
surface (D-099, F-98). Check the audit trail before continuing.

TAMPERED cleared. Audit aeaszkjmpbdzdru11rxe6rqq.
```

**AHEAD** — a migration row this image does not ship:

```
SplashTrack 0.1.0 — boot state AHEAD
  The database schema is NEWER than this image: it has migration(s) this image
  does not ship (29990101000000_from_a_newer_release). Forward-only migrations
  make an older application on a newer schema undefined behaviour, so this
  refuses to start rather than corrupt data (D-043). Run the image version that
  shipped those migrations.
```

**FAILED** — a migration recorded unfinished:

```
SplashTrack 0.1.0 — boot state FAILED
  A migration is recorded as started and never finished
  (20260903170000_installation_bootstrap). Prisma leaves it recorded and it
  blocks every later migration, so restarting will fail identically (P3009).
  Restore the pre-migration backup taken before that start, or resolve it
  deliberately with `prisma migrate resolve` from the host.
```

**EXISTING** — one migration removed from the record, then a real upgrade. The
D-044 gate fires first (§6.1), and after the acknowledgement:

```
Pre-migration acknowledgement found; consuming it.
  Applying migration `20260903132751_retention_policy_per_data_class`
  The following migration(s) have been applied.
Migrations applied. Verifying the resulting state…
Post-migration state: CURRENT SERVE
```

with the marker consumed — `/app/data` afterwards holds only the enrolment
artefact and the password file, no `allow-unbacked-migration`.

**FAILED arose naturally during this**, which is the most useful evidence in this
report. The first attempt at the EXISTING path migrated against a schema this
test had hand-damaged, and Prisma failed mid-migration:

```
Applying migration `20260903132751_retention_policy_per_data_class`
Error: P3018 — A migration failed to apply.
Database error code: 42710
Database error: ERROR: type "DataClass" already exists
```

The next start reported `FAILED` and refused, exactly as designed. **And then the
documented recovery did not work** — see §7.2, which is a correction to D-098.

### 5.8 The remaining break-glass commands

```
$ splashtrack admin:grant-admin --email jack@sysadminheaven.nl
Granted instance_administrator @ ORGANIZATION to jack@sysadminheaven.nl until
2026-09-04T16:54:02.028Z (24 hours). Audit u8ib2i3u4uqzr4nbclneqdlf.
This grant EXPIRES. Make a standing one through the application, where D-139's
anti-amplification rules apply.
```

```
          key           |  scopeType   |       validUntil
------------------------+--------------+-------------------------
 instance_administrator | ORGANIZATION |                          ← from admin:create
 self                   | SELF         |                          ← D-146
 instance_administrator | ORGANIZATION | 2026-09-04 16:54:02.028  ← the 24-hour grant
```

```
$ splashtrack admin:reset-mfa --email jack@sysadminheaven.nl --password-file …
New MFA enrolment written to:
    /app/data/mfa-enrolment-1788454453508-jack_sysadminheaven_nl.txt
It is not printed here. Open it on this host, enrol, then delete it.
MFA reset and re-enrolled for jack@sysadminheaven.nl. Audit dam33mkog2x72fgazj1kk2nw.
```

The old factor is dead and the new one works:

```
old code → HTTP 401 {"message":"Invalid code","code":"INVALID_CODE"}
new code → HTTP 200 {"token":"Y1ThqYwSbAEfrfb0QCGCJNL7y56q2Lk5", … }
```

`admin:create` refuses on a configured installation:

```
This installation has already completed first-run setup (2026-09-03T16:48:05.423Z).
`admin:create` creates the FIRST administrator and is refused afterwards — an
unaudited second path to an ORGANIZATION-scoped account is the thing D-141's
invariant exists to make unnecessary. To recover access to an existing account use
`admin:grant-admin` or `admin:reset-mfa`.
```

### 5.9 The audit trail, after all of it

```
$ splashtrack audit:verify
Audit chain intact across 0 pruned segment(s); 11 event(s) verified.

 1  security.break_glass.admin_create             SUCCESS  system:cli
 2  security.two_factor_login                     SUCCESS  session
 3  security.two_factor_login                     SUCCESS  session
 4  security.break_glass.acknowledged             SUCCESS  session
 5  security.break_glass.bootstrap_clear_tampered SUCCESS  system:cli
 6  security.break_glass.admin_grant_admin        SUCCESS  system:cli
 7  security.break_glass.admin_reset_mfa          SUCCESS  system:cli
 8  security.password_login                       SUCCESS  session
 9  security.two_factor_login                     SUCCESS  session
10  security.two_factor_login                     FAILURE  session
11  security.two_factor_login                     SUCCESS  session
```

Event 8 is worth reading: it is the session `admin:reset-mfa` itself established
to drive the enrolment endpoints, after it had removed the old factor. It is a
genuine password-only sign-in and it says so on the trail rather than hiding.

---

## 6. The `INSERT`-only audit role (D-149)

`src/modules/audit/infrastructure/audit-repository.ts:14` carried a `PHASE 0.4`
marker saying this was missing. `infra/audit-database-role.sql` has existed since
0.4a — unrun and, more importantly, unreported.

### 6.1 The decision: the operator runs it, and the container reports on it

**Asked to decide between wiring it into the entrypoint or documenting where an
operator runs it, the answer is: the operator runs it — and the entrypoint
*reports* whether it worked.**

The entrypoint cannot run it, and the reason is not preference. The entrypoint
runs **as** the application role, which by D-116 is `NOSUPERUSER NOCREATEROLE`
and therefore cannot `GRANT`. If it could, the separation would be decorative: a
compromised application could grant itself back. A migration is worse still —
migrations also run as the application role, so the `REVOKE` would strip the
role's own writes mid-upgrade and strand the next migration that has to touch
`AuditEvent`, unattended, at container start.

What the entrypoint does instead is run `splashtrack audit:grants` at every
start. It reads `information_schema.table_privileges` through the application's
own connection — reading privileges needs no privilege — and says in words
whether the application role still holds `UPDATE` or `DELETE` on `AuditEvent`. A
grant nobody checks is a grant nobody has, and "we ran that script once" is not
evidence. The same line belongs on the diagnostics page (`13-…` §8) when it
exists.

**It never refuses a start.** This is a deployment step the operator owns, and an
instance that will not boot because a SQL file has not been run is a worse
failure than the one it prevents. It also distinguishes three situations that
would otherwise all read the same:

- the audit tables do not exist yet (an unmigrated installation) — reported as
  such, because an empty privilege list would otherwise read as "the separation
  is in force";
- the separate roles do not exist — "apply the SQL";
- the separate roles exist but the application half is still commented out —
  reported as the known remaining piece, not as a forgotten step. Telling an
  operator to run a script they have already run is how a real warning gets
  ignored.

The SQL was executed against the live UAT database as a privileged role during
this work: it parses, runs clean, and creates exactly the grants it claims.

```
  AuditEvent       splashtrack_audit_writer     INSERT
  AuditEvent       splashtrack_audit_writer     SELECT
  AuditEvent       splashtrack_audit_retention  DELETE
  AuditEvent       splashtrack_audit_retention  SELECT
  AuditCheckpoint  splashtrack_audit_retention  INSERT
  AuditCheckpoint  splashtrack_audit_retention  SELECT
  AuditCheckpoint  splashtrack_audit_writer     SELECT

D-149 part 2 is NOT in force: the application role still holds DELETE and UPDATE
on AuditEvent. Append-only currently rests on the audit repository being the only
writer and exposing no mutation — a code property, not a database one.
  The separate audit roles DO exist, so the deployment step has run. What remains
  is the application half: revoking the app role's writes needs the second and
  third connections, which means two new environment variables and therefore an
  ADR (D-037). That section of infra/audit-database-role.sql is commented out
  until then, deliberately — applying it today would break the retention path
  with no connection to run it on.
```

**That last part is Jack's decision, not mine**, and it is the same one 0.4a
already flagged: two extra connection strings are a change to the operator-facing
environment surface. See §8.

---

## 7. What I had to decide that the design did not settle

### 7.1 D-044's pre-migration backup, against a backup engine that does not exist

D-044 requires an automatic pre-migration backup whenever a start would apply
migrations. It cannot be implemented today: D-095/D-169 make a SplashTrack backup
a structured export the application writes and reads itself, `pg_dump` is
explicitly *out of v1 scope and not a fallback*, `postgresql-client` is therefore
not in the image, and the export/import engine is Phase-1 work that has not
landed.

Three options, none of them free:

- migrate anyway with a warning — the exact shape this design rejects everywhere
  else: doing the dangerous thing loudly;
- refuse every migrating start until the engine lands — safe, and it makes every
  upgrade impossible, including the UAT instance this phase exists to produce;
- require an explicit, one-shot acknowledgement from the host.

**I took the third.** A migrating start requires `/app/data/allow-unbacked-migration`
to exist; the entrypoint consumes it, so the next migrating start asks again. The
message names D-044, says why the snapshot cannot be taken, and tells the operator
to take their own backup first. It uses no new environment variable — it is the
same host-access-is-authority pattern as D-101's setup token — and it does not
affect an ordinary restart of a `CURRENT` database. **The whole gate is deleted
when the export engine lands.**

This is the decision in this phase I am least certain about, because it adds
friction to every upgrade of the UAT instance. It is flagged for Jack.

### 7.2 D-098's predicate 3 makes its own recovery unreachable

**This is a correction to a decision, not a gap in one, and it was found by
running it rather than by reading it.**

D-098 writes predicate 3 as *"any row with `finished_at IS NULL` **or**
`rolled_back_at IS NOT NULL`"* → `FAILED`, and `FAILED`'s message tells the
operator to resolve it with `prisma migrate resolve`. Measured against Prisma
7.10 on the live instance: `migrate resolve --rolled-back <name>` leaves the row
with `finished_at` **still NULL** and `rolled_back_at` **set**.

```
                 migration_name                 | unfinished | rolled_back
------------------------------------------------+------------+-------------
 20260903132751_retention_policy_per_data_class | t          | t
```

So under the literal predicate the container reports `FAILED` forever to an
operator who did exactly what they were told. It crash-looped on this host until
the predicate was changed.

The two flags mean different things and are now read separately:

- **unfinished and not rolled back** → stuck mid-flight. Prisma keeps it recorded
  and it blocks every later migration (P3009), so a restart fails identically.
  Refuse, and name the recovery. *This is what D-098 was for.*
- **rolled back** → the operator has already acted. Prisma treats the row as not
  applied and `migrate deploy` re-applies it, so it is an ordinary pending
  migration: `EXISTING`.

The same correction applies to what counts as *applied*. A rolled-back row **is**
recorded, so deriving the applied set from recorded names would report `CURRENT`
on a schema missing that migration's tables. Predicate 5 now reads
`finished_at IS NOT NULL AND rolled_back_at IS NULL`. `AHEAD` deliberately still
reads every recorded name: a rolled-back unknown migration still means a newer
image reached this database, and refusing is recoverable in seconds where
guessing is not.

Three cases in the matrix cover it, replacing the one that asserted the literal
reading. **D-098's row in the decision register should be amended to match;** I
have not edited the register, because it is the design set and this is a build
task.

### 7.3 D-098 predicate 4 presumes a table that a pre-upgrade schema does not have

Predicate 4 asks about a *row* in `InstallationBootstrap`. On a schema older than
the migration that creates that table the predicate is not false, it is
unanswerable — and answering it "false" classifies every pre-upgrade installation
as `PARTIAL` or `TAMPERED` and refuses the migration predicate 5 exists for.

**Implemented reading:** when the table is absent *and* this image ships migrations
the database has not applied, the state is `EXISTING` — the missing table is one of
the things those migrations create, so the record cannot exist yet and nothing is
being skipped. The absent table with nothing pending falls through to the counts,
where data present is still `TAMPERED`. Covered by a case in the matrix.

### 7.4 The setup wizard does not exist, so the operator answers its question on the host

D-055's `EMPTY` branch puts the question *"new installation, or restore from
backup?"* in a browser wizard (D-039), which is phase 1 and is not built. The
honest reduction is to ask it where every other privileged question in this
chapter is already asked: on the host. `splashtrack admin:create` **is** the "new
installation" branch — migrations, seed, first administrator with forced MFA, then
the bootstrap record that closes setup mode.

This is not merely a substitute; for now it is strictly stronger. There is **no
unauthenticated administrative surface on the instance at all**, not even D-039's
bounded one, and therefore no race between container start and the operator
reaching `/setup`. When the wizard lands it takes over, and `isSetupIncomplete()`
is the gate it needs.

`setup:init` exists as a separate command for an operator who wants to look at a
migrated database before creating an account; `admin:create` does its work itself
if it has not been run, so the two-step is a convenience and not a sequence
anybody can get wrong.

### 7.5 Two starter roles, not ten

Stated in §4.7. No document assigns permission sets to the other eight, and this
is not the place to invent them.

### 7.6 `BreakGlassAlert` is a table, and carries no person column

Stated in §4.2. The alert needs mutable acknowledgement state, which `AuditEvent`
by construction cannot hold; the accountability stays on the trail.

### 7.7 A minimal sign-in surface was in scope

The deployment surface's stated purpose is that a real person can log in. An
instance nobody can reach through a browser has not proved that, and the banner
D-141 requires needs somewhere to be seen and dismissed. So: a setup notice, a
two-step sign-in with no client JavaScript, and the banner. Deliberately small —
no password reset, no passkey sign-in, no profile. Those arrive with the first
module, and Better Auth already exposes them.

---

## 8. What CI needs, since `.github/workflows/` is outside write scope (D-025)

Nothing here is blocking; all of it is worth adding when someone with write
access to the workflows is doing so.

1. **Build the image on every pull request.** Three of the five failures found
   during this work (`prisma generate` needing `DATABASE_URL`; the
   `@prisma/engines` postinstall; the bare `next/*` ESM specifiers) were invisible
   to `tsc`, `eslint` and `vitest` and appeared only when the image ran. A build
   step catches all three.
2. **Run `npm run build:cli` in the same job**, and smoke-test the bundle:
   `node dist/cli.mjs --help` and `node dist/cli.mjs secret:init --out <tmp>`
   with no `DATABASE_URL` set. That last one is the regression test for "the
   dispatcher's dynamic imports stayed dynamic".
3. **A compose smoke test**: bring the stack up against an empty database, assert
   `boot:state` prints `EMPTY SETUP_MODE`, assert `/api/ready` returns 200, assert
   the database still holds zero tables. That is the D-055 promise as a CI gate.
4. **`docker scout` / `trivy` on the built image**, and an SBOM
   (`docker buildx --sbom=true`) — `03-…` §3 lists a published SBOM and provenance
   attestation under supply chain.
5. **Pin the base image digest check**: fail the build if `Dockerfile`'s
   `NODE_IMAGE` digest is more than N days old, so pinning does not silently
   become "never patched".

---

## 9. What this phase put in front of Jack

**Read the status from `docs/design/09-decision-register.md`, not from here.**
This section originally carried four items under the heading "Open, and Jack's
to decide", and all four were answered the same evening it was written. A status
automation read the heading rather than the register and reported them to Jack
as still open — which is the failure mode of writing a *state* into a document
that is only ever amended, never re-read. A build report records **what a phase
asked**; the register records **what was decided**. Only one of those two facts
is allowed to age.

So this section now names the questions and points at where each was answered.
If a pointer below and the register disagree, the register wins.

| What this phase put in front of Jack | Where it was answered |
|---|---|
| **The extra database connections for D-149 part 3.** Revoking the application role's `UPDATE`/`DELETE` on `AuditEvent` needs a connection that still holds `DELETE` for retention — new environment variables, and D-037 requires an ADR for each. Whether to grow the operator-facing surface is a decision about the product, not about the code | **D-182**, and `docs/adr/0002-database-roles-and-least-privilege.md`. Four roles, **two** credentials rather than three: D-149's separate append-only *writer* connection was dropped, because the runtime role **is** the append-only writer once it owns nothing. Built in phase 1.2 — `docs/build/phase-1.2-database-roles-report.md` |
| **The D-044 acknowledgement gate** (§7.1) — is one `touch` per upgrade the right friction, or should an unbacked migration proceed with a loud warning? | **D-181.** Upgrades apply migrations unattended, with the pre-migration backup and the `FAILED` boot state as the controls. The marker gate is interim, and only until the export engine lands |
| **D-116 is not implemented** — the reference compose's `POSTGRES_USER` is a superuser, so the application's role is one. §9.3 also claimed a least-privilege role *"would break the test harness's ability to create its `_test` databases"* | **D-182** and ADR-0002 §6. **That claim was wrong and is retracted here**: it conflates `CREATEDB` with `SUPERUSER`, which are different role attributes. The harness needs the first and has never needed the second. Measured both directions in ADR-0002 §6; implemented in phase 1.2 |
| **`LOG_LEVEL` is read by `src/lib/logging` and is not one of the three** application-owned variables | **ADR-0001**, `docs/adr/0001-log-level-is-an-environment-variable.md`. It stays an environment variable, and the ADR is the D-037 gate that permits it |

The distribution question standing behind the first and third rows — how much
Postgres a self-hoster can be asked to do — is **OD-15**: comfortable with
`docker compose` on a host they control, and not thereby comfortable with role
grants. That is why phase 1.2 provisions the roles from the compose stack rather
than from a page of `psql` in a README.
