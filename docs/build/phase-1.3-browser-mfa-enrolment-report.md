# Phase 1.3 — MFA enrolment moves to the browser

**Branch** `build/v1-foundation` · **From** `b04009f` · **Decision** D-185
**Suite** 413 → 434 tests, green before and after every commit.

---

## 1. The defect

> *"Als ik het account maak moet ik gelijk een MFA-code invullen, maar ik heb
> nergens de key gekregen en ik kan niet naar het bestand want ik moet de 6
> cijfers invullen. Kunnen we dit niet beter vanuit de website forceren zodat ik
> dit probleem niet heb?"*

`splashtrack admin:create` wrote the TOTP secret to a `0600` file, printed only
that file's path, and then blocked on a prompt demanding a six-digit code. The
operator could not open the file without abandoning the prompt. **The command as
built could not be completed by the person it exists for.**

The requirement that produced that shape is F-20's — self-hosters paste terminal
output into public issues, so a TOTP secret must never reach a terminal, a log
or a scrollback buffer. That requirement is unchanged and is not weakened
anywhere below. What was wrong was the *place*: a terminal is the wrong surface
for enrolling an authenticator.

A second defect surfaced standing UAT up: `setup:init` migrated and then seeded,
with no grant application in between, so the seed died with
`permission denied for table Organization` on any genuinely empty database.

---

## 2. What landed

Four commits, each with the suite green before and after.

| Commit | What |
|---|---|
| `455c894` | `setup:init` grants before it seeds; the entrypoint's SERVE branch re-asserts the model too |
| `9702a5d` | `mfa_pending` is a real, enforced state — the HTTP gate and the page/action guard |
| `06331d5` | The browser enrolment flow: QR, typeable key, verification, setup completion |
| `ea03908` | `admin:create` stops enrolling; `admin:reset-mfa` keeps working |

### 2.1 The flow, end to end

```
splashtrack admin:create --email … --password-file …
  → account + password + instance_administrator @ ORGANIZATION + self @ SELF
  → NO MFA factor, NO bootstrap record, NO artefact file, NO prompt
  → prints the sign-in URL

browser: /sign-in  (password alone — there is no second factor to ask for)
  → 307 /mfa-enrolment              (forced; every other route refuses)
  → password re-entered, QR + typeable key + 10 backup codes rendered
  → six digits from the authenticator
  → TwoFactor.verified = true, InstallationBootstrap written, → /
```

### 2.2 `mfa_pending`, and why it is derived rather than stored

`src/lib/auth/mfa-enrolment.ts`. An account is pending while it holds no
`TwoFactor` row with `verified = true`. That is the same column and the same
question D-141's invariant asks. A `UserAccountStatus.MFA_PENDING` enum member
would be a second copy of that fact, free to drift from `TwoFactor.verified`,
and the drift would be silent and in the unsafe direction.

### 2.3 Two guards, over disjoint surfaces

An account that can act before its second factor exists is a worse hole than the
one being fixed, so the window is closed from both sides — server-side, not by
hiding a link.

**`enforceMfaEnrolmentBeforeUse`** (a Better Auth `before` hook) bounds the HTTP
surface. `/api/auth/[...all]` mounts *every* Better Auth endpoint, so a pending
account's session cookie otherwise reaches `update-user`, `change-email`,
`list-sessions`, `disable-two-factor`, `verify-backup-code` and passkey
registration by a direct POST with no application page involved. Deny by
default; the allowlist is exactly four paths:

| Path | Why |
|---|---|
| `/two-factor/enable` | mints the secret and returns the `otpauth://` URI |
| `/two-factor/verify-totp` | the path *out* of the pending state |
| `/sign-out` | a pending account must be able to leave |
| `/get-session` | read-only; the session helper calls it on every request |

`/two-factor/disable` is deliberately absent (it would clear a factor nobody
proved), and so is `/two-factor/verify-backup-code` (a factor never verified has
no authenticator to lose). `/sign-in/email` needs no exemption: it runs with no
session, so the gate never applies. The session is resolved from the **signed
cookie**, not by calling `auth.api.getSession()`, which would re-enter the
pipeline the hook is guarding. Each refusal writes a `DENIED` audit event naming
the path. It fails closed on an unreadable database.

**`requireEnrolledSession()`** (`src/lib/auth/session.ts`) bounds pages and
Server Actions. Every protected surface now calls it: `people/access.tsx`, the
people actions, the break-glass dismissal. Its refusal is a **307 with a
Location**, never a 200 with an empty table. That is a different answer from an
authorization denial — `people/access.tsx` argues for a rendered panel there,
because "you lack this permission" is terminal for the caller. "You have not
finished enrolling" has a remedy the caller can act on now, in one place, and
being forced to it is the requirement.

`tests/unit/route-guard-coverage.test.ts` holds this at the source level: no
file under `src/app` may use the weaker `getCurrentSession()` without an
allowlist entry carrying the reason it must serve a pending account. Four
entries today (landing page, sign-in page, break-glass banner, the enrolment
page and its actions).

### 2.4 The QR code

`src/lib/auth/totp-qr.ts`. `uqr` (one new runtime dependency, zero transitive
deps) supplies only the **matrix**; the geometry is built here into a single SVG
path `d` — digits, `M`, `h`, `v`, `z` and nothing else — rendered by React as an
ordinary attribute. There is no HTML injection point, no
`dangerouslySetInnerHTML`, and the `otpauth://` URI carrying the secret never
reaches the markup. The same secret is offered as its base32 form, grouped in
fours, for an authenticator that cannot scan.

### 2.5 Why the page is a client component

The QR exists only in the response to the "start enrolment" POST, and must not
exist anywhere else. A URL would put it in browser history and every proxy log
between here and the operator; a cookie or a row would store it a second time
beside the copy Better Auth already encrypts. `useActionState` keeps it in that
POST response and in memory. **Two independent action states**, so a mistyped
code re-renders the same QR rather than sending the operator back to the
password step. A reload loses the QR; the page says so, and re-entering the
password replaces the unverified factor rather than adding a second one.

### 2.6 Setup completion moved

`admin:create` used to write the `InstallationBootstrap` record, because it also
enrolled MFA. It no longer enrols, so an `admin:create` that closed setup mode
would latch "set up" over an installation whose only administrator cannot prove
a second factor — and the latch never reopens.

`completeSetupIfInvariantHolds()` (`src/lib/boot/setup-mode.ts`) writes it, from
the enrolment flow, and only when `countLocalOrganizationAdmins() > 0`. **Setup
is not complete while the only administrator is `mfa_pending` because nothing
has written the record**, not because a page says so.

`resolveSetupStage()` gives the notice its two unfinished states:

| Stage | What the notice says |
|---|---|
| `NO_ADMINISTRATOR` | the `docker compose exec … admin:create` command |
| `ADMINISTRATOR_PENDING_MFA` | *"Bijna klaar: de beheerder moet nog een authenticator instellen"* + what to do + a link to sign in |
| `COMPLETE` | the portal |

The sign-in page no longer bounces a pending administrator to the landing page —
signing in *is* how they reach enrolment.

---

## 3. D-141, restated rather than broken

The invariant requires at least one local `ORGANIZATION`-scoped account with a
**verified** MFA factor at all times. During setup that is unsatisfiable: before
`admin:create` there is no account at all. The register asserted a continuous
property that was already false on every fresh installation.

**D-185** (added to `docs/design/09-decision-register.md` on this branch, next
free number after D-184 — the design branch is `design/architecture-phase` and
this edit is for the owner to reconcile) restates it:

> at least one local `ORGANIZATION`-scoped account with a verified MFA factor
> exists at all times **once setup is complete**, and during setup there is a
> bounded window in which one pending account exists and can act on nothing.

That is made true by construction rather than by assertion: the thing that ends
setup mode is `completeSetupIfInvariantHolds`, which calls the invariant's own
predicate and writes nothing until it returns a non-zero count. **The moment
setup completes is the moment the invariant first holds.** The reasoning is also
written into `src/lib/auth/local-admin-invariant.ts`, so the code and the
register agree.

Consequence for callers: `admin:create` no longer calls
`assertLocalAdminInvariantHolds` — it cannot hold at that point, and asserting
it would make the command fail on success. Every other call site is post-setup.

---

## 4. `admin:reset-mfa` — kept, and how

The file-writing path (`writeEnrolmentArtefact`, mode `0600`, path printed and
contents never) is **not removed**, because `admin:reset-mfa` still uses it. That
is deliberate:

- it exists for an administrator whose authenticator is gone, on the
  single-administrator installation D-141 is written for;
- deleting the factor and sending them to a browser would leave the invariant
  false for as long as that round-trip took;
- re-enrolling inside the one command keeps it false for one transaction and
  true again before the command returns, and restores the old factor on failure.

Its usability is also bounded in a way `admin:create`'s was not: **the artefact
already exists before the prompt appears**, because the account had a factor and
the reset writes the replacement immediately. The operator opens a file that is
there, in a second terminal, and types the code. `admin:create` had nothing to
open at the moment it blocked.

It is covered end to end (§5.2) precisely so that keeping it is a tested
decision rather than a surviving artefact.

**Open question for the owner** — see §7.

---

## 5. Definition of done — run, not claimed

### 5.1 The checks

```
npx prisma validate     The schema at prisma/schema.prisma is valid 🚀
tsc --noEmit            (clean)
npm run lint            (clean)
npm run format:check    All matched files use Prettier code style!
npm run build           ✓ Generating static pages using 5 workers (8/8)
npm test                Test Files 38 passed (38) · Tests 434 passed (434)
npm run db:recreate     All migrations have been successfully applied.
                        [recreate-database] Role model in force on
                        "splashtrack_freshcheck" (applied as splashtrack_owner).
npx prisma migrate deploy   No pending migrations to apply.
```

Baseline before this work: 413 tests. After: 434.

### 5.2 The new tests, and what each proves

**`tests/integration/setup-init-from-empty.test.ts`** — the real CLI, in a child
process, against throwaway empty databases.

- *migration alone leaves the runtime role locked out*: `SELECT 1 FROM
  "Organization"` as `splashtrack_app` raises `permission denied for table
  Organization`, while the owner reads it fine. This is the negative half, and
  it is why the positive one is evidence rather than a tautology.
- *`setup:init` migrates, grants and seeds in one command*: 63 permissions, both
  system roles and the organisation singleton readable **as the runtime role**,
  with `splashtrack_app` still holding no UPDATE/DELETE/TRUNCATE on `AuditEvent`
  and still holding INSERT.
- *`admin:create` creates a pending administrator without ever asking for a
  code*: run with no TTY and **no stdin at all**, which the old command could
  only have hung on. Asserts the account, both grants, **zero `TwoFactor` rows**,
  zero sessions, no completed bootstrap, no `mfa-enrolment-*` file, and neither
  `"Six-digit code"` nor `otpauth://` in the output.
- *`admin:reset-mfa` still enrols from the terminal*: driven the way an operator
  drives it — the harness waits for the artefact to appear, reads the secret out
  of it *while the command blocks*, and types a real generated code back. Ends
  with `verified = true`, and the secret is absent from the command's output.

**`tests/integration/mfa-pending-gate.test.ts`** — the real endpoint surface with
a real session cookie (`auth.api.*` is the handler `/api/auth/[...all]`
dispatches to, through the identical before-hook chain).

- a pending account signs in with the password alone and can read its session;
- it is refused `update-user`, `change-email`, `list-sessions`,
  `disable-two-factor` and `verify-backup-code`, **and nothing changed** — the
  name and email are still what they were, because the refusal happened in a
  before-hook ahead of the handler. *The denial is a denial, not an empty page.*
- each refusal writes one `DENIED` audit event of type
  `security.mfa_enrolment_required` naming the path;
- it may enrol; **enrolled is still not verified** — `update-user` is refused
  again between `enableTwoFactor` and `verifyTOTP`;
- a real generated TOTP code flips the factor, and `update-user` then succeeds
  and actually writes. *Fully usable after verification and not before.*

**`tests/integration/mfa-enrolment.test.ts`**

- the rendered QR path is rasterised and decoded by **`jsqr`, an independent
  decoder**, and yields back the exact `otpauth://` URI — the encoder is not
  marking its own homework;
- the typeable key is the same secret, grouped in fours;
- **the secret appears zero times in application logs.** Pino writes through
  `sonic-boom` straight to fd 1, which a `process.stdout.write` spy never sees —
  measured, not assumed — so a child process runs a whole enrolment and the
  parent reads its pipe. The raw key, its base32 form, `otpauth://` and all ten
  backup codes: zero occurrences. **This test was falsified before it was
  trusted**: a deliberate `logger.info({ leak: totpURI })` made it fail with
  `expected '…' not to contain 'FVIFUNKOMQWX…'`, and was then reverted.
- setup does not complete while the administrator is pending, and completes the
  instant a real code verifies — `completedVia = "browser"`, idempotent on a
  second call.

**`tests/unit/route-guard-coverage.test.ts`** — the source-level allowlist, and
`decideRouteAccess` for all three answers (no session → `/sign-in`, pending →
`/mfa-enrolment`, enrolled → allow; and an `mfaPending`-less fixture reads as
enrolled).

### 5.3 End to end on the UAT stack

`docker compose --env-file .env.uat`, image rebuilt from this branch,
`splashtrack_uat` **dropped and recreated** empty, driven over the real origin
`https://uat.splashtrack.sysadminheaven.nl`.

**Boot on an empty database** — setup mode, no migrations, and the new message:

```
SplashTrack 0.1.0 — boot state EMPTY
SETUP MODE (EMPTY). No migrations have been run.
  … That command creates the account and stops. SETUP IS NOT COMPLETE
  until its second factor exists (D-185): sign in at
  https://uat.splashtrack.sysadminheaven.nl/sign-in with the password you chose…
  The TOTP secret is shown there and nowhere else — not in this log,
  not in a file, not on a terminal.
```

**`setup:init`** — the grants bug, gone:

```
All migrations have been successfully applied.
Migrations applied.
Re-applying the ADR-0002 role model over the new schema…
Applied as splashtrack_owner (session splashtrack_retention).
D-149 part 2 is in force: splashtrack_app holds SELECT and INSERT on AuditEvent…
Seeding the permission catalogue and the system roles…
  63 permission(s), roles: instance_administrator, self, organisation singleton created
```

**`admin:create`**, run with `< /dev/null` — no stdin whatsoever — exit 0:

```
Administrator created: jack@sysadminheaven.nl
  role       instance_administrator @ ORGANIZATION
  MFA        NOT YET ENROLLED — the account can do nothing else
  audit      uutu3x0akzx8q0csltrrneqc
SETUP IS NOT COMPLETE. Finish it in a browser:
    https://uat.splashtrack.sysadminheaven.nl/sign-in
```

**Anonymous, before sign-in:**

```
/                -> 200   (Bijna klaar: de beheerder moet nog een authenticator instellen)
/sign-in         -> 200
/people          -> 307 → /sign-in
/mfa-enrolment   -> 307 → /sign-in
```

**Signed in with the password alone, still pending** — this is the requirement-2
proof over real HTTP:

```
POST /api/auth/sign-in/email  -> 200   (cookie: __Secure-better-auth.session_token)
GET  /people                  -> 307 → /mfa-enrolment
GET  /mfa-enrolment           -> 200
GET  /sign-in                 -> 307 → /mfa-enrolment
```

**Enrolment through the actual rendered pages.** Every POST below is the no-JS
progressive-enhancement submit of the form the server rendered — the `$ACTION_*`
hidden inputs React emits, read out of the served HTML, as
`multipart/form-data`. No API was called directly and no action id was invented:

```
1. sign in with the password alone -> 200
2. GET /mfa-enrolment -> 200 | password form: true
3. POST the rendered password form -> 200
4. QR rendered: 53x53 modules, 1042 dark modules
5. QR decodes to a real otpauth URI: otpauth://totp/SplashTrack:jack%40sysadminheaven.nl
   | issuer: SplashTrack | digits: 6 | period: 30 | secret length: 52 base32 chars
6. typeable key on the page matches the QR: true
   backup codes shown: 10
7. generated a real TOTP code from that key (6 digits: true)
8. POST the rendered code form -> 303
9. GET /               -> 200
   GET /people         -> 200          ← was 307 → /mfa-enrolment
   GET /mfa-enrolment  -> 307 → /      ← already enrolled; re-enrolment refused
10. landing page shows the portal: true | people link: true
```

The QR was decoded from the **served SVG path** by `jsqr`, so what a phone
camera would read was verified, not assumed.

**Database afterwards:**

```
completedAt  | 2026-09-04 17:00:54.078
completedVia | browser
appVersion   | 0.1.0

email            | jack@sysadminheaven.nl
twoFactorEnabled | t
verified         | t

instance_administrator | ORGANIZATION
self                   | SELF
```

**The secret, searched for as its real decrypted value** (taken from the UAT
database and decrypted with the same derivation the application uses, never
printed):

```
decrypted the stored TOTP key: 32 chars, 52 base32 chars

docker compose logs (whole stack, since boot): 492774 bytes / 2417 lines
   the decrypted TOTP key (plaintext)             0
   its base32 form (what the QR carries)          0
   the encrypted secret as stored                 0
   'otpauth://'                                   0
   'mfa-enrolment-' (the old artefact filename)   0

docker compose logs app (app container only): 2422 bytes / 38 lines
   … all five: 0
```

---

## 6. What an operator now runs for a first account

```sh
docker compose exec app splashtrack setup:init          # optional; admin:create does it
docker compose exec app splashtrack admin:create \
    --email you@example.org --name 'Your Name'
```

then open the URL that command prints, sign in with that password, scan the QR
and type the six digits. That completes setup. Nothing is typed at a terminal
that the terminal did not show first.

---

## 7. Open, and left for the owner

1. **`admin:reset-mfa` still has a smaller version of the same friction.** It
   works — proved end to end — but it prints a path and asks for a code from a
   file the operator must open in another terminal. It *could* become: delete
   the factor, let the account fall back to `mfa_pending`, and re-enrol in the
   browser through exactly the flow built here, deleting the last artefact-file
   path in the product. The reason it was not done is D-141: on a
   single-administrator installation that leaves the invariant false for a
   browser round-trip rather than for one transaction. **That is a decision, not
   an oversight — and it is the owner's.**

2. **A stale artefact is sitting in the UAT data volume.**
   `/app/data/mfa-enrolment-1788538223234-jack_sysadminheaven_nl.txt`, 678 bytes,
   mode `600`, written **2026-09-04 16:10 UTC** — before this work, by the old
   `admin:create`. Its account no longer exists (the database was dropped), so
   the secret it holds is dead, but it is exactly the artefact class D-185
   removes and it survives in the persistent volume. It was left in place rather
   than deleted unilaterally.

3. **`admin:create` is no longer self-limiting.** It used to close setup mode, so
   it refused a second run. Now a second run with a different address creates a
   second pending administrator. That is *reported* (the command lists the
   existing accounts) rather than refused, because refusing would strand an
   operator who mistyped the first address — the account they cannot use would
   also be the one blocking the account they need. Whichever enrols first
   completes setup; the rest are removed from the application afterwards.

4. **Dependencies added.** `uqr@0.1.3` (runtime, zero transitive dependencies)
   for the QR matrix; `jsqr@1.4.0` (dev) so an independent decoder verifies it.

---

## 8. Files

| File | |
|---|---|
| `src/lib/auth/mfa-enrolment.ts` | new — the state, the allowlist, the predicates |
| `src/lib/auth/totp-qr.ts` | new — QR path and typeable key |
| `src/lib/app-version.ts` | new — one home for `APP_VERSION` |
| `src/app/mfa-enrolment/{page.tsx,actions.ts,state.ts,enrolment-flow.tsx}` | new — the flow |
| `src/lib/auth/auth.ts` | `enforceMfaEnrolmentBeforeUse` |
| `src/lib/auth/session.ts` | `mfaPending`, `requireEnrolledSession`, `decideRouteAccess` |
| `src/lib/auth/local-admin-invariant.ts` | D-141 restated in prose |
| `src/lib/boot/setup-mode.ts` | `resolveSetupStage`, `completeSetupIfInvariantHolds` |
| `src/cli/commands/admin.ts` | `admin:create` stops enrolling |
| `src/cli/commands/setup.ts` | `migrateAndApplyRoleModel` |
| `src/cli/commands/database.ts` | `applyRoleModelOrThrow`, shared name resolution |
| `docker-entrypoint.sh` | grants on SERVE; the new setup-mode message |
| `src/app/{page.tsx,sign-in/page.tsx,people/*,break-glass-*}` | the guard, the two notices |
| `messages/{nl,en}.json` | the enrolment screen, in both locales |
| `docs/design/09-decision-register.md` | D-185 |
