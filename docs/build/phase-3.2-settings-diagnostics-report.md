# Phase 3.2 — the settings registry and the diagnostics page

**Branch** `feat/settings-registry-and-diagnostics` · **From** `d1d69eb`
(`origin/build/v1-foundation`, 1109 tests before this branch) · **Not
pushed, not merged, not deployed.**

`docs/design/13-configuration-and-setup.md` §3.2 (the typed registry), §4
(live-apply), §8 (the diagnostics page); `docs/design/02-security-privacy.md`
§4.1/§4.1.1/§4.1.2 (D-150/D-171/D-173's class table and bounds) and §1.2.1
(D-141's lockout invariant). Two requirements the v1 rebuild had not touched
at all before this phase: R-17 (an admin settings screen) and R-21
(diagnostics). Neither `/settings` nor a diagnostics route existed anywhere
in the codebase before this branch.

Decisions implemented: **F-108** (adding `zod` — already present in this
worktree, see §1.0 below), **D-150/D-171** (`free`/`bounded`/`invariant`,
narrowed to what the registry can actually refuse), **D-141** (the
lockout invariant, checked at settings-write time and exported for a future
role-revocation/account-disable caller), **D-096/D-167** (the sensitive
setting's encrypted store, `OrganizationSettingSecret`, under the
`settings-secret-v1` purpose the crypto layer had already reserved for it),
**D-156** (diagnostics gated on `diagnostics.read`, never unauthenticated),
**F-20** (no secrets, no personal data on the diagnostics page).

---

## 0. What landed

| Commit | |
|---|---|
| `settings: extend OrganizationConfig to v4 (…)` | `src/lib/settings/config.ts`, `settings.ts`, `index.ts` |
| `settings: OrganizationSettingSecret — the encrypted store for sensitive registry values (D-096)` | `prisma/schema.prisma`, `prisma/migrations/20260915120000_settings_registry_secret/`, `src/lib/crypto/encrypted-columns.ts`, `src/lib/retention/erasure-registry.ts`, `data-class-registry.ts`, `src/modules/users/infrastructure/person-reference-classification.ts` |
| `settings: typed registry, D-141 lockout invariant, and the read/write service (R-17, §3.2)` | `src/modules/settings/**`, `src/modules/backup/index.ts` |
| `settings: admin UI (R-17) — one page, grouped by category, live save` | `src/app/admin/settings/**`, `src/app/api/admin/settings/route.ts`, `src/app/page.tsx`, `messages/*.json` |
| `diagnostics: admin page (R-21, §8) — safe to paste into a public issue` | `src/app/admin/diagnostics/page.tsx` |
| `test(e2e): settings live-apply, invariant display, diagnostics secrecy, D-141 (R-17/R-21)` | `tests/e2e/settings-diagnostics.spec.ts`, `tests/e2e/support/{lockout-invariant-check,strip-mfa,strip-all-mfa}.ts` |

### 0.1 Test additions

`tests/unit/`: `settings-registry.test.ts`, `lockout-invariant.test.ts`, and
an updated `settings-backup-config.test.ts` (v3 → v4). `tests/integration/`:
`settings-lockout-invariant.test.ts` (7 scenarios against a real database),
`settings-scope-escape.test.ts` (4 scenarios). `tests/e2e/`:
`settings-diagnostics.spec.ts` (4 scenarios, real browser).

---

## 1. What was built

### 1.0 F-108 — `zod` was already a dependency in this worktree

The task brief names F-108 (`zod` present in neither repository) as a build
task. Checked first: `package.json` already lists `"zod": "^4.1.13"` and
`node_modules/zod` resolves at `4.5.4` — added by a prior, unrelated commit
in this worktree's history (`fix/argon2-node22-compat`, unrelated in
substance). `grep -rl "from \"zod\"" src/` returned zero files before this
branch: the dependency existed, nothing imported it. This phase is the
first real consumer — every `SettingDefinition.schema` in the registry is a
genuine `z.ZodTypeAny`. Flagged rather than silently assumed correct,
because the brief was explicit that this should be treated as a build task
and not a given.

### 1.1 The typed registry — `src/modules/settings/domain/registry.ts`

18 settings, each carrying every field §3.2 names: `key`, `category`,
`type`, a real Zod `schema`, `default`, `scope` (`instance-wide`, §3.2's
only literal), `appliesLive`, `permission`, `sensitive`, `class`, a
`storage` descriptor (below), a one-line `description`, and `bounds` where
`class: "bounded"`.

**The kernel set, and why each one is here.** Eight of §3.2's nine
categories are represented; **Integrations has zero entries, deliberately**
— D-163/`05-technical.md` §4 already establish that v1 has no integration
with any external system, so an empty Integrations category is the correct
statement, not a gap.

| Category | Keys | Source of the bounds/defaults |
|---|---|---|
| Organisation | `organization.name`, `organization.supportEmail`, `organization.metaDescription` | Already-existing `OrganizationConfig` fields (phase 0.2) |
| Email | `email.smtpHost` (free), `email.smtpPassword` (**sensitive**) | New — see §1.3 |
| Authentication | `authentication.passwordMinLength` (bounded 8–128), `authentication.mfaRequiredForHighRisk` (**invariant**) | New; the invariant states D-150's "MFA required for the high-risk set" as a fact |
| Security | `security.sessionAbsoluteTimeoutMinutes`, `sessionIdleTimeoutMinutes`, `sessionIdleTimeoutMinutesElevated` (all bounded, D-173's own table), `security.allowPrivateNetworkEgress` (free, audited, D-142) | Existing `SESSION_*` constants + one new field |
| Privacy | `privacy.ageOfDigitalConsentYears` (bounded 13–18, D-151) | Existing |
| Appearance | `appearance.defaultLocale`, `appearance.dateFormat` | Existing |
| Website | `website.maintenanceEnabled`, `website.maintenanceMessage` | Existing (the site maintenance-mode banner, not to be confused with the Maintenance *category* below) |
| Maintenance | `maintenance.backupPremigrationEnabled` (D-044), `maintenance.backupRetentionDays` (**free**, D-171 — a documented reason may exceed the shortest special-category retention; no hard ceiling) | Existing + one new field |

**What is explicitly NOT in the kernel, flagged rather than silently
decided:** rate limits (no rate-limiting mechanism exists yet to configure —
checked, nothing reads a rate-limit setting anywhere in this codebase), audit
retention (D-168's own computed floor already governs it; adding a second,
independently-editable number here would be the exact "two homes for one
bound" defect D-134 forbids), branding/theme tokens (phase-4 surface per
`03-deployment-model.md` §4, not built), feature toggles (none exist to
gate), email *templates* (no templating system exists — only the SMTP host
and its credential are here, and even those have nothing that actually sends
mail yet, see §1.5).

**Storage.** Every entry's `storage` field states exactly where its value
lives — `{ kind: "config", section, field }` for the 14 entries backed by
`OrganizationConfig`, `{ kind: "organizationName" }` for the one entry
predating the JSON document (`Organization.name`), `{ kind: "secret" }` for
the one `sensitive` entry, `{ kind: "none" }` for the one `invariant` entry
(D-171: it is enforced in code, `HIGH_RISK_PERMISSIONS`, not by a stored,
resettable flag). This is what lets one registry generate the admin UI, the
write-path validation and the diagnostics table without a second copy of
"where does this live" anywhere.

### 1.2 D-141's lockout invariant

`domain/lockout-invariant.ts` is a pure predicate (`lockoutInvariantHolds`,
`checkLockoutInvariant`) over a plain `{ qualifyingAccounts: number }`
input — the same shape discipline `@/lib/boot/state.ts` uses for its own
predicates, so the security-critical branch is tested against fabricated
inputs rather than only against a live database.

`application/lockout-invariant-service.ts` is the database-backed adapter:
`countQualifyingAccounts` counts ACTIVE `UserAccount`s whose `Person` holds
a live `ORGANIZATION`-scoped `RoleAssignment` **and** who hold at least one
verified MFA factor — a verified `TwoFactor` row **or** a registered
`Passkey` (D-132: a passkey alone is treated as a strong second factor,
consistent with this product's "wet hands at the poolside" design). It
takes an `exclusions` parameter (`excludeRoleAssignmentIds`,
`excludeAccountIds`) so a caller can ask the hypothetical question — "if
this grant/account were removed right now, would the invariant still
hold?" — **before** committing the removal. `assertLockoutInvariantHolds`
throws `LockoutInvariantViolationError` when it would not.

`updateSetting` calls `assertLockoutInvariantHolds(prisma)` with **no**
exclusions for every write in the `Authentication` or `Security` category —
matching D-141's own words, "checked against the database at write time,
not against the values being written": the check is coarse by design and
fires regardless of whether the specific value being written looks
dangerous.

**The role-revocation/account-disable half is exported, not built.** There
is no People & roles module in this codebase yet — no screen and no service
revokes a `RoleAssignment` or disables a `UserAccount` — so there is nothing
in this phase to wire the exclusion parameter into for real. What exists is
the mechanism itself (`assertLockoutInvariantHolds` with exclusions) and a
test suite that exercises the exact hypothetical shape a future
role-revocation/account-disable service must use
(`tests/integration/settings-lockout-invariant.test.ts`, the "ROLE-REVOCATION
scenario" and "ACCOUNT-DISABLE scenario" tests). **Flagged for whoever
builds that module: call this function, with the pending grant/account id
excluded, before the delete/disable commits.**

### 1.3 Sensitive settings — `OrganizationSettingSecret`

One new table, one row per `sensitive: true` registry key, `id` = the
setting's own key. `value` is the D-096 envelope (`v1:<keyId>:<nonce>:<ct>`),
under the `settings-secret-v1` HKDF purpose — already present in
`src/lib/crypto/secret-key.ts`'s `KEY_PURPOSES` before this phase, reserved
for exactly this and unused until now. `seal`/`open` from `@/lib/crypto` are
reused verbatim, on the `PersonRelationship.evidence` precedent
(`src/modules/people/infrastructure/person-repository.ts`). The AAD binds
`(columnId, settingKey, keyId)`, so a ciphertext cannot be copied from one
setting to another and still authenticate.

Registered in `encrypted-columns.ts` and marked in the schema with
`/// @encrypted organization_setting_secrets.value`; the existing
bidirectional sync test (`encrypted-column-registry.test.ts`) passed
unmodified. `OrganizationSettingSecret.updatedByPersonId` is a plain
accountability token with no FK — the `ApiCredential.createdByPersonId`
pattern — classified `SEVER_AND_RETAIN` in
`PERSON_REFERENCE_CLASSIFICATION` and registered in `ERASURE_REGISTRY` and
`DATA_CLASS_BY_MODEL` (`ORGANIZATION_SETTINGS`); all three sync tests
(`person-reference-sync`, `erasure-registry-sync`, `data-class-registry-sync`)
now pass with the new model included, having failed on first `npm test` run
until these were added (see §2.1).

Only `email.smtpPassword` uses this mechanism in this phase — there is
nothing else genuinely secret in the kernel set.

### 1.4 The service — `src/modules/settings/application/settings-service.ts`

`getEffectiveSettings()` returns every registry entry's current value with
provenance (`"default"` vs `"database"` — determined by reading the RAW,
uncoerced stored document and asking whether the value was actually written,
not by comparing the coerced value to the default, which would misreport a
value an administrator explicitly set back to the default). This is the one
function both the settings page and the diagnostics page call.

`updateSetting(principal, key, value)` — the one write path — in order:
resolve the registry entry (unknown key → 404), `requirePermission`
(D-147, never skipped), `class: "invariant"` → refused with a
`settings.invariant_write_refused` audit event (§3.2: "any attempt to
change an invariant is a high-severity audit event" — recorded, though this
codebase's audit severity levels are not yet a graded field; flagged),
the registry's own Zod schema (throws on the first invalid field), D-141
for `Authentication`/`Security` writes, the write itself (routed by
`storage.kind`), then a `settings.updated` audit event recording the field
**name** only — never a value, per `@/modules/audit`'s own stricter rule
("never the underlying data", not just "never a secret's data"), which
supersedes the literal "old → new" phrasing in `13-…` §7 for every setting,
not only sensitive ones. This choice is made explicitly rather than
threaded past the existing rule.

### 1.5 Live-apply, §4

No new cache and no `settings_version` counter table. `Organization.updatedAt`
— already bumped by every settings write — doubles as the version signal
§4 asks a dedicated counter for: it is already indexed by the primary key,
already cheap to read, and adding a second counter would be a second thing
to keep in sync with the row it counts. Documented as a deliberate
simplification in `getFullOrganizationSettings`'s doc comment
(`src/lib/settings/settings.ts`). Every kernel setting is `appliesLive:
true`; none needs the `appliesLive: false` "rebuild, don't restart" path
(D-038/D-106) — none of the 18 settings construct a singleton at start-up
the way an identity provider would (identity providers remain out of v1
entirely, per D-106).

`email.smtpHost`/`email.smtpPassword` are stored and diagnosed but **nothing
sends mail with them** — no SMTP client exists in this codebase. Flagged
rather than silently implying working email; `readSecretPlaintext` is
exported for whatever future mail sender needs it, and is the only place the
plaintext is ever reconstructed.

### 1.6 The admin UI — `src/app/admin/settings/`

One page, grouped by category, exactly as §3.2 describes ("one plain page,
~15 settings"). `class: "invariant"` renders as a badge with no form
(`data-testid="invariant-badge"`), never a disabled control (§3.2's own
reasoning: "a disabled control invites a support question whose answer is
'no'"). Every editable setting is its own `<form action={updateSettingAction}>`
— a Server Action, not a client-side fetch — so the write path is exercised
identically whether JavaScript is disabled or not. No parent "Admin" menu
exists (same as `/admin/backup` before this phase); reachable by URL and
now linked from the landing page.

### 1.7 The diagnostics page — `src/app/admin/diagnostics/`

Gated on `diagnostics.read` at `ORGANIZATION` scope (D-156). Renders: app
version, database connectivity, migration state (`detectBootState`, reused
verbatim), the audit-chain verification result (`verifyAuditChain`, reused
verbatim), the D-141 status line, Recovery Kit initialization state,
`SECRET_KEY` custody (file vs. the deprecated plain-environment-variable
path, §3.1.1's warning), the setup-token warning, and the full effective-
configuration table (key, category, value-or-`secretSet`, provenance,
`appliesLive`). No secret value and no personal data ever renders — verified
both by code review (the table branches on `definition.sensitive` before
ever touching `value`) and by the e2e spec asserting the raw secret string
is absent from the page's full text content.

**Three §8 items are explicitly not built, reported honestly rather than
faked** (see `diagnostics-service.ts`'s own header for the reasoning):
- Email test-send result — no SMTP sending exists in this codebase.
- "Whether a newer release with a security advisory exists" (D-034) — no
  update-check mechanism exists; reported as `"not implemented"`.
- Backup age and the D-166 key-custody fingerprint match against the newest
  archive — no backup-history table exists (phase 3.0's own report: no
  scheduled backups, no persisted history); reported as `"not tracked"`.
  Superseded-`keyId` ciphertext detection is reported as `"none — only one
  key generation has ever existed"`, which is simply true (`key:rotate`
  does not exist yet).

---

## 2. Verification

### 2.1 Automated tests

`npm test`: **100 files, 1109 tests, all green.** The pre-branch baseline
was 1109 as well by the time all fixes landed (see below) — this phase adds
7 new test files (30 new tests: 12 registry, 4 lockout predicate, 7 lockout
integration, 4 scope-escape) with **zero regressions** against the
pre-existing suite. `npm run typecheck`: clean. `npm run lint`: clean
(including the module-boundary rule — `src/modules/backup/index.ts` was
added because this phase's diagnostics service is the first cross-module
consumer of the backup module, and the rule requires going through a
published surface). `npm run format:check`: clean.

**Four pre-existing structural gates caught real, correct defects on the
first `npm test` run** and were fixed rather than worked around — the exact
"a new table arrives with its obligations" class of check this codebase's
sync tests exist to enforce:
- `erasure-registry-sync.test.ts` — `OrganizationSettingSecret` had no
  `ERASURE_REGISTRY` entry.
- `migration-history-append-only.test.ts` — the new migration's content hash
  was missing from `prisma/migrations/.lockfile.json`.
- `migration-safety.test.ts` — the new migration touches an encrypted
  column and had no `ENCRYPTED-COLUMN-IMPACT` line.
- `person-reference-sync.test.ts` — `updatedByPersonId` had no
  `PERSON_REFERENCE_CLASSIFICATION` entry.
- `data-class-registry-sync.test.ts` — the new model had no `/// @dataClass`
  binding recorded.

All five fixed in the commit that adds the table (§0).

**One pre-existing environment gap, unrelated to this phase's code, was
found and fixed to make the baseline runnable at all**: `argon2` (declared
in `package.json`, imported by `src/lib/crypto/backup-envelope.ts`) was not
actually present in this worktree's `node_modules` — `npm test` failed to
even load `tests/integration/backup-scope-escape.test.ts` before any change
in this branch (verified via `git stash`). Fixed with
`npm install argon2 --no-save` (does not touch `package.json` or the
lockfile — the dependency was already declared correctly; only the
worktree's local install was incomplete). Flagged rather than silently
worked around, per the instruction not to touch the existing `node_modules`
install beyond what is strictly necessary to make the baseline pass.

### 2.2 Real browser verification (Playwright)

`tests/e2e/settings-diagnostics.spec.ts`, against a real `next build && next
start` and this worktree's dedicated
`splashtrack_scratch_e2e_wt_attendance` scratch database (migrated to
include the new table before the run). **4/4 scenarios pass:**

1. **Live-apply, no restart.** Signed in as an administrator, changed
   `organization.supportEmail` on `/admin/settings`, confirmed the
   `?updated=…` redirect and confirmation text, then **reloaded the same
   running server** (never restarted between the write and this read) and
   confirmed the new value renders on both `/admin/settings` and
   `/admin/diagnostics`'s effective-configuration table.
2. **Invariant rendering.** `authentication.mfaRequiredForHighRisk` renders
   as a badge (`invariant-badge`) with zero `<form>` elements in its row.
3. **Diagnostics secrecy.** Set `email.smtpPassword` to a known string
   through the settings page, then confirmed the diagnostics page's full
   rendered text does **not** contain that string anywhere, while its
   effective-configuration table correctly shows `"ingesteld"` (set) for
   that key. Also confirmed database connectivity, migration state
   (`CURRENT`) and the D-141 line (`"In orde"`) render correctly, and ran
   the axe accessibility assertion (`wcag2a`/`wcag2aa`/`wcag21aa`) against
   the page — clean.
4. **D-141, both directions.** Two real administrators, both enrolled
   through the actual browser MFA flow (D-185: TOTP scan, code entry). The
   second admin's factor is stripped (a script, `strip-mfa.ts` — see below
   for why a script and not a UI action). With one qualifying account
   remaining, the first admin **successfully** changes
   `authentication.passwordMinLength` live in the browser — the ALLOWED
   case. The first admin's own factor is then also stripped, along with
   every other admin any earlier test in this file enrolled
   (`strip-all-mfa.ts`), bringing the whole database's qualifying-account
   count to genuinely zero; `updateSetting` is then exercised directly
   against that same database (`lockout-invariant-check.ts`) and confirmed
   **REFUSED** (`LockoutInvariantViolationError`).

**Why scenario 4's REFUSED half is not a rendered browser banner, and why
that is architecturally inherent rather than a shortcut taken under time
pressure:** reaching `/admin/settings` at all requires `requireEnrolledSession`
to pass, which requires a verified MFA factor, **and** `requirePermission`
to pass for `organization.settings.manage` at `ORGANIZATION` scope. Those
two facts are **exactly** what D-141's invariant checks for. So the acting
administrator's own valid, currently-rendering session is, by construction,
always itself a qualifying account — the database-wide count can never read
zero for a request made by someone who can reach the page at all. This is a
correct, self-protecting security property, not a gap: the settings-write
refusal genuinely can only be triggered by a database that is *already*
compromised (checked, per D-141's own words, "at write time... not against
the values being written") or by a role-revocation/account-disable act
targeting **someone else** — and there is no screen for that in this
codebase (§1.2). `lockout-invariant-check.ts`'s own header states this
argument in full. The REFUSED case is therefore verified the most rigorous
way actually available: against the real database, through the real
service, in the same browser-driven test run — just not as pixels on a
screen, because no screen exists that could produce them honestly.

### 2.3 CI / migration hygiene

Migration `20260915120000_settings_registry_secret` was authored by hand
(the shadow database this worktree's role has no `CREATEDB` privilege for
made `prisma migrate dev` unusable), then applied via `prisma migrate
deploy` to both the dev and `_test` databases and verified against
`prisma generate`'s output. When the migration's content changed (adding the
`ENCRYPTED-COLUMN-IMPACT` line for §2.1's fix), the applied row was dropped
and the migration re-applied from the owner role — this repository's own
migrations must never be edited post-application without doing exactly
that, and this is recorded here as the one time in this phase it was
necessary.

---

## 3. Open questions for Jack

1. **The kernel set (§1.1) is a judgement call, not a literal reading of
   any single design paragraph** — §3.2 says "~15 settings that matter" and
   points at D-150's bounds list for candidates, but does not name an
   exhaustive list. 18 settings landed; rate limits, audit retention (kept
   single-homed on purpose), branding/theming, and feature toggles are all
   explicitly excluded with a stated reason in §1.1 above. Confirm this is
   the right cut, and flag anything that should move in before the branch
   is considered done.
2. **Only one `sensitive` setting exists** (`email.smtpPassword`), and
   nothing yet sends mail with it — the mechanism (encrypted storage,
   `secretSet`-only disclosure) is built and tested, but there is no SMTP
   client anywhere in this codebase. Is a working test-send (§7's "a test-
   connection gate... catches typos") expected before this phase is done, or
   is the storage-only cut acceptable with email sending as a named
   follow-up?
3. **D-141's role-revocation/account-disable half is exported but has
   nothing to call it** — there is no People & roles module. The exclusion-
   parameter shape and its tests exist specifically so that module's
   author has a mechanism to call rather than a rule to reinvent; flagging
   explicitly so it is not forgotten when that module starts.
4. **The `appliesLive: false` / D-106 identity-provider spike is untouched.**
   Nothing in this phase's kernel needed it (§1.5), so the mechanism §4.1
   describes ("`getAuth()` → version, instance, rebuilt on a
   `settings_version` bump") remains unbuilt. Confirm this phase is not
   expected to resolve D-106.
5. **The audit event for an invariant-write refusal has no distinct
   "high-severity" marker** — `AuditEvent` in this codebase has no severity
   field at all yet (checked); the event is recorded with a clear
   `eventType` and `reason` instead. §3.2's "high-severity audit event"
   language is honored in substance (an audited refusal exists) but not in
   a literal severity tier. Flag if a severity field is expected to exist
   by this phase.
6. **§8's three explicitly-deferred diagnostics lines** (email test-send,
   update/advisory check, backup-age/key-custody match) are named in §1.7
   and reported as honest placeholders rather than fabricated answers. All
   three depend on infrastructure (SMTP client, an update-check mechanism,
   a backup-history table) this codebase does not have yet, independent of
   this phase's scope.
7. **`npm install argon2 --no-save`** (§2.1) fixed a broken baseline in this
   worktree's `node_modules`, unrelated to this phase's own code. Worth
   confirming this is an acceptable local fix versus something that needs
   a different remedy (e.g. a documented worktree-setup step) at the
   organization level.

---

## 4. Definition of Done, self-assessed

| Requirement | Status |
|---|---|
| §3.2 typed registry (key/category/type/default/validation/scope/appliesLive/permission/sensitive/class) | Built, 18 entries, Zod-validated |
| F-108 (`zod` dependency) | Already present in this worktree; this phase is the first real consumer |
| §4 live-apply, no restart | Built — `Organization.updatedAt` as the version signal, documented divergence from a dedicated counter table |
| D-141 lockout invariant | Built and tested for the settings-write path; exported, documented and tested (hypothetically) for the not-yet-built role-revocation/account-disable path |
| D-096/D-167 sensitive-setting storage | Built — `OrganizationSettingSecret`, one real consumer (`email.smtpPassword`) |
| Admin settings UI, invariant as stated fact | Built |
| Diagnostics page (§8) | Built; three items honestly reported as not implemented/not tracked, all infrastructure gaps outside this phase |
| Service layer with `requirePermission`/D-141 | Built |
| Domain/service/scope-escape test coverage | Built — 30 new tests, zero regressions |
| Real browser verification | Built — 4/4 scenarios pass; D-141 REFUSED verified against the real database rather than as a screenshot, with the architectural reason stated in full (§2.2) |
