# Phase 1.4 — The first-run path, walked

**Branch** `build/v1-foundation` · **From** `a1ed344` · **Decision** D-186
**Suite** 434 → 441 tests, green before and after every commit.

---

## 1. The defect

Jack created the first administrator with `admin:create` and could not sign in.
Restarting the container made it worse: it refused to serve at all.

```
SplashTrack 0.1.0 — boot state TAMPERED
  There is no completed InstallationBootstrap record, but the installation
  holds data (1 person row(s), 1 account(s), 2 role assignment(s)). Setup mode
  is an UNAUTHENTICATED administrative surface and must never open on a
  populated database (D-099), so this refuses to serve.
```

**The rule is right. The predicate was wrong.** "One person, one account, two
role assignments, no completed bootstrap record" is *exactly* what
`admin:create` leaves behind — it is the window D-185 designed on purpose the
previous day, between creating the account and enrolling its second factor in a
browser. D-099's predicate was written before that window existed, when "no
record, and data present" had only one reading: somebody deleted the row to
reopen the unauthenticated setup surface.

So the application refused to serve the one page (`/sign-in` →
`/mfa-enrolment`) that could have finished the install, immediately after the
command whose entire purpose is to reach it. The owner was locked out of his own
instance by a control working exactly as written.

Cleared by hand with `bootstrap:clear-tampered` (audit `iv9469kuz9x7vz6c0382oxzr`,
non-destructive). That was a plaster on one instance. This phase fixes the
product.

### 1.1 What was *not* wrong, stated honestly

The brief also reported that the running container "held a stale boot state" and
"kept serving the setup notice against a database that was by then migrated and
seeded". Reproducing it on UAT before changing anything, the **served page did
re-evaluate**: after `setup:init` it correctly still asked for an administrator,
and after `admin:create` it correctly changed to *"Bijna klaar: de beheerder moet
nog een authenticator instellen"* with a link to `/sign-in`. `isSetupIncomplete`
latches only the *completed* answer; the unfinished one is re-read every request,
and every route in this application is dynamic (`next build` reports all ten as
`ƒ`).

What genuinely went stale was the **container's boot decision** and the start-up
log describing it. The entrypoint decides once, prints instructions, and never
speaks again — while `docker compose exec` beside a running container, which is
what the documentation tells an operator to do, is guaranteed to change the
database underneath it. The operator's natural response to a log that no longer
matches reality is to restart and find out, and finding out meant an instance
that refused to start. Section 3 addresses that directly.

### 1.2 Two more defects, found by walking rather than reading

Neither was in the brief. Both were found by doing the steps in order on a
genuinely empty database.

**The bootstrap secret could not be generated.** The compose header, the
entrypoint's own refusal message and the README all named

```
docker compose run --rm app splashtrack secret:init --out /app/secrets/secret_key
```

and that command cannot work. `secrets.splashtrack_secret_key.file` points at
`./secrets/secret_key`, and Docker refuses to create a container whose
bind-mount source does not exist. Measured on a fresh directory:

```
$ docker compose run --rm app splashtrack secret:init --out /app/secrets/secret_key
Container ceg-app-run-… Error response from daemon: invalid mount config for
type "bind": bind source path does not exist: /tmp/ceg/secrets/secret_key
```

The documented way to create the key required the key to already exist. Behind
it sat a second blocker: `./secrets` created by Docker is root-owned, and the
container's runtime user (uid 10001) cannot write into it.

**The README described a different repository.** It documented `apps/web/`,
`npm run dev:web`, a Prisma model with `User`/`Organization`/`Student`, and
`docker compose up --build` as the whole of installation — the prototype layout,
none of which exists on this branch. It ended mid-word (`mpetencies`).

---

## 2. D-186 — telling the two situations apart

`src/lib/boot/state.ts`, predicate 4.

**D-099 is not weakened.** Its reason is untouched and remains the governing
requirement. Setup mode may now open on a database holding data only when
**both** of these hold; either one failing is `TAMPERED`.

### Condition 1 — the installation says setup started

`InstallationBootstrap` used to hold exactly one kind of row: a completed one.
So "setup is under way" and "somebody deleted the record" were the same
observation, and the predicate could only pick one reading.

`setup:init` and `admin:create` now write the row with `completedAt` NULL
**before they create anything else**, so the row's *existence* is the record that
first-run setup started. There is no `startedAt` column: `createdAt` already
answers when, and a second copy of it on the one table the state machine reads on
every start would be a copy free to drift. No migration was needed.

This is what keeps F-98's primitive — one deleted row — firing exactly as
before, on a pending installation as much as on a finished one.

### Condition 2 — the data is only what setup itself creates

Every `Person` has a `UserAccount`, every `RoleAssignment` names one of those
people, and no account holds an MFA factor. That is precisely what
`admin:create` leaves behind, and it is nothing like a running installation:
D-141 requires a verified factor at all times, and the person rows in a real
register are mostly children who will never have an account.

Condition 2 is what stops this being weaker than a single deletable row. An
attacker who can `UPDATE` — a strictly stronger primitive than the `DELETE` F-98
describes — cannot reopen setup mode by clearing `completedAt` on a real
installation: the verified factors and the unaccounted people are still there,
and they are not one statement to remove.

Where a table is missing the answer is the pessimistic one. `Person` present
without `UserAccount` means every person is unaccounted for, not that none is —
a half-built schema is not evidence of a tidy installation. `TwoFactor.verified`
is nullable with a default of `true`, so NULL is counted as enrolled: the
direction that errs is the direction that refuses to serve.

### The new state

`PENDING_ENROLMENT`, action `SETUP_MODE`. Its own state rather than a shade of
`PARTIAL`, because the two have different remedies and the entrypoint prints
one of them — telling an operator to run `admin:create` when they have already
run it is how the evening was spent.

### The repair the predicate cannot make

`verifyEnrolment` flips the factor and *then* writes the record, and those two
cannot be one transaction because the flip belongs to Better Auth. Anything
landing between them leaves an installation enrolled with no record — which on
the next restart reads as `TAMPERED`, correctly, because after a restart it
genuinely is indistinguishable from a deleted record on a live installation.

This is not hypothetical: the UAT walkthrough produced it by verifying a factor
through the same endpoint the Server Action calls and not reaching the line
after it. The administrator had finished enrolling and the instance would not
start.

Inside a request the ambiguity does not exist. `countLocalOrganizationAdmins()`
*is* D-141's invariant, and an installation where it holds is set up whatever
the record says — so `resolveSetupStage` writes the record and answers
`COMPLETE`. A write on a read path, deliberately: it is reachable only while
setup is incomplete (the completed answer is latched and never re-reads), and
the write is idempotent, so it costs one query per request during setup and
nothing at all afterwards.

---

## 3. No operator is left with a stale server

Two halves, because the problem had two.

**The application already re-evaluates**, and now says so. `setup:init` and
`admin:create` end by re-detecting the boot state and printing it:

```
Boot state is now PENDING_ENROLMENT (SETUP_MODE).
  First-run setup is still running: 1 administrator account(s) exist, none has
  enrolled a second factor, and the installation holds nothing else. …

The running container does NOT need restarting: it re-reads how far setup has
got on every request, so the page it serves is already the one above. Its
START-UP LOG is now out of date — that is expected, and it is not evidence of a
problem. Restarting is safe and lands in the same state.
```

That replaces a guess with a fact for one short-lived connection, and the last
sentence is the one that matters: it stops both a pointless restart and the fear
of one.

**And a restart now tells the truth.** The `SETUP_MODE` branch of
`docker-entrypoint.sh` reads the *state*, not only the action, and prints the
remedy that applies. In `PENDING_ENROLMENT` it no longer repeats the host
command:

```
SETUP MODE (PENDING_ENROLMENT). No migrations have been run.

  The administrator account already exists and has NOT yet enrolled
  a second factor. There is nothing left to run on this host.

  Finish setup in a browser:

      https://uat.splashtrack.sysadminheaven.nl/sign-in
```

The action still decides what happens; the state decides what is said, and
nothing else in the script reads `${STATE}`.

---

## 4. The first-run path, as an operator meets it

This is the whole of a new install. Five steps, no prior knowledge, every one of
them repeatable. It is also section 2 of the rewritten `README.md`.

**1. Configuration.** `cp .env.example .env`, then fill in three passwords and
one public address. Every variable is documented in place and none has a
default. The three database roles are created for you when the PostgreSQL volume
is first initialised.

**2. The bootstrap secret.**

```
docker compose run --rm secret-init
```

Writes `./secrets/secret_key`, refuses to overwrite one, and hands the file and
its directory to uid 10001 — which is the ownership `secrets:` needs to mount
them readably. It is a separate service, under a `setup` profile so it never
starts with `up`, precisely because the `app` service mounts the key it would be
creating. It is the only container that runs as root, and only long enough to
fix that ownership.

**3. Start.**

```
docker compose up -d && docker compose logs -f app
```

On an empty database nothing is migrated. The container reports `EMPTY`, enters
setup mode, serves a notice, and names the next command.

**4. The first administrator.**

```
docker compose exec app splashtrack admin:create \
    --email you@example.org --name 'Your Name'
```

Asks for a password twice without echoing it. Creates the account and stops.
Prints the resulting boot state and that no restart is needed. `setup:init`
exists if you would rather look at the migrated database first; it is optional.

**5. Finish in a browser.** Open `BETTER_AUTH_URL/sign-in`, sign in with that
password, and you land straight on a QR code. Scan it, enter six digits, and the
installation is set up — on the landing page, signed in, with the people
register at `/people`.

Until step 5 completes, the account may do exactly two things: sign in and
enrol. That is enforced server-side, not displayed.

---

## 5. What landed

Six commits, suite green before and after every one.

| Commit    | What                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| `d7195f0` | D-186's predicate, `PENDING_ENROLMENT`, the started record, and the entrypoint's two messages |
| `7961ecf` | `secret-init`, and a README describing this repository                        |
| `f1f79d9` | D-186 in the decision register; D-099 marked as corrected in place            |
| `7903ef5` | The first page load stops printing a stack trace                              |
| `8022fd8` | A verified factor with no record repairs itself on the next request           |
| `1822611` | The register records that repair as part of the same decision                 |

**One deviation from "each step its own commit".** The predicate fix and the
stale-server fix are in `d7195f0` together. They could not be separated without
weakening a test: the end-to-end case asserts both the boot state at each step
*and* the "does NOT need restarting" message, so a commit carrying only the
first would fail its own test. The rest are separate.

`7903ef5` is the one change with no unit test. It is a log-noise degradation on
a path that only exists before the schema is migrated, the same shape as the
untested `getRequestConfigData` fallback beside it, and its evidence is §6.3's
walkthrough rather than an assertion.

---

## 6. Evidence

### 6.1 Definition of done

Run, not claimed. All on `1822611`.

| Check                                | Result                                         |
| ------------------------------------ | ---------------------------------------------- |
| `prisma validate`                    | valid                                          |
| `tsc --noEmit`                       | clean                                          |
| `lint`                               | clean                                          |
| `format:check`                       | all files                                      |
| `build`                              | compiled; all 10 routes `ƒ` (dynamic)          |
| `npm test`                           | 38 files, **441 passed** (was 434)             |
| `db:recreate` + `migrate deploy`     | 12 migrations from empty, role model in force  |

### 6.2 The new tests

`tests/integration/boot-state-matrix.test.ts` — five cases, written as one
argument. `firstRunInProgress(withStartedRecord)` builds the same database
twice, so the halves differ by exactly one row and neither can pass for an
unrelated reason.

| Case                                       | Expected             |
| ------------------------------------------ | -------------------- |
| pending administrator, started record       | `PENDING_ENROLMENT` / `SETUP_MODE` |
| **same installation, record deleted**       | `TAMPERED` / `REFUSE` |
| same installation + a verified factor       | `TAMPERED` / `REFUSE` |
| same installation + a person with no account| `TAMPERED` / `REFUSE` |
| same installation + a grant with no account | `TAMPERED` / `REFUSE` |

The second row is the non-vacuous proof asked for: one deleted row on a
populated database still goes red.

`tests/integration/setup-init-from-empty.test.ts` — the sequence, through the
real CLI in a child process against a throwaway database. `boot:state` exits 0
and names a serving action at **every** point of the path; then the bootstrap
row is deleted on that very installation and `boot:state` exits 1 with
`TAMPERED REFUSE`; then it is restored and the path works again.

`tests/integration/mfa-enrolment.test.ts` — the serving side. The stage moves
`ADMINISTRATOR_PENDING_MFA` → `COMPLETE` in one process with the latch never
reset, which is the "no restart required" claim; and the repair case verifies a
factor, removes the record, and shows one `resolveSetupStage()` call fixing it —
with the negative half, that an unenrolled account is still pending and no
record is written.

### 6.3 UAT, end to end on the real image

`splashtrack_uat` dropped and recreated, image rebuilt, walked over
`https://uat.splashtrack.sysadminheaven.nl`.

```
boot state EMPTY  → setup mode, notice served (HTTP 200)
                    log: 8 structured warnings, 0 unhandled errors
                    (before 7903ef5 this printed a PrismaClientKnownRequestError
                     stack trace from generateMetadata on the first page load)

setup:init        → 12 migrations, role model applied, "First-run setup recorded
                    as started.", 63 permissions, 2 roles, organisation singleton
                    Boot state is now PARTIAL (SETUP_MODE)

admin:create      → account + 2 grants, no factor, no artefact, no prompt
                    Boot state is now PENDING_ENROLMENT (SETUP_MODE)

docker compose restart app      ← THE EXACT ACTION THAT BRICKED IT
                  → boot state PENDING_ENROLMENT
                    SETUP MODE (PENDING_ENROLMENT). …
                    "The administrator account already exists and has NOT yet
                     enrolled a second factor. There is nothing left to run on
                     this host."
                    container: running (healthy)
```

Then the browser half, over the public origin, driving the same Better Auth
endpoints the Server Actions call and checking the pages around each step:

```
before sign-in    /            200  "Bijna klaar: de beheerder moet nog een
                                     authenticator instellen"
                  /sign-in     200  "Inloggen"
                  /people      307 → /sign-in

after password    /sign-in     307 → /mfa-enrolment
                  /people      307 → /mfa-enrolment
                  /mfa-enrolment 200 "Authenticator instellen"

enable + verify-totp (stopping deliberately before the completion write)
                  boot:state   TAMPERED REFUSE
                               "1 account(s) hold an MFA factor, so somebody has
                                already finished enrolling"       ← §2's repair

after one GET /   /            200  "Noodtoegang gebruikt / SplashTrack"
                  /people      200  "Mensen"
                  boot:state   CURRENT SERVE
                  log:         boot.setup_completion_repaired
```

The path completes: signed in, enrolled, on a working page, instance `CURRENT`.
The `TAMPERED` line in the middle is a second non-vacuous proof — a different
evidence path, on the live stack, not a fixture.

### 6.4 The compose fix, measured

From an empty directory with only `docker-compose.yml`, `infra/` and `.env`:

```
$ docker compose run --rm secret-init
Wrote a new bootstrap secret to /app/secrets/secret_key (mode 0600).
…
$ ls -la secrets/
drwx------ 2 10001 10001   60 secrets
-rw------- 1 10001 10001   44 secret_key

$ docker compose create app
Container …-app-1 Created          ← used to fail on the bind-mount source
```

---

## 7. The state UAT is in now

Dropped, recreated, migrated and seeded — and **deliberately left with no
administrator**, so Jack chooses his own password.

| | |
| --- | --- |
| database | `splashtrack_uat`, 12 migrations, role model in force |
| seeded | 63 permissions, 2 roles, organisation singleton |
| accounts / people | **0 / 0** |
| bootstrap record | started, not completed |
| boot state | `PARTIAL SETUP_MODE` |
| container | running (healthy), serving the setup notice over HTTPS |

The next command is his:

```
docker compose --env-file .env.uat exec app splashtrack admin:create \
    --email jack@sysadminheaven.nl --name 'Jack'
```

Then `https://uat.splashtrack.sysadminheaven.nl/sign-in`.

---

## 8. What this does not fix

- **An installation part-way through setup on a pre-D-186 image** has no started
  record, so upgrading into this image reports `TAMPERED` and needs
  `bootstrap:clear-tampered` once. Correct rather than convenient: such an
  installation genuinely is indistinguishable, and the recovery is one
  non-destructive command. A *completed* installation is unaffected.
- **The `SETUP_MODE` branch still does not assert the role model.** The `SERVE`
  and `MIGRATE_THEN_SERVE` branches refuse to start if `db:apply-grants` fails;
  setup mode does not run it at all. `setup:init` and `admin:create` both apply
  it themselves, so the model is in force by the time anything is written — but
  the asymmetry is pre-existing, is now reachable in one more state, and is
  worth closing deliberately rather than as a side effect of this change.
- **The enrolment half of the path has no single automated end-to-end test.**
  The CLI half runs the real commands against a throwaway database; the browser
  half runs the real modules against the suite's own database. Nothing yet loads
  `/mfa-enrolment` in a browser — `playwright.config.ts` is configured and
  `tests/e2e/` is still empty. §6.3 is the manual substitute.
- **Two credential files are still on the UAT host**, from the session that
  found this defect: `secrets/uat-admin-password`, and an
  `mfa-enrolment-…jack_sysadminheaven_nl.txt` artefact in the `splashtrack-data`
  volume. Both now refer to an account that no longer exists. They are Jack's
  files and were left alone rather than deleted.
