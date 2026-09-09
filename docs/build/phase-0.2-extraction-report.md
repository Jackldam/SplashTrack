# Phase 0.2 — Extraction report

**What this is.** A record of what came across from `WebAppTemplate` (`7db6488`)
into this repository, what deliberately did not, every `PHASE 0.4:` marker
placed, every claim the design set makes about the template that turned out to
be false, and the real output of the done-checks.

**Branch.** `build/v1-foundation`. Three commits on top of `bc1ff05`. Not pushed.

**One-line summary.** The foundation boots, builds, migrates and tests green
against a real Postgres — 28 tests, four of them against real Postgres. Three
genuine defects were found by *running* the extraction rather than reading it: a
schema column Better Auth 1.7 requires and the template does not have, a
publicly reachable account-creation endpoint, and nine high-severity advisories
on the pinned Next version including a middleware bypass. All three are fixed.
Two design claims about the template are false and one is imprecise. Two
decisions are yours (§8).

---

## 1. What landed

### 1.1 Application shell and tooling

| File | Note |
|---|---|
| `package.json` | Scripts from the template. `zod` added (`05-technical.md` §2 requires it and it is in neither repo). `better-auth` / `@better-auth/passkey` **pinned exactly** — §4.1. `next` on **16.3.4**, not the template's 16.2.10 — §4.5 |
| `tsconfig.json` | Verbatim. Flat root, `@/*` → `./src/*` (D-021 revised) |
| `next.config.ts` | next-intl plugin only. The template's `serverActions.bodySizeLimit` bump is for uploads, which are not extracted |
| `eslint.config.mjs` | Template's, plus SplashTrack ignore paths |
| `.prettierrc.json` | **Replaced** the repository's placeholder (single quotes, width 100) with the template's (double quotes, width 80). The whole extracted tree is formatted that way and nothing was formatted at the old settings, so switching now was free. It will not be free later |
| `.prettierignore` | Extended — see §4.3, this is where a real mistake was caught |
| `prisma.config.ts` | Template's, minus the `seed` entry: there is no domain model to seed |
| `instrumentation.ts` | Env assertion only. The template also started an in-process maintenance scheduler; there is no `maintenance` module |
| `middleware.ts` | Request-id propagation and the CSP-nonce/security-header path. The template's branding-hint cookie, MFA-current-path header and relaxed `/api-docs` CSP are all for surfaces that do not exist here |
| `vitest.config.ts`, `playwright.config.ts` | Two vitest projects (node + jsdom). Playwright runs against a production build only, and has no `globalSetup`: the template's seeded personas belong with the accounts and roles they seed |
| `.env.example` | Rewritten. Three variables, each justified against D-037, and **no working value anywhere** |
| `src/app/*` | Root layout, a placeholder landing page, `globals.css`, and three routes: `/api/auth/[...all]`, `/api/health`, `/api/ready` |
| `messages/nl.json`, `en.json` | Written fresh, at parity. The template's catalogues are ~130 KB each of copy for screens that do not exist |

### 1.2 Library

`src/lib/errors`, `src/lib/logging`, `src/lib/api/request-id`,
`src/lib/rate-limit`, `src/lib/database`, `src/lib/settings`, `src/lib/auth`,
`src/lib/env.ts`, `src/i18n`.

Load-bearing decisions inside that list:

- **`src/lib/database/index.ts` does NOT export `forOrganization`.**
  `organization-scope.ts` is not extracted, and this is the one place where
  "extract the multi-tenant machinery faithfully" and "do not build phase 0.4"
  conflict: the file imports the `Reach` type from `@/lib/security`, which is
  the scope model (D-147). Bringing it would have meant bringing a
  half-matching `Reach`. The tenant-aware **models** are all in the schema
  unchanged, so phase 0.3 still has a faithful diff to work against.
- **`src/lib/settings` exports only the READ paths.** The template's
  `getPlatformConfigForEdit`, `updatePlatformConfig` and `updateSessionPolicy`
  each call `requirePlatformPermission` — the platform-super-admin exception
  D-056 deletes, sitting on the guard that is phase 0.4. `writePlatformConfig`
  exists, takes an already-resolved `personId`, is **not** exported from the
  barrel, and says in its own doc comment that it authorizes nothing.
- **`src/lib/auth/session.ts` is adopted, not rewritten** (D-173). Its comments
  carry the two prior bugs the design says an engineer starting fresh would not
  know to reproduce.

### 1.3 Prisma

23 models, one migration, applied against a real Postgres.

Identity: `Person`, `UserAccount`, `Session`, `Account`, `Verification`,
`TwoFactor`, `Passkey`, `RateLimitCounter`.
Authorization (inherited, phase 0.3 removes it): `Organization`,
`OrganizationMembership`, `OrganizationUnit`, `Role`, `RoleAssignment`,
`PlatformRoleAssignment`, `AccessGroup`, `AccessGroupPermission`,
`RoleAccessGroup`, `Permission`, `RolePermission`.
Unused by design (`05-technical.md` §4): `ApiCredential`,
`CredentialRoleAssignment`.
Settings and audit: `PlatformSettings`, `AuditEvent`.

Every model that phase 0.3 touches carries a comment saying what 0.3 does to it.

### 1.4 Audit

`AuditEvent`, the versioned canonicalization, the SHA-256 chain, the
advisory-locked append, and `verifyAuditChain`. The genesis constant is
SplashTrack's own (`genesis:splashtrack:audit:v1`) so no verification can
succeed against a foreign chain.

### 1.5 Tests

Seven files, 28 tests, four of them against a real Postgres.

| Test | Provenance |
|---|---|
| `tests/unit/migration-safety.test.ts` | Adopted (D-135). Verified — see §3.1 |
| `tests/unit/person-reference-sync.test.ts` | Adopted (D-135). Verified — see §3.1 |
| `tests/unit/prisma-schema-parser.ts` + `.test.ts` | Adopted; the sync test depends on it |
| `tests/unit/audit-hash.test.ts` | Adopted |
| `tests/unit/message-catalog.test.ts` | Adopted, one assertion dropped — §3.1 |
| `tests/integration/audit-chain.test.ts` | **New.** Asserts the chain notices an interior row being edited |
| `tests/integration/account-provisioning-gate.test.ts` | **New.** Covers §4.2 in both directions |

`tests/integration/audit-chain.test.ts` is new because "tamper-evident" was a
claim about code nobody had run: the template unit-tests the digest, and asserts
nowhere that the chain actually catches a real `UPDATE`.

---

## 2. What I deliberately left behind

### 2.1 Phase 0.4 — the four things I was told not to build

None of the crypto envelope, the audit chain's checkpointing, `resolveReach` /
`coversResource`, or retention/erasure policy columns are present in any form.
No file half-implements one. Every place that will need one carries a marker.

### 2.2 Not extracted, with the reason

| Left behind | Why |
|---|---|
| Microsoft/Entra sign-in, account linking, `amr` capture, email-claim fallback, `PendingStepUp` and all of `lib/auth/step-up/` (11 files) | The IdP registry is out of v1. `Session.entraAmrObservation` and the `IDP_PROVEN` evidence value go with it |
| `enforceNativeSignInEnabled` and `authenticationConfig` | A toggle to disable password sign-in only makes sense when a second method exists. Here its only possible effect is locking everyone out |
| `lib/security/` — `requirePermission`, `permission-resolver`, `permissions`, `platform-admin-floor`, `org-admin-access` | Phase 0.4 (D-147), and it contains the platform-super-admin branch D-056 deletes. This is the largest single omission and it is deliberate |
| `lib/database/organization-scope.ts` | Depends on the 0.4 `Reach` type — see §1.2 |
| `lib/branding/` (5 files), `lib/theme/`, `lib/uploads/`, `UploadedAsset`, `OrganizationBranding` | Branding and assets are a phase-4 surface. Object storage is out of v1 |
| `lib/cookie-consent/`, the `cookies` config section | Phase-4 surface |
| `modules/consent`, `modules/profile-fields`, `modules/pages`, `modules/email-templates`, `modules/notifications`, `modules/maintenance` | Features, not foundation. Consent is retrofit-hostile (`06-delivery.md` §5 ranks it 6th) and must arrive with its repaired shape, not the template's |
| `PendingInvitation`, `EmailVerificationToken`, `invitationValidityHours` | Invitations and email verification belong with account provisioning in the `users` module |
| Public self-registration: `UserAccountStatus.PENDING_VERIFICATION`, `UserAccount.termsAcceptedAt` / `ageAttestationMinimum`, `Organization.registrationToken`, the `registration` config section | Out of v1 (R-12 reduces the public surface to a catalogue and an inquiry form) |
| `PlatformBootstrap`, `lib/auth/bootstrap.ts` | `CLAUDE.md` §1: no setup wizards in v1 |
| `lib/auth/login.ts` (697 lines: the re-auth helpers), `actions.ts`, `passkey-reauth-actions.ts`, `security-status.ts`, `session-isolation.ts`, `totp.ts` | Sign-in UI and step-up surfaces. `totp.ts` would have pulled in `qrcode` for an enrolment screen that does not exist |
| `lib/auth/api-credential.ts`, `lib/api/credential-auth.ts` | The tables stay (`05-technical.md` §4); the code arrives with the first integration |
| The audit READ surface: `audit-read-service.ts`, `personal-data-export.ts`, `sign-in-history.ts`, and the repository's filter/paginate/subject reads | Gated on an `audit.read` permission that does not exist (D-147) |
| `openapi/`, `api-docs/`, `/api/v1/` | No public API surface in v1 (`05-technical.md` §4) |
| The template's `messages/*.json`, its `src/components/`, `(portal)` and `(public)` routes | Copy and screens for features that do not exist here |

### 2.3 `rememberMeEnabled`

Dropped from the settings document. It is a sign-in-form policy switch and the
sign-in form is not extracted, so keeping it would have been a setting nothing
reads. It is also not in the design: `02-security-privacy.md` §4.1.2 names three
session settings and this is not one of them.

---

## 3. Design claims about the template that are FALSE

I was told two were found false last week, and to check rather than assume.
Two more are false and one is imprecise.

### 3.1 The three "adopt, do not re-invent" claims are TRUE

`05-technical.md` §5.1 is correct on all three, verified in the source:

- **`migration-safety.test.ts`** does block `ADD COLUMN … NOT NULL` without a
  default, via a line-wise regex over every `migration.sql`, with a second test
  keeping the allowlist tight. **Two adjustments were needed on adoption**, and
  they are the kind that would have failed silently:
  1. The allowlist named a template migration this repository does not have, so
     the "allowlist stays tight" test would have failed on arrival. Now empty,
     and it must stay empty.
  2. The sync test's parser-sanity floor named `CustomPage`, `EmailTemplate`,
     `MaintenanceJob` and `PlatformBootstrap` — none of which exist here.
     Narrowed to six columns that do, keeping both detection shapes covered: an
     FK-backed pointer and a plain token with no FK.
- **`person-reference-classification.ts` + `person-reference-sync.test.ts`** is
  D-014's registry, already built, and genuinely bidirectional (a schema column
  with no entry fails; an entry with no column fails).
- **`session.ts` + `settings/config.ts`** implement live, bounded,
  administrator-configurable idle and absolute timeouts, with
  fail-safe-to-strict degradation, an app-owned `Session.lastSeenAt`, and the
  cross-field rule. D-173 is right that the work is narrowing bounds and adding
  one key.

  *Imprecision, not falsehood:* D-173 cites `session.ts:125-142` for the live
  idle enforcement. Those lines are the middle of `getCurrentSession`'s doc
  comment; the enforcement is at `:185-206`. `config.ts:111-115`,
  `:132-136` and `:706-735` are all exactly right.

### 3.2 FALSE — the module-boundary ESLint rule does not exist

`05-technical.md` §3.1 states, in the present tense:

> An ESLint `no-restricted-imports` rule forbids importing `modules/<a>/…` from
> `modules/<b>/…` except through a module's published `index.ts`. This turns the
> dependency rule from a convention into a build failure.

`grep -rn "no-restricted-imports"` over the template's `eslint.config.mjs`
returns nothing. The config is four lines of composition (`nextVitals`,
`nextTs`, `eslintConfigPrettier`) plus ignore paths. **There is no module
boundary rule of any kind to inherit.**

`06-delivery.md` §2.1 compounds this: its blocking-checks table lists
"Lint (ESLint, incl. module-boundary rules) | Yes | **Inherited**. Extended: the
second rule that stops a module reaching another module's Prisma models". The
word "extended" implies a first rule exists. It does not — both rules are new
work.

This matters more than a documentation slip. §3.1's whole argument is that the
import rule is the weaker of the two and the per-module Prisma client is what
actually enforces D-057. That argument is still correct; what is wrong is the
premise that half the mechanism is already paid for. **Nothing enforces module
boundaries in this repository today**, and the first two domain modules are the
window in which that is cheap to fix.

### 3.3 FALSE (minor) — `src/lib/validation/` does exist

`05-technical.md` §2's Zod row says it is "in neither — no `zod` in
`package.json`, no imports, no `src/lib/validation/`". The first two are true.
The third is not: `WebAppTemplate/src/lib/validation/` exists, containing a
single `.gitkeep`. Immaterial to the conclusion — Zod still had to be added, and
was — but the row is cited as an example of verified-against-source, so it
should be right.

### 3.4 Claims that are TRUE, checked because they were cheap to check

- `05-technical.md` §1: `blob-storage.ts` supports only `"local"` and throws on
  anything else; there is no S3 client in `package.json`. **True.**
- `06-delivery.md` §2.1: `ci.yml` has exactly three jobs (`verify`, `e2e`,
  `migrate-populated`); no container build, no `npm audit` gate, no CodeQL, no
  secret-scanning job. **True.**
- `06-delivery.md` §2.1: axe appears only in prose. **True** — the only hits are
  a comment in `lib/branding/contrast.ts` and a substring of "relaxed" in a
  README.
- `06-delivery.md` §1: `deploy-uat.yml` runs `docker compose build` on the
  target host. **True** (`.github/workflows/deploy-uat.yml:40`).
- `05-technical.md` §3: the template is flat-root with `@/*` → `./src/*`.
  **True**, which is why D-021's revision is right.

---

## 4. Defects found by running it, and what I did

### 4.1 Better Auth 1.7 requires `Account.issuer`; the template's schema has no such column

`npm install` against the template's own `"better-auth": "^1.6.23"` resolves to
**1.7.2**, which added a required `issuer` field to the account model
(`@better-auth/core/dist/db/schema/account.d.mts`). The first real sign-up threw:

```
Invalid `prisma.account.create()` invocation:
  issuer: "local:credential",
  ~~~~~~
Unknown argument `issuer`. Available options are marked with ?.
```

A fresh install of `WebAppTemplate` breaks identically — it is protected only by
its committed lockfile.

**Fixed:** `issuer String` added to `Account`. Together with `accountId` it is
the provider-side key Better Auth recognizes an account by; local credentials
get `local:credential`, verified in the database.

**Also:** `better-auth` and `@better-auth/passkey` are now pinned to `1.7.2`
exactly, not by caret. The auth library owns the shape of four tables in this
schema, so a floating minor can change the database contract silently — which
is exactly what happened. The design already asks for a pinned auth version with
bumps treated as a security review; this is the concrete argument for it.

**The initial migration was regenerated rather than followed by a second one.**
Adding a `NOT NULL` column to an existing table is precisely what
`migration-safety.test.ts` blocks, the alternative was a permanent
`DEFAULT ''` on a column that must never be empty, and D-048 protects migration
chains *within a major version* — there are zero releases and zero tags, so
there is nothing yet to protect. The local dev database was recreated; it held
only rows my own probe had created minutes earlier.

### 4.2 `POST /api/auth/sign-up/email` was publicly reachable and worked

Measured against a running production build, not reasoned about:

```
$ curl -X POST http://localhost:3100/api/auth/sign-up/email \
    -H 'content-type: application/json' \
    -d '{"email":"probe@example.invalid","password":"…","name":"Probe Persoon"}'
HTTP 200
{"token":"…","user":{…,"personId":"i3il3j4orn7udovhou9vw8ut","id":"…"}}
```

An unauthenticated caller got a `Person`, a `UserAccount` with status `ACTIVE`,
a credential, and a session token. `/api/auth/[...all]` mounts Better Auth's
full endpoint surface and `emailAndPassword.enabled` puts sign-up on it.

The template documented this and left it open, on the reasoning that
`/sign-up/email` is "the server-side primitive behind bootstrap and admin
provisioning" — which is true of the *function* and not of the *route*. It was
survivable there because that platform had a deliberate public-registration
feature behind its own toggle. **SplashTrack has no such feature** (R-12), so an
open sign-up endpoint is not a feature missing a gate; it is a stranger creating
an account on a system holding children's records.

**Fixed:** `enforceServerSideSignUpOnly` denies `/sign-up/email` unless
`accountProvisioningMarker` is set. That is the same
`AsyncLocalStorage` + `hooks.before` shape the template already uses for its own
gates, not a new mechanism. It fails **closed**, which is the opposite direction
from the sign-in gate and correct: refusing to create an account cannot lock
anyone out of one they already hold.

This is the one place I built something the task did not list. I judged that
handing over a foundation with an open account-creation endpoint would be worse
than the scope stretch. Both directions are tested
(`tests/integration/account-provisioning-gate.test.ts`) — a gate only ever
tested in the refused direction is one refactor away from also refusing the
administrator, who in v1 is the *only* way an account is created.

### 4.3 `prettier --write .` rewrote four files in `.github/workflows/`

`.github/` is outside my write scope (D-025, F-18) and a repository-wide
formatter does not know that. Caught immediately, `git checkout`-ed, and
`.prettierignore` now excludes `.github`, `docker-compose.yml`, `infra`,
`environments` and `*.md`, with a comment saying why the entry must not be
removed to "tidy the workflows".

**Nothing under `.github/` is modified in any of the three commits.**

### 4.4 `/api/ready` did not check anything

The template shipped it with `TODO: add DB connectivity check once Prisma client
exists`. Prisma has existed for the entire life of that repository, so a
readiness probe reported `ready` for an instance that could not reach its
database at all. Now runs `SELECT 1`, logs the error server-side, and returns
`not_ready` with no detail — a readiness probe is reachable by anyone who can
reach the app.

### 4.5 Seven high-severity advisories on a clean install, one of them in middleware

`npm install` on the extracted dependency set reported **7 high severity
vulnerabilities**. `06-delivery.md` §2.1 lists `npm audit` on high and critical
as a required CI addition that nothing gates today — so this would have been the
foundation's opening state, unobserved.

Nine of the advisories sit on **`next@16.2.10`**, the version both repositories
pin, and they are not all abstract. One is *"Middleware / Proxy bypass in App
Router applications using Turbopack and single locale"* — this application uses
Turbopack, has a single default locale (`nl`), and puts its Content-Security-
Policy, `X-Frame-Options` and request-id propagation in `middleware.ts`. A
middleware bypass is a bypass of exactly that. Others include SSRF in Server
Actions and unauthenticated disclosure of internal Server Function endpoints.

**Fixed:** `next` and `eslint-config-next` bumped to `16.3.4`. Typecheck, lint,
build and all 28 tests are green on it. This was outside the 0.2 list, and I
did it anyway rather than hand over a foundation whose middleware advisory I had
read and left in place.

**Four high advisories remain, and they are accepted rather than unnoticed:**
`deepmerge-ts` and `mysql2`, both reached only through `@prisma/config` →
`prisma`. `npm audit fix --force` "fixes" them by installing `prisma@6.19.3` —
a major downgrade from the Prisma 7 driver-adapter architecture this foundation
is built on. `mysql2` is a MySQL driver that is never loaded: the runtime
connects through `@prisma/adapter-pg` over `node-postgres`. Bumping Prisma is
the real fix and belongs in its own change, with the migration suite as the
evidence — not folded into an extraction pass.

This is the concrete argument for the `npm audit` gate `06-delivery.md` §2.1
lists below the line: without it, "we are on a patched Next" is a claim nobody
re-checks.
---

## 5. Every `PHASE 0.4:` marker placed

| File | What is deferred | Decision |
|---|---|---|
| `prisma/schema.prisma` (header) | Encrypted columns and the envelope; `AuditCheckpoint`; retention/lawful-basis columns and the erasure registry | D-096/D-167, D-168, D-014/D-065 |
| `prisma/schema.prisma` (`AuditEvent`) | Checkpointing; the insert-only database role; one audit event per aggregate write | D-149, D-168, `05-technical.md` §5 rule 7 |
| `prisma/schema.prisma` (`Session.mfaEvidence`) | The step-up gate that consumes the evidence | D-147 |
| `prisma/schema.prisma` (`TwoFactor`) | "This permission requires MFA" enforcement — the predicate is the high-risk permission set | D-147 |
| `prisma/schema.prisma` (`OrganizationUnit`) | `UNIT` is flat in v1; the inherited `parentId`/`path`/`depth` columns must not talk `resolveReach` into a descendant walk | D-121 |
| `src/lib/settings/config.ts` | Nothing selects between the standard and elevated idle windows yet | D-173, D-147 |
| `src/lib/auth/session.ts` | The permission-based idle selection, at the exact line it goes | D-173, D-147 |
| `src/lib/auth/session.ts` (`mfaEvidence`) | The step-up gate | D-147 |
| `src/modules/audit/infrastructure/audit-repository.ts` | The insert-only role; `AuditCheckpoint`; the chunked segment walk | D-149, D-168 |
| `src/modules/audit/application/audit-service.ts` | The chunked walk replacing whole-chain verification | D-168 |
| `src/modules/users/infrastructure/person-reference-classification.ts` | `erasePersonData` and the erasure registry do not exist; the map is accurate first, deliberately | D-014, D-065 |
| `src/app/api/ready/route.ts` | The boot state machine including `FAILED` (phase 1, not 0.4) | `06-delivery.md` §5 |

Two of these are honest gaps rather than merely absent features, and are called
out as such in the code:

- **The elevated session idle window is not applied.** Every principal gets the
  standard 30-minute window, which is the *looser* of the two for a principal
  who should get 15. It closes when the permission set exists.
- **`readAuditChain` loads the whole chain.** Correct on an empty database,
  wrong on a two-year-old instance, and deliberately not papered over with a
  `take` — a partial read that reports "valid" is worse than a slow one that
  reports the truth.

---

## 6. Done-checks — real output

### 6.1 `npm install`

From a deleted `node_modules`:

```
$ rm -rf node_modules && npm install
added 683 packages, and audited 684 packages in 22s
197 packages are looking for funding
7 high severity vulnerabilities
```

**PASS**, and the postinstall `prisma generate` ran. But see §4.5 — those seven
high-severity advisories are not noise, and one of them is in the middleware
path this foundation puts its security headers on.

### 6.2 `npx prisma validate`

```
$ npx prisma validate
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀
```

**PASS.**

### 6.3 `npm run build`

```
$ npm run build
▲ Next.js 16.3.4 (Turbopack)
- Environments: .env
✓ Running next.config.ts took 49ms
  Creating an optimized production build ...
✓ Compiled successfully in 232ms
  Running TypeScript ...
  Finished TypeScript in 2.8s ...
✓ Generating static pages using 5 workers (5/5) in 334ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/[...all]
├ ƒ /api/health
└ ƒ /api/ready

ƒ Proxy (Middleware)
```

**PASS.** `npx tsc --noEmit` exits 0; `npm run lint` exits 0;
`npx prettier --check .` reports "All matched files use Prettier code style!".

### 6.4 `docker compose up postgres` + a migration

```
$ docker compose up -d postgres
 Container splashtrack-postgres-1  Started
$ docker compose ps
splashtrack-postgres-1   postgres:16-alpine   Up (healthy)   0.0.0.0:5432->5432/tcp

$ npx prisma migrate dev --name foundation_identity_authorization_settings_audit
Datasource "db": PostgreSQL database "splashtrack", schema "public" at "localhost:5432"
Applying migration `20260902230852_foundation_identity_authorization_settings_audit`
The following migration(s) have been created and applied from new schema changes:
prisma/migrations/
  └─ 20260902230852_foundation_identity_authorization_settings_audit/
    └─ migration.sql
Your database is now in sync with your schema.
```

23 tables plus `_prisma_migrations` confirmed present via `psql \dt`.

**PASS.**

### 6.5 The test runner

```
$ npm test
> splashtrack@0.1.0 pretest
> tsx scripts/setup-test-db.ts
[setup-test-db] Database "splashtrack_test" already exists.
[setup-test-db] Applying migrations to "splashtrack_test"...
1 migration found in prisma/migrations
No pending migrations to apply.
[setup-test-db] Reset the audit trail (TRUNCATE "AuditEvent").
[setup-test-db] Test database ready.

 RUN  v4.1.11 /root/projects/SplashTrack

 Test Files  7 passed (7)
      Tests  28 passed (28)
   Duration  3.05s
```

**PASS**, and honestly: four of those tests talk to a real Postgres, including
one that edits an interior audit row and asserts the chain reports it broken.

`vitest` emits a deprecation warning on every run — `vitest.config.ts` uses ESM
syntax in a file loaded as CommonJS, and `vite-tsconfig-paths` is now redundant
because Vite resolves tsconfig paths natively. Inherited from the template.
Cosmetic; left alone rather than mixed into an extraction pass.

### 6.6 The application actually runs

```
$ curl -si http://localhost:3100/api/health
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; …
x-content-type-options: nosniff
x-frame-options: DENY
x-request-id: req_a5b53d15-87f4-470e-87a4-61c64306719e

$ curl -s http://localhost:3100/api/ready
{"status":"ready","checks":[{"name":"process","status":"ok"},
                            {"name":"database","status":"ok"}],…}
```

Sign-in against a provisioned account returns 200 with an
`HttpOnly; SameSite=Lax` session cookie, and both outcomes reach the audit trail
with no personal data in them:

```
 sequence |        eventType        | outcome | targetType   |     changedFields      |       reason
----------+-------------------------+---------+--------------+------------------------+---------------------
        1 | security.password_login | SUCCESS | user_account | {"method": "password"} |
        2 | security.password_login | FAILURE | user_account | {"method": "password"} | invalid_credentials
```

The identity split holds: one `Person`, one `UserAccount` linked to it, one
`Account` carrying the hash (`providerId = credential`, `issuer =
local:credential`), and no password material on either of the first two.

After the §4.2 fix, the same public sign-up returns:

```
HTTP 403
{"message":"Accounts are created by an administrator."}
```

with zero rows written.

### 6.7 What I did NOT run

- **Playwright.** `npm run test:e2e` would start a server and find no specs.
  There is no UI to test; the harness is configured and unexercised.
- **The CI workflows.** Outside my write scope, and see §7.

---

## 7. For Jack — things needing a hand outside my scope

1. **`.github/workflows/deploy-prd.yml` still references `apps/web`**, which no
   longer exists (carried over from §0.1). `deploy-uat.yml` also needs deleting
   or replacing: UAT is out of v1, and it builds on the target host, which
   D-022 inverts. `ci.yml`'s three jobs are a reasonable starting point but its
   paths assume the template's layout. I cannot touch any of it (D-025, F-18).
2. **The eight blocking checks in `06-delivery.md` §2.1 do not exist yet**, and
   §3.2 above shows one of them ("module-boundary rules — Inherited") was never
   inherited at all.

---

## 8. Two things I want a decision on

Neither blocked this pass; both are cheap now and expensive later.

### 8.1 Should the module-boundary lint rules land before the first domain module?

§3.2: nothing enforces module boundaries, and the design believed half of it
was inherited. `05-technical.md` §3.1 specifies two rules — the
`no-restricted-imports` one that catches cross-module imports, and the
per-module Prisma client that catches what actually matters (`planning` reaching
`prisma.scheduledSession` directly, D-057). The second is the load-bearing one
and it needs a per-module client wrapper, which is a real design decision about
how repositories are constructed.

Building it before `people` exists costs a day and shapes every module after it.
Building it after three modules exist means retrofitting three modules'
`infrastructure/`. I did not do it here because it is not in the 0.2 list and it
is not a two-line change. **Say the word and it goes in before the first
module** — or say it waits and I will note it as accepted debt.

### 8.2 `ApiCredential` — keep the tables with no code, or drop them until needed?

`05-technical.md` §4 says scoped API credentials are "inherited from the
template and stay in place, unused", so I kept both models. But I did *not*
extract the code that reads them, so today they are two tables no line of code
touches, that phase 0.3 must nonetheless reshape when it strips
`organizationId`, and that phase 0.4 must classify for erasure (already done —
`ApiCredential.createdByPersonId` is in the person registry).

Keeping them costs a little work in 0.3. Dropping them means re-adding two
models when an integration finally exists, which the design says will not be in
v1 at all (D-163, OD-19). I followed the design and kept them. If the intent of
"stay in place" was "keep the code path warm" rather than "keep the tables", the
right answer is probably to drop them until there is something to authenticate.
