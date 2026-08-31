I've completed the review. Both repos were read only; nothing was modified.

---

# SplashTrack design review — buildability lens

**Verdict:** the design is unusually well-reasoned and internally honest about trade-offs, but it is **not yet buildable**. Three of its load-bearing mechanisms (the settings registry, the scoped authorization model, the boot state machine) do not exist in the reference repo and are described as if inherited; one of them (live-applied identity providers) is asserted against a template capability whose own source comment says the opposite. Below: 7 blockers, 10 majors, 10 minors, a build order, and the OD-1 analysis.

Everything in "verify claims" was checked against files, not assumed.

---

## 1. BLOCKERS

### B-1 — `SECRET_KEY` does not exist, and its relationship to the auth secret is undecided
`13-configuration-and-setup.md` §3.1/§5, `14-…` §2 (D-040), `03-…` §1.2

The template has no `SECRET_KEY`. At-rest secret encryption derives its key from **`BETTER_AUTH_SECRET`** via HKDF-SHA256 with a per-module `info` label (`src/modules/identity/infrastructure/secret-crypto.ts`, and a twin in `notifications`). `.env.example` confirms `BETTER_AUTH_SECRET` also **signs sessions and encrypts 2FA secrets**.

**Day-one blocker:** is `SECRET_KEY` a new variable, or `BETTER_AUTH_SECRET` renamed?
- If the same: the Recovery Kit prints the session-signing key on paper (D-040). A printed artefact that forges admin sessions.
- If different: restoring a backup supplies `SECRET_KEY` but the fresh container has a *new* `BETTER_AUTH_SECRET` — every TOTP enrolment and every Better Auth-encrypted value in the restored dump is silently dead, and MFA is mandatory for admins (R-13). The Recovery Kit fails at exactly the moment it exists for.

Compounding it, `03-…` §1.2 tells a third story: "Secrets are generated on first run and **written to the data volume**" — which makes restore onto a fresh volume undecryptable by construction.

**Resolution I would adopt:** one bootstrap variable, `SECRET_KEY`, as the data-encryption root. Derive the Better Auth signing secret from it deterministically — `HKDF(SECRET_KEY, info="auth-signing-v1")` — so it is reproduced identically on restore and is not a separate variable. All application envelopes use `HKDF(SECRET_KEY, info=<purpose>)` with the purpose recorded in the envelope. Delete the data-volume sentence from `03-…` §1.2. Document that the recovery token is **session-forging material**, so its re-display path (F-24) gets the same treatment as the backup download (D-042): step-up, rate limit, high-severity audit.

### B-2 — The identity-provider registry cannot be live-applied; the design's worked example is factually inverted
`13-…` §4 (D-038), `02-…` §1.2.1 (D-035)

The design says: *"`WebAppTemplate` already loads Entra configuration at auth-context init, so changing a provider rebuilds the auth context rather than the container."*

The template's own comment, `src/lib/auth/auth.ts:507-509`:
> "Entra sign-in (`entraLoginConfig`), **which is read once at auth-context construction and so only applies on the next restart/redeploy**."

`export const auth = betterAuth({...})` (line 617) is a module-level singleton. There is no rebuild mechanism, and Next.js runs several worker processes — one rebuilding its own singleton doesn't help the others.

I also checked the plugin the design bets on: `genericOAuth({ config: [...] })` takes a **static array at construction**, and the callback route is `/api/auth/callback/:providerId`, so provider ids must exist at init for routing to work. Adding a provider at runtime is not something the plugin does.

**Resolution:** replace `export const auth` with a versioned `getAuth()` holding `{version, instance}`; keep a `settings_version` counter row that every settings write bumps; each request (or each TTL window) compares its cached version against the DB and reconstructs the Better Auth instance when it moved. That gives cross-process invalidation via a cheap indexed read, with no IPC. **Spike this before D-038 is treated as decided** — add a genericOAuth provider through the DB and complete a sign-in without restarting. If the spike fails, amend D-038 to name identity providers as the one bounded exception, and say so in the UI.

### B-3 — The scoped authorization model is a new build presented as inherited
`02-…` §2 (D-030/D-031/D-054), R-14, `00-…` §2.1

Actual template state:
- `RoleAssignment(personId, roleId, organizationId, unitId?)` — **no `scopeType`, no `scopeId`**.
- `Reach` is `{kind:"whole_org"} | {kind:"units", units[]}` — **two kinds, not seven**.
- `requirePermission(session, permission, organizationId, opts)` takes an **organizationId, not a resourceRef**, and *returns* a reach rather than taking one.
- `resolveReach()` does not exist (`resolvePermissionReachForPerson` does, unit-only). No repository takes reach as a required argument.

So `GROUP`, `COURSE`, `EXAM_SESSION`, `SELF`, `RELATED` and the entire "resource-referenced" discipline are new, and they change the signature of the one guard every one of the 13 existing modules calls.

**Resolution:** don't rename — extend. Keep `unitId` (it works, it's tested, `UNIT` is the only tree-walking scope). Add `scopeType ScopeType @default(ORGANIZATION)` + `scopeId String?`, non-null for GROUP/COURSE/EXAM_SESSION only. Migrate add-nullable → backfill → set-not-null, which the template's own `tests/unit/migration-safety.test.ts` will otherwise fail you for. Change the guard to `requirePermission(session, perm, resourceRef)` with a tagged union, and implement `coversResource(grant, resourceRef)` as the single per-scope coverage function §2.2 promises. Budget it as its own milestone **before any domain module**.

### B-4 — The settings registry doesn't exist, and the template's settings model is structurally incompatible
`13-…` §3.2, R-17, D-036/037/038; contradicted by D-056

The template's settings are **five versioned JSON blobs** on the `PlatformSettings` singleton — `themeConfig`, `platformConfig`, `notificationConfig`, `profileFieldConfig`, `entraLoginConfig` — with hand-rolled validators in `src/lib/settings/config.ts` (31 KB) + `settings.ts` (18 KB), five bespoke admin screens, five permissions. There is no key/value registry, no `appliesLive`, no provenance, no per-setting old→new audit, no generator.

Meanwhile D-056 says `PlatformSettings` is *removed*, "merged into the organisation singleton". That is not a merge — it is where all configuration currently lives.

**Resolution:** new table `Setting(key @id, valueJson, isSecret, updatedByPersonId?, updatedAt)` plus a code-side `defineSetting()` registry validated on read *and* write. Port the five documents into keyed rows one PR at a time, existing screen kept working each time. **Do not build the UI generator in v1** — let the registry generate validation, diagnostics, the docs table and the audit record; keep admin screens hand-written. That preserves the load-bearing property (one definition per setting) without a metaprogramming project. Add the `settings_version` counter here — B-2 needs it too.

### B-5 — The boot state machine's states are not decidable from what's written
`13-…` §6 (D-055)

Each state needs a predicate and none is given:
- **EMPTY** = "no tables at all" — against a database where provisioning created an extension table? Zero tables in `search_path`, or absence of `_prisma_migrations`? They differ mid-restore.
- **PARTIAL** = "tables, no bootstrap record". But an operator who deletes the `PlatformBootstrap` row on a live install lands here, and the wizard would offer "New installation" — running `seed` over live children's records. Nothing refuses that.
- **AHEAD** needs a test the design never names.
- `migrate status` exit codes are not stable API.
- **There is a sixth state the design doesn't have.** `13-…` §5 claims "if a migration fails… the database is left at its pre-migration state". Not true with Prisma: the failed migration stays recorded and blocks every later one — the exact P3009 incident the template's `migration-safety.test.ts` was written for.

**Resolution — ordered predicates against one connection:**
1. `_prisma_migrations` absent **and** zero other tables → **EMPTY**
2. `_prisma_migrations` holds a `migration_name` not in the image's migrations dir → **AHEAD**, refuse, name it
3. Any row with `finished_at IS NULL` or `rolled_back_at IS NOT NULL` → **FAILED** (new), refuse, name the pre-migration backup
4. No `PlatformBootstrap` with `completedAt` → **PARTIAL** → setup mode, and "New installation" is **disabled whenever any `Person` row exists**
5. Image migration missing from `_prisma_migrations` → **EXISTING** → backup → `migrate deploy`
6. Otherwise **CURRENT**

### B-6 — `sessions` module ownership is contradicted three times in one chapter
`01-domain-model.md` §1.2 (D-057) vs §2.3 vs §3.4

- D-057: "`ScheduledSession` is owned by its own `sessions` module."
- §2.3 (unedited pre-D-057 text): "One table, two module owners — `planning` writes it, `attendance` reads it… **This is the only shared table in the design and it is deliberate.**"
- §3.4 table: "Written by `planning`, read by `attendance`."

Also the entity is `AttendanceRecord` in §2.2, §3.4's session row and §4's aggregate table, but `AttendanceEvent` in §3.4's entity row and D-061. `AttendanceRecord` is the superseded mutable name; the append-only model needs the other.

**Resolution:** `sessions` owns the model and publishes `createSession/reschedule/cancel/get/listForGroup`. Delete §2.3's paragraph. Rename to `AttendanceEvent` everywhere. **And note the enforcement gap:** the ESLint `no-restricted-imports` rule (`05-…` §3.1) catches cross-module *imports*, not `prisma.scheduledSession.create()` called from inside `planning` — which is the actual violation it was written to prevent. Add a per-module Prisma client wrapper or a second rule.

### B-7 — Retention execution has no data model, and audit deletion breaks the hash chain
`01-…` §5, `02-…` §5.6 (D-065), `07-…` §1.2, FM-10

The design never mentions that the template's `AuditEvent` is a **tamper-evident hash chain**: `previousHash`, `hash @unique`, a genesis constant, appends serialized on a Postgres advisory lock, and `src/modules/audit/README.md` recommending `REVOKE UPDATE, DELETE ON "AuditEvent"` at the DB level.

The design's `onExpiry: DELETE` at 24 months therefore (a) breaks verification of everything after the deleted range, and (b) fails outright if the recommended revoke is applied.

Separately: `RetentionPolicy` exists only as prose. `MaintenanceJob` stores `enabled/intervalMinutes/lastRun*` — so "a dry run and a report before anything is removed" has nowhere to live.

**Resolution:**
- Audit rotation becomes **sealing**: write `AuditChainCheckpoint(uptoSequence, uptoHash, sealedAt, rowCount)`, export the range to an encrypted archive, delete it, re-anchor the next append's `previousHash` to the checkpoint hash. Verification walks checkpoints + live tail.
- Add `RetentionPolicy(dataClass @id, purpose, lawfulBasis, ground?, retainForDays, trigger, onExpiry, confirmedByPersonId?, confirmedAt?)`. **`confirmedAt IS NULL` ⇒ the job refuses to execute it** — that is what makes F-27's "proposal, not legal advice" enforceable rather than aspirational.
- Add `RetentionRun(id, policyKey, startedAt, dryRun, candidateCount, affectedCount, reportJson, executedByPersonId?)`, and require a matching prior dry run (by id, within N hours) before a live run.

---

## 2. MAJOR — mostly unchecked assumptions about the template

### M-1 — D-047's restore matrix is not implementable as written, and is empty at v1.0
`14-…` §4.3.1, `06-…` §2.1, R-28

Unspecified and all blocking: where fixtures come from; who generates them and when; the fixture encryption key (F-19 forbids credentials in fixtures — say it's a fixed public test key); storage (a `pg_dump` + assets per release, forever, in a repo that also never squashes migrations); what "domain invariants" means; where `minimumRestorableVersion` lives and how it's compared across pre-release tags.

And structurally: at v1.0 there are zero prior releases, so the matrix is green while protecting nothing — but **fixture generation must already ship in v1.0**, or v1.1 can never test restore-from-v1.0.

**Resolution:** the release workflow gains a final step — boot the just-built image against scratch Postgres, `seed --fixture=restore-matrix` (deterministic: same ids, every table non-empty), back it up with the fixed public `RESTORE_FIXTURE_KEY`, upload as a **GitHub Release asset**, not a git commit. The matrix job lists releases ≥ floor via the Releases API, restores each, migrates, then asserts: `migrate status` clean; **`prisma migrate diff --from-schema-datamodel --to-schema-datasource` is empty** (that's the real schema assertion, one command); per-table row counts vs manifest; and a fixed invariant set — every `Person` readable, every `Certificate` resolving to a non-superseded `ExamResult`, every encrypted column decrypting to known plaintext, every audit chain verifying.

### M-2 — D-049 is untestable as described, and the current code guarantees the failure it prevents
The template already stamps `FORMAT = "v1"` — good — but `decryptSecret` **throws on any `parts[0] !== FORMAT`**. One decryptor, no registry: the moment a `v2` ships, every v1 value becomes unreadable. There are also **two independent copies** of this file with different HKDF labels and separate `FORMAT` constants, so a v2 rollout must happen twice, consistently, with nothing enforcing it. And nothing makes D-049 fail a build.

**Resolution:** one `src/lib/crypto/envelope.ts` with `DECRYPTORS: Record<FormatVersion, Decryptor>` and `CURRENT_FORMAT`; per-module files become thin purpose labels. Then the mechanism the design is missing: **a committed golden-vector test** — `{format, purpose, ciphertext, expectedPlaintext}` under a fixed public test key, one entry per format ever shipped. Removing a decryptor breaks the build. That converts "we retain decryptors" from a promise into a check.

### M-3 — D-048 ("never squash") is enforced by nothing
**Resolution:** `tests/unit/migration-history-append-only.test.ts` in the style the template already uses — assert the migration-name set at the last release tag is a subset of HEAD's, and that no applied migration's SQL content hash changed, against a committed `prisma/migrations/.lockfile.json`. Squashing or editing an applied migration becomes a red build.

### M-4 — The design misdescribes the template's CI; the entire security column is missing
`00-…` §2.1 claims CI "already runs … **container build**, and a migration-against-populated-database job." `06-…` §2.1 says "The template's CI already implements most of this."

Actual `.github/workflows/ci.yml` (271 lines, **3 jobs**): `verify` (format/lint/typecheck/seed-smoke/vitest/build), `e2e`, `migrate-populated`. There is **no container build, no `npm audit` gate, no CodeQL, no secret-scanning job, no axe assertion anywhere in `tests/`** (grep finds only prose), and no scope-escape/isolation suite. Of the 15 required checks, 7 exist.

Worse: `deploy-uat.yml` runs `docker compose build` **on the UAT host** — it builds at deploy time rather than promoting an image. That is the direct opposite of D-022, and it is existing behaviour to be replaced, not extended.

### M-5 — `03-…` §1.2 contradicts the entire configuration architecture, and none of its image properties hold
"**All configuration via environment variables**" contradicts D-036/D-037. "Secrets generated on first run and written to the data volume" contradicts D-040 (see B-1). And of the six image properties listed — non-root, read-only FS, no build tools in the final layer, multi-stage, pinned base, SBOM — **zero** hold: the Dockerfile is a self-described "development/Sprint-0 image", single-stage, `FROM node:22-alpine` undigested, `npm ci` with devDeps and full source in the final layer, running as root. `pg_dump` is also absent, though `14-…` §3.1 says "the client tooling ships in the image (§1.2 of `03-…`)" — §1.2 never says that.

### M-6 — Key rotation silently un-enrols every TOTP
`13-…` §5 promises a re-encryption command. It can re-wrap *our* envelopes; it cannot touch Better Auth's internal TwoFactor secrets, which the template documents as encrypted with `BETTER_AUTH_SECRET`. Rotating the key therefore destroys every administrator's second factor at once, and MFA is mandatory (R-13). **Resolution:** B-1's HKDF split, plus a sentence naming exactly which values the command touches — and a restore-matrix invariant asserting an enrolled TOTP still works after restore with the same token.

### M-7 — The consent model is far smaller than D-063 assumes it inherits
Actual: `Consent(id, personId?, purposeKey, version, givenAt, withdrawnAt?, sequence)`. **No actor, no `consentType`, no `legalBasis`, no `authorityEvidenceId`, no `withdrawnByPersonId`.** D-063 needs all of them plus validity against `PersonRelationship.authority` at the moment of giving. This is retrofit-hostile: a consent captured under the current shape has no recoverable actor, and consent-on-behalf-of-a-minor is the majority case (F-02). Extend it in the foundation phase, and add both person columns to `person-reference-classification.ts` — the template's sync test will fail the build otherwise, which is the desired forcing function.

### M-8 — Zod is "already present in both repos". It is in neither.
No `zod` in `package.json`, no imports, no `src/lib/validation/`. Cheap to fix, but load-bearing: the settings registry design *is* "one Zod schema per setting" (`13-…` §3.2), and `05-…` §3's module template lists `validation/` as Zod schemas.

### M-9 — A tracked `.env` with secrets blocks the repo going public
`apps/web/.env` is **tracked** (`git ls-files` returns it), committed at `059c99b`, containing `BETTER_AUTH_SECRET` (45 chars — a real generated value shape), `POSTGRES_PASSWORD`, `DATABASE_URL`, `DIRECT_URL`. `.gitignore` covers only `apps/web/.env.local` and `.env*.local` — **not `.env`**. The remote is `origin/main` on GitHub with prior Copilot cloud-agent PRs.

F-19 predicts this exact risk but its response ("enable push protection **before** the repo goes public") does not address a secret already in history. **Resolution, in order, before anything else:** confirm visibility → rotate both secrets wherever still in use → add unanchored `.env` to `.gitignore` → `git filter-repo` + force-push (forks are unfixable) → enable scanning/push protection → only then open the repo.

### M-10 — The licence is already chosen, and it isn't the one OD-13 recommends
OD-13 treats the licence as open with "cost of delay high and rising". `LICENSE` at the repo root is already **GNU GPL v3**, and external contributions already exist (`Merge pull request #11 from Jackldam/copilot/…`).

GPL-3.0 does **not** trigger on network use — a competitor may run a modified SplashTrack as a hosted service and publish nothing. That is precisely the outcome OD-13's AGPL recommendation exists to prevent. **Resolution:** record the actual state in OD-13; decide GPL→AGPL now while the contributor list is short, or accept GPL deliberately and drop the AGPL recommendation. Add `CONTRIBUTING.md` + DCO before the next external PR.

---

## 3. MINOR (condensed)

| # | Where | Issue | Fix |
|---|---|---|---|
| m-1 | `02` §1.2, `07` §1.3 | `platform.super_admin` referenced twice — stale, contradicts D-056. Not just prose: `allowPlatformSuperAdmin`/`isPlatformSuperAdmin` are real branches **inside `requirePermission`** | Add "remove the platform-super-admin path from `requirePermission`" to D-056's removal list (it names only models/namespaces); keep `require-platform-permission.test.ts` and `platform-admin-floor` green |
| m-2 | `07` FM-6 | "Fleet version skew / waves / bounded skew" — there is no fleet (F-14 closed) | Replace with "migration fails on an unattended upgrade" → D-044 + the FAILED state (B-5) |
| m-3 | `02` §3, §6 diagrams | `EXAM_SESSION` missing from both scope diagrams though D-054 makes it first-class | Add it — the diagram is what the enum gets implemented from |
| m-4 | `02` §3.3, `01` §3 | Broken sentence ("These replace the old scope-escape suite is non-optional…"); "`id`, `id`, `createdAt`" | Copy fix |
| m-5 | `01` §2.2 vs §3.1 | `Person ──1──< StudentProfile` vs `0..1`; `PersonRelationship` listed **twice** with different fields (`evidence?` vs `authority`) | One row: `type, fromPersonId, toPersonId, authority, evidence?, validFrom, validTo?` — D-063 needs both fields |
| m-6 | `14` §7 | `backup.schedule.cron`, but `MaintenanceJob` is interval-based (`intervalMinutes`), no cron parser, no cron dep | Use `backup.schedule.intervalHours` + a run-window; don't add a cron parser to a data-critical path for v1 |
| m-7 | `05` §1, `07` §2, `14` §3.2 | Object storage / "versioned, replicated" / S3 backup target — `blob-storage.ts` supports **only `"local"`** and throws otherwise; no S3 client in `package.json` | Scope S3 out of v1: mounted volume only, operator syncs it. Less code, fewer secrets in the registry |
| m-8 | `00` §4.1 | "Attendance write p95 < 300 ms for a group of 30" — but audit appends take a **Postgres advisory lock** and `01` §4 requires one transaction per group, so 30 events + 30 audit rows serialize globally against every other audit writer | Write **one** audit event per group registration, not per student (§1.2 only requires auditing *amendments*), or batch the chain append. Decide before writing the load test — the target was set without knowing the lock exists |
| m-9 | `05` §3 (D-021) | "the existing SplashTrack repo already uses `apps/web`" — true of SplashTrack, but the **template** is flat-root (`src/`, `@/*` → `./src/*`). Adopting `apps/web` means moving the whole tree + rewriting `tsconfig`, both `vitest` project globs, `playwright.config.ts`, `prisma.config.ts`, Dockerfile, two compose files | Keep flat root for v1. If not, do the move as the literal first commit |
| m-10 | `06` §1 | DEV/UAT "Config: env vars per environment" contradicts D-036/037 for everything but Layer 1 | Say "Layer-1 env vars; everything else DB-backed" |

---

## 4. Sequencing — what must be built first

Ranked by cost of doing it late:

1. **Encryption envelope + key derivation** (B-1, M-2, M-6). Highest. Every encrypted byte written before the envelope has to be found and re-wrapped; the key split determines whether restore preserves MFA. Nothing that stores a secret may be written first.
2. **Audit chain-aware rotation + checkpoint model** (B-7). The chain exists and is append-only at the DB level; deciding rotation after two years of events means retroactively rewriting a tamper-evidence claim.
3. **The scope model** (B-3). It changes the signature of the guard every module calls. Any domain module built first has to be rewritten — and its D-032 scope-escape tests were written against the wrong question.
4. **Append-only event models** with `clientEventId` / `supersedes*Id` (B-6; D-005/061/062). Converting a mutable column to an event log after data exists means inventing the history you destroyed. *Note:* D-062's "exactly one effective result per candidate" has no stated enforcement — make `supersedesResultId @unique` (a result may be superseded at most once ⇒ linear chain, unique tail) plus a test.
5. **Settings registry** (B-4). Every feature reading config before it exists reads it another way and must be ported.
6. **Consent extension** (M-7). Same retrofit-hostility as (4).
7. **Restore-fixture generation in the release workflow** (M-1) — must ship *with* v1.0 or v1.0 is permanently untestable as a restore source.
8. **Erasure/retention registry entries** — cheap, but `person-reference-sync.test.ts` fails the build the moment a domain model adds a `Person` reference. Put it in the DoD so it isn't a surprise.

**Concrete v1 order**

- **Phase 0 — repo hygiene (days).** Visibility + `.env` history purge + rotation (M-9); licence (M-10); layout decision (m-9, recommend flat root); add `zod` (M-8); glossary (OD-10 — cheap, and it blocks every schema name after it).
- **Phase 1 — foundation, no domain code.** Crypto envelope + golden vectors → boot state machine + FAILED + entrypoint replacement (testable *before* any domain model) → settings registry + version counter + write auditing → production Dockerfile (multi-stage, non-root, digest-pinned, `postgresql-client`, SBOM) → backup/restore + `.stbak` + manifest + recovery token → CI (container build/push, audit gate, CodeQL, migration-history-append-only, crypto vectors, UAT **promotion** instead of host build).
- **Phase 2 — remove and reshape.** D-056 removals incrementally, tests green each step (platform-super-admin path in the guard, `PlatformRoleAssignment`, `organization-scope.ts`, the 45 `organizationId` occurrences — only **15** `forOrganization` call sites, so do it early and cheaply) → scope model + `coversResource()` + reach as a required repo argument, shipping the scope-escape **test harness** so later modules inherit it → consent extension + `RetentionPolicy`/`RetentionRun`/audit checkpoint → setup wizard on top of all of it.
- **Phase 3 — domain, in DAG order.** `people → students → groups → courses → skills → sessions → attendance → exams → planning`. Attendance is the flagship but sits on five modules; resist starting there.
- **Phase 4 — surfaces.** CMS/public reshaping, branding collapse, diagnostics, IdP registry (B-2 — spike in Phase 1 so the answer is known, build late; it is the least retrofit-hostile item here).

---

## 5. Migration / data risk (OD-1)

**A fact the design doesn't record:** the prototype is not a separate repository. It is **in the working tree of this repo**, at `apps/web` on `main` — 111 TS files, 12 models, **4 migrations** (`20260314000000_init` … `20260428213000_add_organization_hierarchy_and_capabilities`). The design branch sits on top of it. So "no destructive action against the existing repository" is a constraint on the repo the v1 build will also occupy, and the obvious move (replace `apps/web`) is exactly what OD-1 forbids.

What's missing to make OD-1 safe and answerable:

- **It asks the wrong question first.** "Does the prototype have real data" can't be answered from a repo. Ask instead: *is there a deployed prototype instance, and who holds its connection string?* If nobody can name a running instance, the answer is no and OD-1 closes today.
- **No import artefact is specified**, even conditionally. Adopt now, at zero cost while the answer pends: a **file-based, offline, one-way** path — a standalone `scripts/legacy-export.ts` run against the prototype emitting a documented JSON envelope, consumed by `splashtrack import:legacy --file …`. No live DB link in either direction. This satisfies D-001's condition via the export script rather than the migration history, and the import runs through the *new* application services so rows land with correct scoping, consent and audit rather than by SQL.
- **The mapping is undecided and non-trivial.** The prototype's `Organization` is **multi-row with a hierarchy**; SplashTrack's is an enforced singleton (D-027). An import from a prototype holding N organisations has no single target — it becomes N installations, N imports, N recovery tokens. Nothing says this. R-29 should state that the import takes **one** prototype organisation id as a required argument, and that `OrganizationMemberCapability` must map to role assignments explicitly, **refusing** the import on any unmapped capability rather than silently dropping authority.
- **Consent cannot be imported, and pretending otherwise is the real risk.** The prototype has no consent model. Every photo, medical note and marketing flag would arrive with no lawful basis, into a system whose privacy model (D-063/D-065/F-27) rests on having one. The importer must write **zero** `Consent` rows, leave every consent-gated feature off, and emit a report of what couldn't be carried over. That is the difference between an import that improves their compliance position and one that launders a gap.
- **Append-only makes the import lossy — say so.** Prototype `Student`/`GroupMembership` carry status, not history, so imports start with one synthetic `StudentLifecycleEvent(JOINED)` and one `MembershipPeriod`. Add `origin: IMPORTED_LEGACY` so nobody later reads an import artefact as evidence in a dispute.
- **Sequencing:** the importer is written after Phase 2, before any cutover — not a Phase-1 item.
- **Wording bug:** OD-1 reads "**Status: BLOCKING, confirmed by Jack (2026-08-31)**", which scans as resolved. It confirms the *blocking status*, not the answer. Every future reader will misread it.

---

## 6. What checked out (fairness)

A lot of the template claims are accurate, and two capabilities are *undersold*:

- `Architecture.md` is **exactly 862 lines**; **35** Prisma models; **30** ADRs (001–030). All as stated.
- Present as claimed: `Person`/`UserAccount` split, memberships, roles/permissions/`AccessGroup`/`OrganizationUnit`, branding + `UploadedAsset`, `CustomPage` CMS, `ProfileField*`, `AuditEvent`, `ApiCredential`, `TwoFactor`, `Passkey`, `EmailTemplate`, `MaintenanceJob`, `RateLimitCounter`.
- Entra sign-in with the client secret AES-256-GCM encrypted at rest, DB-stored, never returned to a client — accurate (ADR-022, `secret-crypto.ts`).
- The `OrganizationBranding.updatedByPersonId` Article-17 rollback incident the design cites twice as a quality signal is **real** and documented in `person-reference-classification.ts`.
- `requirePermission` genuinely denies by default including on DB-unreachable — matches `02-…` §1.1 rule 2.
- Step-up re-auth (PKCE, ID-token verification, intents, throttle) is more developed than `02-…` §1.2 implies.
- **Two things to adopt explicitly rather than re-invent:** `tests/unit/migration-safety.test.ts` blocks the unsafe `ADD COLUMN … NOT NULL` without default — free enforcement for exactly the P3009 class that would strand a self-hoster mid-upgrade; and `person-reference-classification.ts` + `person-reference-sync.test.ts` **is** D-014's "registry with a test asserting every `Person`-referencing table appears in it", already built and bidirectionally checked. The design describes it as something to create.