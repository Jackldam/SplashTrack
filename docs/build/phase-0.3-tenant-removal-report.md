# Phase 0.3 — Tenant-removal report

**What this is.** A record of what phase 0.3 removed from this repository under
D-056, what it kept and why, what it re-homed rather than deleted, every new
`PHASE 0.4:` marker, the greps that prove the absence, and the real output of
the done-checks.

**Branch.** `build/v1-foundation`. Five commits on top of `b7c7849`. Not pushed.

**One-line summary.** The multi-tenant machinery is gone: `PlatformRoleAssignment`,
seven `organizationId` columns with their foreign keys and twelve indexes,
`PlatformSettings` (merged into `Organization`), `slug`, `status` and the
`OrganizationStatus` enum. The organisation is now a singleton **the database
refuses to break** — a `CHECK` constraint, not a constant in the code — and a
four-test suite proves it in both refusal directions. Five commits, tests green
before and after each: 28 → 28 → 28 → 28 → 32.

**The one thing worth arguing about** is §3.1: dropping `AuditEvent.organizationId`
redefined the audit chain's frozen v1 canonicalization array. It is defensible
only because there is no history to protect, and it is the last time it will be.

---

## 1. Inventory — what tenant machinery actually reached this repository

The task list came from the design. Checked against the code first, because two
of its five items had nothing here to remove.

| Design says remove | Present in this repository? |
|---|---|
| Tenant-scoping client extension (`forOrganization`, `ORG_SCOPED_MODELS`) | **No.** Phase 0.2 did not extract `lib/database/organization-scope.ts` (report §2.2) |
| Middleware separating organisations | **No.** `middleware.ts` is request-id propagation and the CSP-nonce/security-header path; it has never had a tenant resolver |
| Authorization paths — `requirePermission`'s platform-super-admin branch, `requirePlatformPermission`, `platform-admin-floor`, `org-admin-access` | **No.** Phase 0.2 did not extract `lib/security/` at all. The branch `06-delivery.md` §5 warns is "real code and not just prose" is real code **in the template**; it never landed here |
| `platform.super_admin` and the platform permission namespace | **No code, one table.** No permission catalogue exists yet, so the namespace had no rows; `PlatformRoleAssignment` was its storage |
| Per-row tenant columns and their composite foreign keys | **Yes** — seven columns across seven models |
| `PlatformSettings` (the platform-versus-organisation settings duality) | **Yes** — one table, and the whole of `src/lib/settings` reading it |
| Multi-row `Organization` semantics | **Yes** — a cuid primary key, a unique `slug`, and a lifecycle `status` |

So the removal is **schema-and-settings work, not authorization work**. That is
worth stating plainly: there was no dead guard to delete here, and no permissive
default was introduced in place of one, because there was no guard at all. The
authorization surface arrives whole in phase 0.4.

---

## 2. The five commits

Each is its own reviewable diff with the suite green before and after.

| # | Commit | What went |
|---|---|---|
| 1 | `4c377c6` | `PlatformRoleAssignment` and the platform-role concept |
| 2 | `7498877` | `AuditEvent.organizationId` and its two indexes |
| 3 | `5329685` | Every remaining `organizationId` column, foreign key and index |
| 4 | `259f03a` | `OrganizationMembership` → `Membership` |
| 5 | `1b55662` | `PlatformSettings` merged into `Organization`; `slug`, `status`, `OrganizationStatus`; the singleton enforced at the database |

Test counts: 28 green at the start and after commits 1–4; 32 after commit 5,
which adds the four singleton tests.

### 2.1 Migrations

Six migrations now, four of them new. Three were written by hand, for reasons
that matter:

| Migration | Written by | Why |
|---|---|---|
| `…44536_remove_platform_role_assignment` | `prisma migrate dev` | Straight table drop |
| `…44636_remove_audit_event_organization_scope` | `prisma migrate dev` | Straight column drop |
| `…64952_remove_organization_scoping_columns` | `prisma migrate diff` + `migrate deploy` | The two narrowed unique constraints make `migrate dev` **interactive**, and it refuses to run non-interactively. `migrate diff` between the previous committed schema and the new one produces the same SQL without the prompt |
| `…65203_rename_organization_membership_to_membership` | **hand-written** | `migrate diff` renders a model rename as `DROP TABLE` + `CREATE TABLE`, which destroys every row. The migration renames the table, its primary key, both indexes and both foreign keys **in place** |
| `…65629_merge_platform_settings_into_organization_singleton` | **hand-written** | Two reasons: `migrate diff` drops `PlatformSettings` without carrying the configuration across, and the Prisma DSL cannot express a `CHECK` constraint at all |

Both hand-written migrations were verified to leave the database matching the
schema exactly rather than approximately:

```
$ npx prisma migrate diff --from-schema prisma/schema.prisma \
      --to-config-datasource --script --exit-code
-- This is an empty migration.
exit=0
```

That check also establishes something worth knowing for later: **Prisma's diff
engine does not see the `CHECK` constraint.** It reports no drift with the
constraint present and would report none with it absent. Nothing but the
migration file and `tests/integration/organization-singleton.test.ts` protects
it — which is why both say so in a comment.

---

## 3. What was removed

### 3.1 `AuditEvent.organizationId` — and the frozen hash array

The column is gone, with `AuditEvent_organizationId_idx` and
`AuditEvent_organizationId_sequence_idx`. With one organisation it carried no
information and those two indexes supported a filter nobody can ask for.

**It sat inside the FROZEN v1 canonicalization array that every audit row's hash
commits to** (position 6 of 11), so removing it redefines that array. This is
the most consequential judgement call in the phase, so the reasoning is here in
full rather than in a commit message:

- **A v3 branch does not help.** `verifyAuditChain` re-canonicalizes each row by
  its own stored `contentVersion`; verifying a v1 row would mean re-reading a
  column that no longer exists. Adding a version leaves v1 rows unverifiable
  exactly as removing the field does.
- **A hardcoded `null` placeholder** would preserve every existing hash for one
  line of code — and leave a fossil in the canonical array forever, a field that
  means nothing, which is precisely the false signal to the next reader that
  D-056 exists to delete.
- **There is no history to protect.** Zero releases, zero tags, no deployed
  instance (OD-1, closed 2026-09-02). This is the same ground on which phase 0.2
  regenerated the initial migration rather than adding a second one, and D-048
  protects migration chains *within a major version* that does not exist yet.

So v1 was redefined, **once**, and the code, the test that pins the array byte
for byte, and this report all say it is the only time it may happen. Consequence
stated rather than discovered: **any audit row written before commit 2 no longer
verifies** — recreate a local development database. The test database is
truncated by `scripts/setup-test-db.ts` on every run and is unaffected.

### 3.2 `PlatformRoleAssignment` and the platform-role concept

Deleted: the model, its relations on `Person` and `Role`, and its entry in the
person-reference registry. The registry's bidirectional sync test would have
failed on the stale entry, which is what that test is for.

`platform.super_admin` needed no code change because no permission catalogue
exists yet. What replaces the concept is a constraint on phase 0.4, recorded as
a marker where the model used to be: `requirePermission` resolves a principal's
permissions from `RoleAssignment` **alone**. There is no second grant table and
no branch that bypasses the permission check — which is also why D-130 binds the
MFA mandate and the security alerts to permissions rather than to a role name.

### 3.3 Seven `organizationId` columns

`Role`, `OrganizationUnit`, `AccessGroup`, `RoleAssignment`, `ApiCredential`,
`OrganizationMembership` and `AuditEvent`. Six foreign keys and twelve indexes
went with them.

Two composite keys **narrowed** rather than vanished, and both got stricter:

| Was | Now | Note |
|---|---|---|
| `OrganizationMembership @@unique([personId, organizationId])` | `Membership.personId @unique` | The inherited pair already permitted exactly one row per person here — while implying to every reader that it did not |
| `RoleAssignment @@unique([personId, roleId, organizationId, unitId])` | `@@unique([personId, roleId, unitId])` | The NULLS-DISTINCT caveat is unchanged and still needs the application-layer diff on organisation-wide grants; only the constant component left |

`Role.organizationId` carried a real distinction — `null` = a seeded global
role, set = an organisation's own custom role. The **useful half survives in
`isSystem`**, which already separated "seeded" from "invented here"; what was
lost was only the ability to own a role somewhere other than here.

### 3.4 Multi-row `Organization` semantics

- **`slug`** and its unique index — subdomain tenant resolution. D-015 is
  withdrawn: each instance has its own domain, so there is nothing to resolve.
- **`status`** and the **`OrganizationStatus`** enum (`ACTIVE` / `SUSPENDED` /
  `ARCHIVED`) — suspending or archiving a *tenant* is a control-plane action and
  needs a principal above the organisation. There is neither. **This does remove
  a capability**: nothing can now soft-archive the organisation. Nothing could
  invoke it before either (no code read the column, and no principal existed to
  authorize it), and re-adding it is an additive column if a self-hoster ever
  wants "the club is dormant this season". Recorded here rather than silently
  dropped.
- **`id`** is no longer a cuid. It is pinned to the constant `organization`.

### 3.5 `PlatformSettings`

Merged into `Organization`, per D-056's own words — *"`PlatformSettings`
(merged into the organisation singleton)"* (`01-domain-model.md` §1.1.1). The
table is dropped; the merge migration carries its row across first.

The `Platform` prefix went with it, applying D-100's reasoning to the whole
namespace rather than to one model: leaving a single `Platform*` identifier
behind reintroduces exactly the namespace the extraction exists to remove.

| Was | Now |
|---|---|
| `PlatformSettings.displayName` | `Organization.name` |
| `PlatformSettings.platformConfig` | `Organization.config` |
| `PlatformSettings.updatedByPersonId` | `Organization.updatedByPersonId` |
| `PLATFORM_SETTINGS_ID = "platform"` | `ORGANIZATION_ID = "organization"` |
| `PlatformConfig`, `PLATFORM_CONFIG_VERSION` | `OrganizationConfig`, `ORGANIZATION_CONFIG_VERSION` |
| `defaultPlatformConfig`, `coercePlatformConfig`, `validatePlatformConfigInput` | `default…`, `coerce…`, `validateOrganizationConfigInput` |
| `getPublicPlatformConfig`, `writePlatformConfig`, `PublicPlatformSettings` | `getPublicOrganizationConfig`, `writeOrganizationConfig`, `PublicOrganizationSettings` |

`displayName` and `name` collapsed into one column deliberately. One
organisation means one name, and two columns holding it is two things to get out
of step. The brand-message injection now follows `Organization.name`.

---

## 4. The singleton, and why a constant was not enough

`ORGANIZATION_ID` constrains code that imports it. Nothing else. After phase 0.3
"there is exactly one organisation" is not a convention the code holds loosely —
it is the premise every removed `organizationId` column rests on, so it belongs
in the database.

```sql
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_singleton_check" CHECK ("id" = 'organization');
```

With the primary key on `id`, pinning `id` to one value means the table holds at
most one row. A second insert fails on the `CHECK` if it uses another id, and on
the primary key if it reuses this one.

`tests/integration/organization-singleton.test.ts` covers both, plus the path a
future author is most likely to take (`prisma.organization.create()` with no id,
which defaults to the constant and collides on the primary key).

**The suite was verified non-vacuous** rather than assumed to be: dropping the
constraint from the test database turned three of its four tests red.

```
$ psql -c 'ALTER TABLE "Organization" DROP CONSTRAINT "Organization_singleton_check";'
$ npx vitest run tests/integration/organization-singleton.test.ts
  × REFUSES a second organisation with a different id (CHECK constraint)
  × REFUSES a second organisation reusing the constant id (primary key)
  × REFUSES a second organisation created through the Prisma client
  Tests  3 failed | 1 passed (4)
```

The migration reconciles pre-existing rows *before* adding the constraint —
collapsing to the earliest row and renumbering it — so it is safe on a populated
database. That step is only safe because it runs one migration *after* every
`organizationId` foreign key was dropped; the ordering is deliberate.

---

## 5. What was kept, and why

| Kept | Why |
|---|---|
| `Person` / `UserAccount`, Better Auth wiring, TOTP MFA, passkeys, sessions | Named as reusable in D-056 and untouched by tenancy |
| The audit chain, its advisory-locked append and `verifyAuditChain` | Reusable. Only the tenant column left — §3.1 |
| The settings **read** paths, the config validators, the fail-safe-to-strict session-policy read | Reusable; re-homed onto `Organization`, not deleted. `getRequestConfigData` still runs on every request and still falls back to the strictest bounds |
| The test harness, the person-reference registry and its sync test, the migration-safety test, i18n | Reusable, and the registry sync test actively caught two stale entries during this phase — which is what it is for |
| `OrganizationUnit`, including `parentId`/`path`/`depth` | **Not tenant machinery.** It is the *within*-organisation partition the scope model scopes against (`03-deployment-model.md` §1.3). Its `PHASE 0.4` marker — `UNIT` is flat in v1, do not let the tree columns talk `resolveReach` into a descendant walk (D-121) — is unchanged |
| `ApiCredential` / `CredentialRoleAssignment` | `05-technical.md` §4 keeps them in place, unused. Only `organizationId` left. The 0.2 report's §8.2 question — keep the tables or drop them until an integration exists — is still open and still Jack's |
| `Membership.status` and the `MembershipStatus` enum | See §6 — flagged, not removed, because removing it is domain-model work |
| `Role`, `RoleAssignment`, `AccessGroup`, `Permission` and the join tables | The authorization *tables*. Only the tenant column left; the guard over them is phase 0.4 |

---

## 6. Re-homed, and deliberately not done

**Re-homed rather than deleted:**

- The whole settings capability — read paths, validators, the `SetNull`
  defence-in-depth on the last-editor pointer, and the erasure classification
  that goes with it — moved from `PlatformSettings` onto `Organization`.
- The "seeded versus custom role" distinction moved from `Role.organizationId`
  into `isSystem`.
- `PlatformSettings.displayName` (the brand name) moved into `Organization.name`.

**Named and deliberately left for the module that owns it:**

`Membership.status` **must go when the `people` module lands.** D-059 is
explicit that belonging is a set of `MembershipPeriod` intervals and *never* a
status flag, because a flag destroys the answer to "when were they a member?".
`MembershipStatus` is inherited, nothing in this repository reads or writes it,
and replacing it means adding `memberNumber` and `MembershipPeriod` — a
domain-model change, not a removal. It is recorded on the model itself, not only
here.

**Not built, per the constraint:** no crypto envelope, no `AuditCheckpoint` or
audit checkpointing, no `resolveReach` / `coversResource`, no retention or
erasure columns. Nothing half-implements one.

---

## 7. Every new marker

Markers mentioning phase 0.4 went from 30 occurrences to 32. Three are new; one
was reworded in place and is listed for completeness.

| File | Marker | Decision |
|---|---|---|
| `prisma/schema.prisma`, where `PlatformRoleAssignment` stood | `requirePermission` must resolve permissions from `RoleAssignment` **alone** — no second grant table, no bypass branch | D-147, D-130 |
| `prisma/schema.prisma`, `RoleAssignment` | Restates it at the table that is now the only grant table for a person | D-147 |
| `person-reference-classification.ts`, `Membership.personId` | The row's *retention* is a separate decision from its erasure category, and arrives with `MembershipPeriod` and the retention policy | D-053, D-059, D-065 |
| `src/lib/database/client.ts` | Reworded, not new: the `Reach` argument (D-031) and the per-module narrowed client (D-057) still do not exist, and until they do, importing this client from a domain module is a boundary violation waiting to happen | D-031, D-057 |

**Two new `PHASE 1:` markers**, both saying the same thing in the two places it
can be got wrong — the setup wizard (D-039) must **UPDATE** the organisation
singleton and must never read the row's *existence* as "already configured",
because the settings read path creates it lazily. The boot state machine reads
`InstallationBootstrap` (D-100) for that, and that model does not exist yet.

`src/app/api/ready/route.ts`'s existing `PHASE 1:` marker is unchanged.

---

## 8. The greps proving the absence

Run over `src tests scripts prisma/schema.prisma middleware.ts instrumentation.ts
vitest.config.ts playwright.config.ts next.config.ts eslint.config.mjs
prisma.config.ts package.json .env.example messages`, excluding the generated
Prisma client. Historical migration SQL is excluded on purpose: it is the record
of the removal, and rewriting it would be falsifying it.

**Platform roles, the platform namespace, the removed models.**

```
$ rg -n 'PlatformRoleAssignment|PlatformSettings|OrganizationStatus|platform\.super_admin|super_admin|superAdmin|requirePlatformPermission|platformRole' <source> --glob '!src/generated/**'
prisma/schema.prisma:30://   - `PlatformRoleAssignment` deleted. There is no platform-wide grant.
prisma/schema.prisma:34://   - `PlatformSettings` merged into `Organization`; `slug`, `status` and the
prisma/schema.prisma:35://     `OrganizationStatus` enum dropped; the singleton enforced by a CHECK
prisma/schema.prisma:111:/// `PlatformSettings` into it rather than keeping a platform-versus-organisation
prisma/schema.prisma:116:/// resolve) and `status` with its `OrganizationStatus` enum (suspending or
prisma/schema.prisma:131:  /// means one name, so the inherited `PlatformSettings.displayName` merges into
prisma/schema.prisma:643:/// THIS IS THE ONLY GRANT TABLE FOR A PERSON. `PlatformRoleAssignment` is gone
prisma/schema.prisma:672:// `PlatformRoleAssignment` STOOD HERE AND IS GONE (phase 0.3, D-056).
prisma/schema.prisma:675:// `platform.super_admin`. There is no platform in SplashTrack and therefore no
prisma/schema.prisma:736:/// `PlatformRoleAssignment`, not nullable-polymorphism on `RoleAssignment`.
src/lib/settings/settings.ts:6: * `PlatformSettings` table into `Organization` (D-056): one organisation per
src/lib/settings/settings.ts:12: * `requirePlatformPermission` — the platform super-administrator exception path,
tests/unit/prisma-schema-parser.ts:13: * template's `PlatformSettings` had a hex-colour regex `{6}`, and that model is
tests/unit/prisma-schema-parser.test.ts:12: * example in `AuditEvent`; the template's `PlatformSettings` had a hex-colour
src/modules/users/infrastructure/person-reference-classification.ts:100:      "PlatformSettings into it. The FK " +
```

Fifteen hits, **every one of them a comment saying the thing is gone**. No
declaration, no import, no call.

**Tenant columns and the scoping extension.**

```
$ rg -n 'organizationId|organisationId|tenantId|forOrganization|ORG_SCOPED' <source> --glob '!src/generated/**'
prisma/schema.prisma:31://   - `AuditEvent.organizationId` dropped, with the two indexes over it.
prisma/schema.prisma:32://   - Every remaining `organizationId` column, foreign key and index dropped.
prisma/schema.prisma:529:  /// `organizationId` — null for a global role, set for an org-owned custom one
tests/integration/organization-singleton.test.ts:10: * tenant boundary on that basis — every `organizationId` column, every
tests/unit/audit-hash.test.ts:102:    // The array LOST `organizationId` (it sat between "session" and "person")
src/modules/audit/domain/audit-event.ts:124: * MAY EVER HAPPEN. It carried `organizationId` in position 6 — the tenant scope
src/lib/database/index.ts:8: * The template's `organization-scope.ts` (`forOrganization` / `forPrincipal` /
src/lib/database/index.ts:9: * `ORG_SCOPED_MODELS`) was never extracted, and phase 0.3 has now removed the
```

Eight hits, all comments. `tests/unit/prisma-schema-parser.test.ts` used
`organizationId` as an arbitrary field name in a synthetic string fixture; it was
renamed to `lastFieldInTheBlock` so this grep has no false positive to explain,
and the fixture is now independent of any real schema — which it should have been
anyway.

**The renamed model and the platform config identifiers.**

```
$ rg -n 'OrganizationMembership|platformConfig|PlatformConfig|PLATFORM_' <source> --glob '!src/generated/**'
prisma/schema.prisma:33://   - `OrganizationMembership` renamed to `Membership`.
prisma/schema.prisma:467:// Membership — renamed from `OrganizationMembership` in phase 0.3 (D-056)
```

**Every code path that touches the organisation table.** Three in production,
all keyed on the constant; no `findMany` and no `findFirst`:

```
$ rg -n 'prisma\.organization' src tests --glob '!src/generated/**'
src/lib/settings/settings.ts:73:  return prisma.organization.upsert({          # where: { id: ORGANIZATION_ID }
src/lib/settings/settings.ts:134:      const row = await prisma.organization.findUnique({   # where: { id: ORGANIZATION_ID }
src/lib/settings/settings.ts:209:  const updated = await prisma.organization.update({   # where: { id: ORGANIZATION_ID }
tests/integration/organization-singleton.test.ts:40,56,68,76,79            # the singleton suite
```

**Model count.** 23 → 21: `PlatformRoleAssignment` deleted, `PlatformSettings`
merged away. 22 tables in the database, including `_prisma_migrations`.

---

## 9. Done-checks — real output

### 9.1 `npx prisma validate`

```
$ npx prisma validate
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀
```

**PASS.**

### 9.2 `npx tsc --noEmit`, `npm run lint`, `npx prettier --check .`

```
$ npx tsc --noEmit
exit=0

$ npm run lint
> splashtrack@0.1.0 lint
> eslint
exit=0

$ npx prettier --check .
Checking formatting...
All matched files use Prettier code style!
```

**PASS** — all three.

### 9.3 `prisma migrate deploy` against an EMPTY database

The database was dropped and recreated first, so this is the whole chain from
nothing, not an incremental top-up.

```
$ docker compose up -d postgres
 Container splashtrack-postgres-1 Running

$ psql -c 'DROP DATABASE IF EXISTS splashtrack WITH (FORCE);' -c 'CREATE DATABASE splashtrack;'
DROP DATABASE
CREATE DATABASE

$ npx prisma migrate deploy
Applying migration `20260902230852_foundation_identity_authorization_settings_audit`
Applying migration `20260903044536_remove_platform_role_assignment`
Applying migration `20260903044636_remove_audit_event_organization_scope`
Applying migration `20260903064952_remove_organization_scoping_columns`
Applying migration `20260903065203_rename_organization_membership_to_membership`
Applying migration `20260903065629_merge_platform_settings_into_organization_singleton`

All migrations have been successfully applied.
```

And the constraint is really there, on a database built only from the migration
chain:

```
$ psql -c "SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema='public';"
 tables
--------
     22

$ psql -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
           WHERE conrelid='\"Organization\"'::regclass AND contype='c';"
           conname            |        pg_get_constraintdef
------------------------------+-------------------------------------
 Organization_singleton_check | CHECK ((id = 'organization'::text))
```

**PASS.**

### 9.4 `npm test`

```
$ npm test
[setup-test-db] Applying migrations to "splashtrack_test"...
[setup-test-db] Reset the audit trail (TRUNCATE "AuditEvent").
[setup-test-db] Test database ready.

 RUN  v4.1.11 /root/projects/SplashTrack

 Test Files  8 passed (8)
      Tests  32 passed (32)
   Duration  3.59s
```

**PASS.** 28 → 32: the four new tests are the singleton suite, all of them
against a real Postgres.

The `vitest.config.ts` ESM-in-CommonJS deprecation warning inherited from the
template still fires on every run. Cosmetic, unchanged, still not mixed into
somebody else's pass.

### 9.5 `npm run build`

```
$ npm run build
▲ Next.js 16.3.4 (Turbopack)
✓ Compiled successfully
  Running TypeScript ...
✓ Generating static pages using 5 workers (5/5) in 337ms

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/[...all]
├ ƒ /api/health
└ ƒ /api/ready

ƒ Proxy (Middleware)
```

**PASS.**

### 9.6 What I did NOT run

- **Playwright.** Unchanged from 0.2: there are no specs, and this phase added
  no UI.
- **The CI workflows.** Outside my write scope (D-025, F-18), and still carrying
  the 0.2 report's §7 problems.

---

## 10. Open — one question, and one thing that is still Jack's

### 10.1 `Membership.status` (§6) — a decision the `people` module must take

Not a blocker for this phase and not a guess I am willing to make silently: the
inherited `status` flag is the shape D-059 forbids, but replacing it means
building `MembershipPeriod`, which is the `people` module's work. It is marked
on the model. Flagging it here so it is a decision rather than an oversight
somebody finds later.

### 10.2 `ApiCredential` — still open from 0.2 §8.2

Phase 0.3 has now done the reshaping that question anticipated (`organizationId`
dropped). Two tables no line of code touches remain. Keeping them costs nothing
further; dropping them costs re-adding two models when an integration exists,
which D-163/OD-19 say will not be in v1 at all. Unchanged recommendation: follow
the design and keep them, unless "stay in place" meant the code path rather than
the tables.
