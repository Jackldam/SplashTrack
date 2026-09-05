# Phase 1.5 — the first-run setup wizard

Branch `build/v1-foundation`. Decision **D-187**.

What landed: `/setup`, the browser wizard `13-configuration-and-setup.md` §6.3
has specified since the design phase (D-039), gated by D-101's one-time token,
finishing with MFA enrolment in the same flow. `splashtrack admin:create` is
demoted to break-glass and `--password-file` is removed from it.

---

## 1. One correction to the brief, made before any code was written

The task said the token would be *"printed to the container log"*. **The design
says the opposite, and this build follows the design.**

> **D-101** — The setup token is written to `$DATA_DIR/setup-token`, mode 0600,
> and only its *path* is printed. It is single-use, expires in ≤60 minutes, and
> is reissued only from the host.

The reasoning is Finding **F-99**, and it is not stylistic. F-20 states as a
design assumption that self-hosters debugging a problem paste logs, screenshots
and database rows; this repository is public. An operator whose setup fails
opens an issue, pastes `docker compose logs app`, and publishes a credential
that makes a stranger the administrator of an instance a school is about to fill
with children's records. The same exposure happens through Portainer, Synology
and Unraid log panes, and through centralised log shipping.

The property the brief actually asked for is unchanged: **host access is the
proof of ownership.** Whoever can read the data volume owns the machine; whoever
cannot, cannot begin. The only difference is that reading the token is a
deliberate act on a named file that says on its own first line that it is a
credential, rather than something that arrives in a scrollback buffer the
operator will paste wholesale.

Proved on the running instance in §6.

---

## 2. What the wizard is

Three steps at `/setup`, Dutch UI, English identifiers (D-159):

| Step | What it asks | What it does |
|---|---|---|
| 1 | the one-time setup token | exchanges it for a signed, `/setup`-scoped cookie |
| 2 | organisation name; administrator name, email, password **twice** | migrates, seeds, names the organisation, creates the administrator, signs them in |
| 3 | six digits from an authenticator, beside a QR code | verifies the factor, writes the bootstrap record, closes `/setup` forever |

**Setup completes when the administrator holds a verified second factor and not
before** (D-185). Step 3 is not a formality at the end of the wizard; it is the
step that writes `InstallationBootstrap.completedAt`. D-186's `PENDING_ENROLMENT`
is the state between step 2 and step 3, reused rather than duplicated.

### What is deliberately not there

§6.3 lists three more steps. Each is absent because the thing behind it does not
exist, not because it was forgotten, and `src/app/setup/page.tsx` says so at the
point somebody would look for it:

- **step 0, "new installation or restore from backup?"** — there is no restore.
  D-095/D-169 make a SplashTrack backup a structured export the application
  writes and reads itself, `pg_dump` is out of v1 scope, and the export engine is
  unbuilt. `docker-entrypoint.sh` already refuses to migrate without a backup for
  the same reason. A question with one answer is not a question, and a dead
  "restore" branch is worse than an omitted one.
- **step 4, the recovery token** — a passphrase over the archive's key record
  (D-114/D-166). Same missing engine.
- **step 5, email settings with a test send** — there is no mail transport.

---

## 3. How D-099 is enforced

> *The unauthenticated setup surface must never open on a populated database.*

**Two independent gates, and neither is the other's backstop.**

**The front is the token.** Reaching `/setup` in a state that serves it yields a
box asking for a credential that only host access produces. 160 bits in Crockford
base32 (whose alphabet omits `I`, `L`, `O`, `U`, because the operator retypes it
on another machine), 0600 inside a 0700 directory, sixty minutes, single-use —
enforced with `rename(2)`, so two concurrent submissions of one valid token
cannot both win a `read`-then-`mark-used` race whose far side is an
`ORGANIZATION`-scoped administrator.

**The back is the boot state.** `decideWizardAccess` in `src/lib/setup/gate.ts`
is a pure function, total over `BootState`:

| Boot state | anonymous | + wizard cookie | + signed-in pending session |
|---|---|---|---|
| `EMPTY`, `PARTIAL` | token box | administrator form | token box |
| `PENDING_ENROLMENT` | sign in | sign in | enrolment |
| `CURRENT`, `TAMPERED`, `EXISTING`, `AHEAD`, `FAILED` | **404** | **404** | **404** |

`CLOSED` is `notFound()` and not a redirect: a redirect says the route is there
and merely not for this caller, while a 404 is the honest description of a
surface that self-destructed.

**`PENDING_ENROLMENT` serves, and D-099 is not weakened by it.** In that state
the database holds data — one person, one account, two grants — and the wizard
requires a **signed-in pending session**, never the token, which is spent by
then. So the surface is unauthenticated only in `EMPTY` and `PARTIAL`, which
D-099 as corrected by D-186 proves hold nothing beyond what setup itself created.
There is no state in which an anonymous caller reaches an administrative step on
a database holding rows.

**Every Server Action re-derives its own authority.** A Server Action is an HTTP
endpoint reachable without the page that renders it, so `page.tsx` deciding a
caller may see a form is a convenience for the browser and never the control.

### The token cannot live in the database, and that is why `DATA_DIR` exists

The state the wizard opens in is `EMPTY`: no tables at all. A row cannot be
written to a schema that does not exist, and D-055 forbids creating one before
the operator has answered what the database is for — which is the question the
wizard asks. So the token's whole lifecycle is on the filesystem, and `DATA_DIR`
becomes a real Layer 1 variable rather than a listed one. `13-…` §3.1 already
sanctions it (*"uploads/assets path (optional, sane default)"*) and it qualifies
under D-037 for the reason that rule exists: it selects where state lives.

The same constraint makes the token-submission limiter **in-memory and
per-process** rather than the database-backed `@/lib/rate-limit`. That is stated
in `src/lib/setup/attempts.ts` with its consequences — it does not survive a
restart, and someone with `docker compose restart` already holds total authority
over the installation. It is not load-bearing: 160 bits of entropy is. Failed
attempts go to the structured log always, and to the audit trail from the moment
the schema exists (`recordAuditEventSafe`, which never throws — see §6 for the
measured behaviour on an `EMPTY` database).

---

## 4. Password handling

Never to disk, never to a log, never on a command line, never in shell history.

- The wizard reads the password from a POST body, hands it to Better Auth, and
  drops it. It is **entered twice**, compared **server-side**; the client-side
  hint is a convenience.
- `--password-file` is **removed from `admin:create`**. Passing it now exits 2,
  names the replacement, and writes nothing —
  `tests/integration/setup-init-from-empty.test.ts` asserts both the exit code
  and that the database is untouched afterwards.
- No command takes a password as a flag value; a flag value is in shell history
  and in `ps` for every user on the host.
- The TOTP secret is rendered into one POST response and nowhere else (D-185).
  Asserted against the real container log in §6.

### Why `admin:reset-mfa` keeps `--password-file` — argued, not assumed

The brief asked for this to be argued rather than presumed. It keeps the flag,
and the reason is D-141 rather than convenience.

`admin:reset-mfa` deletes a verified factor and re-enrols **inside the same
command**, precisely so D-141's invariant — *at least one local
`ORGANIZATION`-scoped account with a verified MFA factor at all times* — is never
false across a browser round-trip. That is exactly the shape of installation it
exists for: a single administrator whose authenticator is gone. It therefore
**cannot** hand the operator off to a browser the way `admin:create` now does,
and it also blocks on a prompt for a six-digit code — so a file is the only
remaining non-interactive way to feed it.

Two further differences from the pattern the owner rejected: the password it
reads is the account's **existing** one, which already lives in that operator's
password manager rather than being invented and written down for the occasion;
and the command is run by somebody who already knows they are recovering. If
that argument is not persuasive, the flag can go — the cost is that the recovery
command becomes interactive-only, which is a real cost on a machine reached over
`ssh` with a mangled TTY, which is how this whole phase started.

---

## 5. What else changed

**`./secrets` is no longer mounted into the `app` service.** The mount existed
"so `secret:init` can write here", and that was never true — the `secret-init`
service has its own mount, and it has to, because it is the service that
*creates* the directory. It cost two things:

- **It was broken.** Docker creates a missing bind source as root, so `./secrets`
  arrives root-owned at 0700; the container runs as uid 10001, which cannot
  traverse it. Anything under `/app/secrets` was unreadable to the application —
  which is why `--password-file` pointing there could never have worked through
  compose in the first place.
- **It widened the surface D-112 narrows.** The bootstrap secret reaches the
  container as a Docker secret at one read-only path,
  `/run/secrets/splashtrack_secret_key`. Bind-mounting the directory it came from
  hands a compromised web process the key *and* whatever the operator keeps
  beside it, by a second route nothing needed.

Removing the mount is the repository-level fix; a mode corrected on one host is
not one. Proved in §6: the walkthrough below ran with `./secrets` set back to
root-owned `0700` — the exact state that broke it — and the container started.

**`@/lib/boot/migrate.ts`** — migrating and re-applying the ADR-0002 role model
is one sequence that must never come apart, and it now has two callers (the CLI
and the wizard). One implementation, `execFile` rather than `execFileSync`
because a Server Action must not hold the event loop for the length of a
migration.

**The Prisma CLI path is walked at runtime** rather than `require.resolve`d.
Measured, not predicted: the literal specifier makes Next's bundler trace into
`@prisma/dev`'s `.tar.gz` runtime assets and fail the build outright, with an
import trace ending at the wizard's Server Action.

**`Organization.name` finally has the validation layer its own schema comment
promised** — bounded at 120 characters, control characters and bidi overrides
refused, because the name is injected over `common.brand` into every heading.

**`CLAUDE.md`'s "do not build setup wizards" is corrected.** That file says the
design set wins where the two disagree. The wizard is not third-party
deployability: the author locked himself out of his own instance, and `/setup` is
what the single v1 operator needs on his own machine.

---

## 6. Definition of done — run, not claimed

```
prisma validate      The schema at prisma/schema.prisma is valid 🚀
tsc --noEmit         (no output)
npm run lint         (no output)
npm run format:check All matched files use Prettier code style!
npm run build        ✓ compiled — /setup present in the route table
npm test             Test Files 42 passed (42) · Tests 505 passed (505)
npm run db:recreate  All migrations have been successfully applied.
                     Role model in force on "splashtrack_freshcheck"
```

505 tests, from 441 at `c1e4007`.

### The negatives, broken deliberately

`tests/unit/setup-wizard-gate.test.ts` enumerates every member of `BootState`
and asserts the table is **complete** against `ACTION_BY_STATE`, so a state added
later fails there rather than inheriting whatever the `switch` happens to do.
`tests/integration/setup-wizard.test.ts` builds real databases with the real
commands and feeds the real `detectBootState` into the real gate; its `TAMPERED`
case is the previous case's database **with one row deleted**, and it asserts the
wizard served a moment earlier so the refusal is the deletion and not the
fixture.

Routing `TAMPERED` into the serving branch, to check the tests are not vacuous:

```
× is CLOSED on a populated database whose bootstrap record was removed  (integration)
× in TAMPERED: an anonymous caller gets CLOSED
× in TAMPERED: a wizard cookie gets CLOSED
× in TAMPERED: a signed-in pending account gets CLOSED
× a valid wizard cookie does not reopen a completed installation
Test Files 2 failed (2) · Tests 5 failed | 27 passed (32)
```

Restored: 32 passed.

`tests/unit/setup-wizard-session.test.ts` does the same for the cookie: the same
payload is presented twice, once with a signature this instance made and once
with one it did not, so the refusal is the MAC failing rather than the payload
being rejected for some other reason.

---

## 7. The walkthrough, on the UAT stack, over HTTPS

Real instance: `https://uat.splashtrack.sysadminheaven.nl`, database
`splashtrack_uat` dropped and recreated, image rebuilt, data volume removed.

**`./secrets` was first set back to the state that broke the old mount**, so this
run also proves the repository fix rather than a host-local one:

```
# chown root:root secrets && chmod 0700 secrets
drwx------ 2 root  root  4096 secrets
-rw------- 1 10001 10001   44 secrets/secret_key

# docker compose --env-file .env.uat up -d
 Container splashtrack-app-1 Started
```

### What the log says

```
SplashTrack: detecting database state before doing anything to it…
SplashTrack 0.1.0 — boot state EMPTY
  The database holds no tables. This is either a fresh installation or the first
  minute of a restore, and only the operator knows which — so nothing is
  migrated. Setup mode.

SETUP MODE (EMPTY). No migrations have been run.

A one-time setup token has been written to /app/data/setup-token
It is valid for 60 minutes, until 2026-09-05T08:14:50.845Z,
and it can be used exactly once.

Read it:

    docker compose exec app cat /app/data/setup-token

THAT FILE IS A CREDENTIAL. Whoever holds this token becomes the administrator of
this installation. It is not printed here and it is never written to the
container log, because logs get pasted into public issues (D-101, F-99). Do not
paste it either.

  SET THIS INSTALLATION UP IN YOUR BROWSER:

      https://uat.splashtrack.sysadminheaven.nl/setup
  …
  NO RESTART IS NEEDED at any point: the application re-reads how far setup has
  got on every request.
```

```
token length: 32
--- does the container log contain the token? (D-101/F-99) ---
PASS: the token is NOT in the container log
--- file mode inside the container ---
drwx------ 2 splashtrack splashtrack 4096 /app/data
-rw------- 1 splashtrack splashtrack  357 /app/data/setup-token
```

### The browser, over HTTPS

`scripts/uat-walkthrough.mjs` drives a real Chromium against the public origin.
It computes the TOTP code from the manual key the page shows — which is the only
place that secret exists — exactly as a phone does from the QR code beside it.

```
─── 1. GET https://uat.splashtrack.sysadminheaven.nl/ — an unset-up instance sends you to the wizard

landed on: https://uat.splashtrack.sysadminheaven.nl/setup
h1:        SplashTrack instellen
h2:        Stap 1 — de eenmalige setup-token
steps:     1. Token  |  2. Beheerder  |  3. Authenticator
command:   docker compose exec app cat /app/data/setup-token

─── 2. a WRONG token is refused, and does not burn the real one

refusal:   Die token klopt niet. Controleer of je het hele bestand hebt overgenomen.
still on:  https://uat.splashtrack.sysadminheaven.nl/setup

─── 3. the real token

now at:    https://uat.splashtrack.sysadminheaven.nl/setup
h2:        Stap 2 — de organisatie en de eerste beheerder
fields:    Naam van de organisatie, Naam van de beheerder, E-mailadres, Wachtwoord, Wachtwoord nogmaals

─── 4. a MISMATCHED confirmation is refused server-side

refusal:   De twee wachtwoorden zijn niet gelijk.

─── 5. the organisation and the first administrator

now at:    https://uat.splashtrack.sysadminheaven.nl/setup
steps:     1. Token  |  2. Beheerder  |  3. Authenticator

─── 6. MFA enrolment — the QR code, in the same flow

QR svg:    14164 chars of path data
alt text:  QR-code voor je authenticator-app
key shown: 64 chars, grouped in fours
backup:    10 codes offered
computed a code from the key the page showed

─── 7. landed on a working page

now at:    https://uat.splashtrack.sysadminheaven.nl/
h1:        SplashTrack
body:      Leerlingvolgsysteem voor zwemscholen. | De basis staat… | Ingelogd als jack@sysadminheaven.nl.
links:     Naar Mensen

─── 8. the people register renders for the new administrator

now at:    https://uat.splashtrack.sysadminheaven.nl/people
h1:        Mensen

─── 9. /setup is now a 404 — the wizard self-destructed (D-039)

GET /setup -> HTTP 404
```

### What the installation holds afterwards

```
 name         | Zwemschool Sysadmin Heaven
 email        | jack@sysadminheaven.nl        status | ACTIVE
 verified     | t                             ← the TwoFactor row
 completed    | t   completedVia | browser    appVersion | 0.1.0

CURRENT SERVE
  The schema matches this image (12 migration(s) applied). Serving.

 sequence |              eventType               | outcome | actorAuthMethod |         reason
----------+--------------------------------------+---------+-----------------+------------------------
        1 | security.setup.administrator_created | SUCCESS | setup:wizard    | first_run_setup_wizard
        2 | security.password_login              | SUCCESS | session         |
        3 | security.two_factor_login            | SUCCESS | session         |

Audit chain intact across 0 pruned segment(s); 3 event(s) verified.
```

The wizard writes an **ordinary** audit event, not a `security.break_glass.*`
one, and raises no banner. `admin:create` does both, because host access
bypassing the application is something every administrator should be told about;
the wizard is the normal path, and a banner on every future login saying
"somebody set this instance up" would train people to dismiss the one that
matters.

### The TOTP secret and the password, against the real container logs

```
=== D-185: the TOTP secret appears in the browser page and NOWHERE else ===
container log:      PASS — absent
otpauth:// URI:     PASS — absent
data volume:        PASS — /app/data holds nothing matching it
/app/data contents: (empty — the setup token was removed when setup completed)
the password:       PASS — absent from the log
```

### The negative, on the live instance

One row deleted from a populated production-shaped database — F-98's exact
primitive:

```
# DELETE FROM "InstallationBootstrap";
DELETE 1
 people   | 1
 accounts | 1

GET /setup -> HTTP 404          ← the running container, over HTTPS

# docker compose restart app
SplashTrack 0.1.0 — boot state TAMPERED
  There is no completed InstallationBootstrap record, but the installation holds
  data (1 person row(s), 1 account(s), 2 role assignment(s)), and this is NOT an
  unfinished first-run setup: there is no InstallationBootstrap row at all, so
  nothing recorded that setup ever started here. Setup mode is an
  UNAUTHENTICATED administrative surface and must never open on a populated
  database (D-099), so this refuses to serve. Clear it deliberately from the
  host with `splashtrack bootstrap:clear-tampered` once you know why the record
  is missing.

SplashTrack refuses to start in state TAMPERED. The reason is above.
```

### A used token, and an expired one

Both over HTTPS, each in a fresh browser context with no cookie:

```
first use  : ACCEPTED
second use : REFUSED: Die token is al gebruikt. Een token werkt precies één keer.
             Maak een nieuwe aan: docker compose exec app splashtrack setup:token --new
```

```
# expiresAt edited into the past on the data volume
Setup token file: /app/data/setup-token
  state      EXPIRED at 2020-01-01T00:00:00.000Z

expired token: Die token is verlopen. Maak een nieuwe aan op de host:
               docker compose exec app splashtrack setup:token --new
```

### One honest gap, measured rather than reasoned about

A refused token submission on an `EMPTY` database cannot write an audit event,
because `AuditEvent` does not exist yet. `recordAuditEventSafe` swallows the
failure by design, and the structured log is the record that always exists:

```
{"level":40,"component":"setup.token","event":"setup.token.rejected",
 "refusal":"MISMATCH","clientIpHash":"776ceeaa…","lockedOut":false,
 "msg":"a setup-token submission was refused"}
```

Three `audit.record_failed` lines accompanied the three refusals in this run.
The IP is hashed for the same reason `@/lib/rate-limit` hashes its bucket ids: a
security log must not become a plaintext record of who tried what from where.

---

## 8. What the owner does now

The UAT instance is reset and waiting: **migrated, seeded, no administrator, a
fresh token.** Boot state `PARTIAL SETUP_MODE`.

```sh
# 1. read the one-time token — the path is also in `docker compose logs app`
cd /root/projects/SplashTrack
docker compose --env-file .env.uat exec app cat /app/data/setup-token
```

It prints a small JSON document whose first key is a warning that the file is a
credential. Copy the 32-character `token` value.

```sh
# if it has expired (they last an hour), issue another:
docker compose --env-file .env.uat exec app splashtrack setup:token --new
```

Then, in a browser:

**2.** Open `https://uat.splashtrack.sysadminheaven.nl` — it redirects to
`/setup`. The heading is *SplashTrack instellen*, with three steps listed:
Token, Beheerder, Authenticator.

**3.** *Stap 1 — de eenmalige setup-token.* Paste the token. Dashes, spaces and
letter case do not matter. Press **Verder**.

**4.** *Stap 2 — de organisatie en de eerste beheerder.* Five fields: the
organisation's name, your name, your email, and the password **twice**. Minimum
twelve characters; there is no email password reset, so use the password
manager. Press **Beheerder aanmaken** — this migrates the database, so it takes
a few seconds.

**5.** *Stap 3.* Enter that same password once more (Better Auth requires it to
mint a factor), press the button, and a QR code appears with the key underneath
it in groups of four, and ten backup codes behind a disclosure. Scan it, type
the six digits, press **Bevestigen**.

**6.** You land on the SplashTrack landing page, signed in, with **Naar Mensen**
working. `/setup` is now a 404 and the token file is gone from the data volume.

No restart is needed at any point.

If something goes wrong between steps 4 and 5 — a forgotten password before the
authenticator is enrolled — the host path is still there and is audited:

```sh
docker compose --env-file .env.uat exec app splashtrack admin:create \
    --email you@example.org
```

It asks for the password twice without echoing it and stops; enrolment still
happens in the browser. There is no `--password-file`.

---

## 9. The question this stopped on

**Should `admin:create` be allowed to run on an installation that has already
completed setup?**

The brief said `admin:create` becomes *"break-glass, not the front door: for an
instance whose wizard has already closed"*. That last clause reads two ways, and
one of them is a capability change rather than a documentation change:

- **What was built** — its *purpose* is demoted. Every message, the usage text
  and the README now say the wizard is the front door and this is recovery. Its
  *reach* is untouched: it still refuses on a completed installation, pointing at
  `admin:grant-admin` and `admin:reset-mfa`, for the reason already in the code —
  a second, unaudited path to an `ORGANIZATION`-scoped account is what D-141's
  invariant exists to make unnecessary. It remains available in `EMPTY`,
  `PARTIAL` and `PENDING_ENROLMENT`, which is exactly "the wizard could not
  finish this install".

- **What the sentence might have meant** — that it should also work *after* the
  wizard closes, i.e. create a brand-new `ORGANIZATION` administrator on a live
  database holding children's records.

The second is a genuine gap: `admin:reset-mfa` needs the account's existing
password, so an operator who has lost the password entirely has **no recovery
path at all** today. It is also a real widening of the most privileged operation
in the product, so it is your call rather than an inference from a clause. If you
want it, the shape I would propose is a distinct command — `admin:recover` —
that is refused unless a `--yes-i-have-lost-the-only-administrator` style
acknowledgement is present, writes a break-glass event and a banner, and issues a
**time-limited** grant like `admin:grant-admin` rather than a standing one.

---

## 10. Files

| | |
|---|---|
| `src/lib/setup/` | `token.ts`, `data-dir.ts`, `wizard-session.ts`, `attempts.ts`, `gate.ts` |
| `src/app/setup/` | `page.tsx`, `actions.ts`, `token-step.tsx`, `administrator-step.tsx`, `state.ts` |
| `src/lib/boot/migrate.ts` | migrate + role model, one implementation, two callers |
| `src/cli/commands/setup.ts` | `setup:token --new/--ensure/--status` |
| `tests/unit/` | `setup-token`, `setup-wizard-gate`, `setup-wizard-session` |
| `tests/integration/` | `setup-wizard.test.ts` |
| `tests/support/cli-runner.ts` | the shared child-process CLI harness |
| `scripts/uat-walkthrough.mjs` | the §7 transcript, re-runnable in one command |

Commits: `0f0e468` · `a9288d3` · `2389c16` · `a8689eb` · `9cbd039` · `a5d68b3`.
Not pushed.
