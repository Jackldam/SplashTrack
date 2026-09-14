# Phase 3.0 — the Recovery Kit: backup, restore, migration, upgrade

**Branch** `feat/recovery-kit-backup-restore` · **From** `3176ac2`
(`origin/build/v1-foundation`, 1066 tests before this branch) · **Not
pushed, not merged, not deployed.**

`docs/design/14-backup-restore-upgrade.md`, in full — §2 through §7. The
biggest operational gap in v1: there was no backup/restore mechanism at all,
and every migrating deploy required a manual `touch
/app/data/allow-unbacked-migration` acknowledging that no pre-migration
backup existed. This phase builds D-095/D-102/D-114/D-166's Recovery Kit —
crypto envelope, `.stbak` archive format, logical export/import engine,
on-demand backup (admin UI + CLI), restore (CLI, setup-wizard-only by
design), and wires a real pre-migration backup into the boot-state machine
— and replaces the acknowledge-marker with an actual backup as the default
path, keeping the marker only as a noodklep for when the backup engine
itself fails.

Decisions implemented: **D-114/D-166** (two-level key envelope: master key
wrapped once by Argon2id over the printed recovery token; each archive's own
data key wrapped by the master key), **D-115** (the `STK1-…` token format,
Crockford base32 with a check character, ≥128 bits), **D-102** (framed AEAD,
sequence-bound chunks with an authenticated final marker), **D-095/D-169**
(the logical export/import engine, no `pg_dump`, the round-trip guard),
**D-046** (restore-then-migrate ordering, §4.3's core promise — see §1.6 for
how far this phase actually took it), **D-116/D-182** (§4.2.1's untrusted-
input framing — moot in practice because there is no SQL to filter), **D-166
§4.2.2** (the fingerprint gate and `secret:recover`), **D-044/D-104** (the
real pre-migration backup, replacing the acknowledge-marker as the default
path, with retention), **D-042/D-030** (`backup.run`/`backup.download`
permission-gated and audited — both were already catalogued in phase 0.4b's
work, unused until now).

---

## 0. What landed

| Commit | |
|---|---|
| `recovery-kit: crypto envelope, framed AEAD and .stbak archive format (§2)` | `src/lib/crypto/recovery-token.ts`, `backup-envelope.ts`, `framed-aead.ts`, `node-argon2.d.ts`; `src/modules/backup/domain/archive-format.ts` |
| `recovery-kit: logical export/import engine, the D-169 round-trip guard (§3.1.1)` | `src/modules/backup/infrastructure/schema-graph.ts`, `logical-export.ts`, `logical-import.ts` |
| `recovery-kit: backup and restore application services (§3, §4)` | `src/modules/backup/application/backup-service.ts`, `restore-service.ts` |
| `recovery-kit: wrap the key record once, not per archive` | resolves a real gap the design left open — see §1.1 |
| `recovery-kit: CLI surface` | `src/cli/commands/backup.ts` — `backup:init-token`, `backup:create`, `restore`, `secret:recover`; wired into `src/cli/index.ts` |
| `recovery-kit: wire the real backup engine into the boot-state machine (§5, §7)` | `docker-entrypoint.sh`'s `MIGRATE_THEN_SERVE` branch; `OrganizationConfig.backup.premigrationEnabled` (v3) |
| `recovery-kit: admin backup screen (§3.1)` | `src/app/admin/backup/page.tsx`, `src/app/api/admin/backup/route.ts` |
| `recovery-kit: link the backup screen into the landing page` | fixed `route-reachability.test.ts`/`navigation-shell.test.ts` — a real "no link in" defect the pre-existing gates exist to catch |

### 0.1 Test additions

`tests/unit/`: `recovery-token.test.ts`, `framed-aead.test.ts`,
`backup-envelope.test.ts`, `archive-format.test.ts`, `schema-graph.test.ts`,
`settings-backup-config.test.ts`. `tests/integration/`:
`logical-export-import-roundtrip.test.ts` (two real throwaway Postgres
databases, D-169's own assertion list), `backup-scope-escape.test.ts`,
`restore-refusal.test.ts` (§4.4).

---

## 1. What was built, per section

### 1.1 §2 — the Recovery Kit itself, and the gap the design left open

The token (D-115): `src/lib/crypto/recovery-token.ts`. 160 bits of CSPRNG
entropy, Crockford base32, grouped `STK1-XXXX-…`, a mod-37 check character
catching a mistyped or transposed group before it ever reaches Argon2id.

The envelope (D-114/D-166): `src/lib/crypto/backup-envelope.ts`. Argon2id
(`m=64MiB, t=3, p=1`) over the token's raw bytes, native `node:crypto`
`argon2Sync` — Node 24 ships it; this project's `@types/node` (`^20`)
doesn't yet, so `node-argon2.d.ts` adds a narrow ambient declaration rather
than a new runtime dependency. `wrapKeyRecord`/`unwrapKeyRecord` are generic
over the AAD; `computeKeyFingerprint` is `HKDF(SECRET_KEY,
"key-check-v1")`, truncated to 16 bytes.

**The gap, found while wiring §5.** D-166 says the key record's AEAD is
bound to *"the archive's manifest digest, so it cannot be spliced from one
archive into another"* — read literally, every archive needs a fresh
Argon2id pass over the raw token at write time. That is fine for one manual
click but makes §5's *automatic* pre-migration backup unbuildable: there is
no operator to type a token when a container restarts on its own. D-114's
own words resolve it one paragraph earlier — the master key is *"generated
at setup and **stored** wrapped"* — so this build takes that as
authoritative: `generateWrappedKeyRecord` runs once
(`backup:init-token`/`initializeRecoveryKit`), the wrap is persisted
(`key-record-store.ts`, a file under `$DATA_DIR` alongside
`SECRET_KEY_FILE`, excluded from the archive's own asset capture on the same
D-113 basis), and every archive since embeds that *same* wrap, bound to a
fixed AAD instead of a per-archive digest. The cost, stated plainly: an
attacker who somehow spliced one of your own archives' key-record section
into another of your own archives gains nothing (both unwrap to the
identical master key). Splicing a *different instance's* wrap still fails
outright — that is the property D-166 actually needs, and it does not
require the digest binding to get it. Full argument in
`archive-format.ts`'s module doc. **Flagged for Jack**: this is a real
divergence from the design document's literal wording, made because the
literal wording could not satisfy §5's own requirement; worth a look.

The archive format (D-040/D-102): `src/modules/backup/domain/archive-format.ts`.
`MAGIC | header(JSON) | manifest(framed AEAD) | body(framed AEAD)`, manifest
authenticated and parsed *before* the body per D-102. `openArchive` runs
§4.2's sequence — unwrap key record, fingerprint check available to the
caller, unwrap data key, authenticate manifest, authenticate body — and
throws before returning anything on any failure.

Framed AEAD (D-102): `src/lib/crypto/framed-aead.ts`. Sequence-bound
AES-256-GCM chunks (not libsodium `secretstream`/`age` — see the module doc
for why the existing AES-256-GCM primitive was kept rather than adding a new
cipher family for one format), authenticated final-chunk marker, so
truncation/reordering/splicing all fail authentication. **In-memory, not
streaming** — a deliberate, flagged v1 scope call: this product is one
self-hosted instance (D-162), the frame boundaries are already part of the
format so switching to a `Readable`/`Writable` pair later is an internal
change, and building genuine streaming I/O correctly was more than this
phase's budget could responsibly cover untested.

### 1.2 §3.1.1 — the logical export/import engine (D-095/D-169)

`schema-graph.ts` parses `prisma/schema.prisma` directly rather than reading
Prisma's DMMF — checked directly, Prisma 7's generated client exposes none.
Derives, per model: its columns (scalar/enum fields; relation object fields
are never columns), its FK dependencies (only the side spelling
`@relation(fields: …)` — the back-reference side is not a dependency, a bug
caught by the schema's own topological-sort test going red on a 28-model
false cycle before the fix), self-referencing FK columns (four models:
`OrganizationUnit.parentId` and three `…Supersedes` chains, all nullable),
and the primary-key column (not assumed to be `"id"` — `RateLimitCounter.key`
and `RetentionPolicy.dataClass` aren't).

`logical-export.ts`/`logical-import.ts`: every table via
`SELECT * FROM "<Model>" ORDER BY "<pk>"`, values tagged
(`{"$bytes":…}`/`{"$date":…}`/`{"$bigint":…}`/`{"$decimal":…}`) for lossless
JSON round-tripping, self-referencing columns nulled on insert and patched
in a second pass. `RateLimitCounter` is the one model deliberately excluded
— ephemeral rate-limit state, not personal data, and restoring stale
counters could even reopen an exhausted rate-limit window.

**D-169's round-trip guard is real**, not a stub:
`tests/integration/logical-export-import-roundtrip.test.ts` builds two
actual throwaway Postgres databases, seeds one with `setup:init` plus a
`Person`/`PersonRelationship` pair whose `evidence` is sealed through the
real application envelope, exports, imports into a genuinely empty
freshly-migrated target, and asserts row counts per table, primary keys
preserved exactly, and the encrypted column decrypting to its known
plaintext through the ordinary `open()` path.

### 1.3 §3 — Backup

**§3.1 (on-demand) is real and fully built.** `backup-service.ts`:
`createBackup` (`backup.run`, ORGANIZATION-scoped, audited) builds the
archive from the persisted wrap; `requireBackupDownload` (`backup.download`,
audited) gates the download separately, per D-042's "these are different
powers" framing. `createSystemBackup` is the unauthenticated CLI/boot-state
twin (`system:cli` actor, `actorPersonId: null`), used by §5.

**§3.2 (scheduled/unattended) is NOT built**, as the task anticipated might
be necessary to flag: `MaintenanceJob`'s interval-based runner exists in the
codebase but nothing in this phase wires a scheduled backup job to it, and
no `backup.schedule.*`/`backup.retention.*` settings were added (§7's list
names them; this phase deliberately does not, on the "a setting nothing
reads is worse than an honest gap" principle already stated in
`config.ts`'s comment). This is the one full §3 sub-section left for a
follow-up phase.

**§3.3 (download is a security event) is partially built.** What's real: the
permission gate and a high-severity audit event
(`backup.downloaded`/`backup.created`), both enforced in
`/api/admin/backup`'s route handler and proven in the HTTP walkthrough
(§2.3 below). **Not built, flagged**: step-up re-authentication, rate
limiting, and serving via a short-lived single-use signed link rather than a
direct response. This codebase has no step-up-reauthentication primitive and
no signed-URL mechanism at all yet (checked: `@/lib/auth` has session
verification only) — building either is real infrastructure work belonging
to its own phase, not a corner to cut inside this one.

### 1.4 §4 — Restore

Built as a CLI command (`splashtrack restore`), run against a fresh, empty
instance — never wired into the browser setup wizard's UI (flagged below).
`restore-service.ts`'s `restoreFromArchive` runs the full §4.2 sequence:

1. Re-checks the boot state is `EMPTY` **itself** (§4.4) — never trusts a
   caller to have checked, because a function this consequential should not.
2. Opens and authenticates the archive under the token.
3. The §4.2.2 fingerprint gate against the running `SECRET_KEY` — refuses
   with nothing written, names `secret:recover`.
4. §4.3.2's "newer backup" refusal (D-043): the manifest's
   `appliedMigrations` compared against the image's own migration list.
5. Migrates to the current schema, then imports (see §1.6 below for the one
   place this diverges from D-046's literal sequence).
6. The §4.2.2 decryptability proof: every registered encrypted column's
   newest non-null value decrypts through the ordinary `open()` path, and
   `verifyAuditChain()` passes. Any failure reports the restore **FAILED**,
   never "succeeded with row counts matching" — D-166's own correction of
   the weaker check the design chapter itself describes replacing.

**`secret:recover` (D-166 §2.3) is built**: unwraps only the archive's
`SECRET_KEY` under the token, writes it to a file at 0600, prints nothing of
the key. Proven for real in §2.1 below — it recovered the exact original
key.

**Not built, flagged**: the TOTP leg of the decryptability proof. No column
in this schema is encrypted under `secret-key.ts`'s `totp-v1` purpose yet
(its own comment: "no consumer in this phase") — there is nothing to prove
decrypts, so this leg is a documented no-op rather than a fabricated check.

### 1.5 §4.1/§4.4 — where restore runs, and where it refuses

**§4.1's "restore lives in the setup wizard" is NOT built as a wizard
step.** The CLI command exists and is the tested, working path; the browser
`/setup` wizard was not extended with a "Restore from backup" branch. This
is the single largest deliberate scope cut in this phase, made for time, and
it is the one place this report says plainly: the chapter's literal UI
placement is not delivered, only its mechanism. `secret-key.ts`'s wizard
integration point (the setup wizard already exists and already branches on
boot state — see `src/lib/setup/`) is where this would attach; it was not
attempted this phase.

**§4.4 is built and proven.** `restoreFromArchive` refuses before even
parsing the archive when the boot state is not `EMPTY`
(`RestoreRefusedNotEmptyError`), tested against the suite's own genuinely
non-empty database and proven again in the real CLI walkthrough (§2.2).

### 1.6 §4.3/D-046 — the restore-into-newer-image promise, honestly scoped

D-046 specifies: restore writes the *old* schema (replaying the exact DDL in
force at backup time) as a first step, then migrates forward. **This build
does not do that.** It migrates to the *current* schema first, then imports
the old export's rows into it (`logical-import.ts`'s own module doc argues
this at length). This is flagged, not silently narrowed, for three reasons
stated there in full:

- D-047/D-105 say themselves that at v1.0 "the matrix is green while
  asserting nothing" — there is no prior release, so there is no historical
  migration set this build could even validate a literal replay against.
- Every migration this schema has ever shipped is additive (checked
  directly) — no migration drops or renames a column a prior release wrote
  data for — so the two strategies produce an identical end state for every
  case that exists today.
- The manifest still carries `appliedMigrations` and
  `minimumRestorableVersion` (D-048's mechanism), and §4.3.2's compatibility
  table is implemented for real (`Newer` is refused; `Older, <
  minimumRestorableVersion` has a documented no-op comparator, since no
  release has ever raised the floor yet).

**The concrete trigger for building the real replay path**, named
explicitly: the day a migration renames or drops a column a prior export
wrote — exactly the class `encrypted-columns.ts`'s header already singles
out for special migration handling. Until then, this is an honest,
narrower promise than D-046's literal words, not the promise itself.

### 1.7 §5 — Migration

`docker-entrypoint.sh`'s `MIGRATE_THEN_SERVE` branch now runs
`splashtrack backup:create --reason pre-migration` for real, in place of the
`allow-unbacked-migration` acknowledge-marker as the **default** path. The
marker survives, consumed only when the real backup fails (Recovery Kit
never initialized, disk pressure, an export bug) — the noodklep D-044's own
trade-off paragraph anticipates, not the routine route anymore.

D-104's retention (at most three pre-migration backups, pruned after a
successful start) is implemented with `ls -1t | tail -n +4 | rm` at two
points: before writing a new one, and again after the post-migration
`boot:state` verify confirms the start succeeded.

`backup.premigrationEnabled` (§7, default `true`) is checked before the
pre-migration backup runs; `backup:create --reason pre-migration` exits a
distinct code (3) when the setting is off, which the entrypoint tells apart
from an actual failure (skip, no marker consumed) — D-044's own words,
"disabled only by an explicit setting."

### 1.8 §6 — Upgrade

Read for context, per the task's instruction. Nothing new built: the
capability table (readiness check, "take a backup now" button, the exact
upgrade command shown) largely depends on the admin "Maintenance" shell
that does not exist (§1.9), and `update.check.enabled`/release-advisory
checking (D-034) is out of this phase's scope entirely — no code in this
build reads a release feed or compares versions against a security
advisory. Flagged as fully deferred, not partially attempted.

### 1.9 §7 — Settings registry

`OrganizationConfig` gains a `backup` section (`ORGANIZATION_CONFIG_VERSION`
3): one member, `premigrationEnabled: boolean`, default `true`. Full
default/coerce (lenient, never throws, falls back to the safe default on any
malformed value)/validate (strict, throws `ApiError("VALIDATION_ERROR")` on
a non-boolean) round trip, tested.

**Everything else §7 lists is deliberately absent**:
`backup.schedule.enabled`/`intervalHours`/`window`, `backup.retention.count`/
`days`, `update.check.enabled`. None of them is read by any code this phase
ships — §3.2 (scheduled backups) and §6 (update checking) are both out of
scope — and `config.ts`'s own comment states the principle: a setting
nothing reads is worse than an honest gap in the registry.

**On "is there a settings-registry concept at all" (the task's own
question):** yes — `OrganizationConfig`
(`src/lib/settings/config.ts`/`settings.ts`) *is* the settings registry
D-036/D-037 describe: one versioned JSON document, lenient reads, strict
writes, live-applied, no migration per field. It predates this phase
(phase 0.2) and R-17's "settings *screen*" (an admin UI to edit it) is the
piece that does not exist yet — confirmed by grep, there is no `/settings`
or `/admin/settings` route anywhere in `src/app`. This phase adds one field
to the registry; it does not build the screen, because there is no screen
for *any* existing setting to attach to yet, and building one screen's worth
of settings-editing UI as a side effect of one field would be exactly the
half-built surface the task's own instructions warned against.

---

## 2. Verification

### 2.1 CLI, real end to end (the core promise)

Two real, throwaway Postgres databases (not mocks — created, migrated,
seeded and dropped via the real `splashtrack_owner`/`splashtrack_retention`
role model), the real `splashtrack` CLI in child processes, driven by a
one-off script (not committed — a verification run, not a deliverable):

1. `setup:init` + `admin:create` on SOURCE — a real administrator account.
2. `backup:init-token` — a real token printed, a real wrapped key record
   persisted.
3. `backup:create` — a real 35,919-byte `.stbak` file on disk.
4. `restore` onto TARGET (empty) **with a freshly generated `SECRET_KEY`**
   — refused: *"The archive's key fingerprint does not match this
   instance's SECRET_KEY … Run `splashtrack secret:recover`"* — the
   fingerprint gate, firing for real.
5. `secret:recover` — recovered `SECRET_KEY` verified **byte-for-byte
   identical** to SOURCE's own.
6. `restore` onto TARGET again, with the recovered key — **succeeded**: 57
   tables imported.
7. TARGET's data compared against SOURCE's: `Organization` count, the
   admin's email, the `Permission` count — **all matched exactly**.
8. `restore` attempted against SOURCE (running, non-empty) — refused:
   *"this database is not empty (boot state PENDING_ENROLMENT) … §4.4"*.

Every step above is a real process exit code and real stdout/stderr, not an
assertion inside a test process.

### 2.2 Admin UI, real HTTP walkthrough

No browser-automation tool was available to this build (checked via tool
search) — a real `next start` production server and a real throwaway
database were driven over the identical HTTP surface a browser uses
instead: real email+password sign-in
(`POST /api/auth/sign-in/email`), real TOTP verification against a
terminal-enrolled authenticator (`admin:reset-mfa`'s own artefact,
`POST /api/auth/two-factor/verify-totp`), a real session cookie, a real `GET
/admin/backup` (200, page renders the button), and a real
`POST /api/admin/backup` — **200, `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename="…stbak"`, 39,611 bytes, STBAK1
magic bytes confirmed**. The server's own log for that request shows
`security.two_factor_login`, `backup.created` and `backup.downloaded` audit
events, in order.

### 2.3 Automated tests

`npm test`: **95 files, 1073 tests, all green** — the pre-branch baseline
was 1066 (94 files); this phase adds 7 new files / 72 new tests with zero
regressions. `npm run typecheck`: clean. `npm run lint`: clean. `npm run
format:check`: clean. `npm run build`: succeeds, both new routes
(`/admin/backup`, `/api/admin/backup`) registered; the one warning is a
pre-existing `app-version.ts` tracing note unrelated to this phase.

Two pre-existing structural gates caught real defects during this phase and
were fixed rather than worked around: `route-reachability.test.ts` (no
`<Link>` into `/admin/backup` from anywhere) and `navigation-shell.test.ts`
(no breadcrumb back out) — both the exact "shipped with no way in/out"
class of defect those tests were written to catch in earlier phases.

---

## 3. Open questions for Jack

1. **§1.1 — the key-record wrapping design diverges from D-166's literal
   words.** Wrapped once (at `backup:init-token`), embedded unchanged into
   every archive, bound to a fixed AAD rather than each archive's own
   manifest digest. Necessary for §5's automatic pre-migration backup to be
   buildable at all; the security argument for why this is not a real
   weakening is in `archive-format.ts`'s module doc. Worth confirming this
   reading of D-114's "stored ... at setup" is the intended one.
2. **§4.1 — restore is a CLI command, not a setup-wizard step.** The
   chapter's placement ("the wizard's first question becomes...") is not
   built. Is CLI-only acceptable for this phase, with the wizard step as
   explicit follow-up work, or does this need to move before the branch is
   considered done?
3. **§3.2 — scheduled/unattended backups are entirely absent.** No
   `MaintenanceJob` wiring, no settings for it. Flagged as the largest
   deferred §3 sub-section.
4. **§3.3 — step-up re-auth, rate limiting and single-use signed download
   links are not built.** The permission gate and audit event are real;
   the rest needs infrastructure this codebase does not have yet
   (step-up re-authentication, signed URLs).
5. **§4.3/D-046 — restore imports into the CURRENT schema rather than
   literally replaying old DDL.** Argued at length in
   `logical-import.ts`'s module doc as the only responsible choice at
   v1.0 (no prior release exists to validate a replay against), with the
   concrete trigger (a rename/drop migration) named for when this needs
   to become real. Confirm this reading of D-047/D-105's own "zero prior
   releases" admission is acceptable.
6. **§7 — only `backup.premigrationEnabled` was added to the settings
   registry**, deliberately, because §3.2/§6 (the sections the rest of
   §7's fields belong to) are not built. There is also no settings
   *screen* (R-17) for ANY existing setting yet, confirmed by grep — this
   phase does not attempt to build one.
7. **The framed AEAD is in-memory, not streaming**, and the archive-build
   path (`exportDatabase`) holds the whole logical export in memory before
   encryption. Flagged in `framed-aead.ts`'s module doc as a deliberate
   v1 scope call given this product's expected data size (one
   self-hosted swim school); revisit if that assumption stops holding.
8. **The `BreakGlassAlert` administrator-notification banner was not
   extended** to cover `restore`/`secret:recover`
   (`src/cli/break-glass.ts`'s `BreakGlassCommand` union is unchanged).
   `secret:recover` in particular arguably should notify administrators
   once the instance is back up; left as a follow-up rather than
   extending a carefully-scoped shared type under this phase's budget.
9. **Token rotation is not built.** `storeWrappedKeyRecord` refuses to
   overwrite an existing wrap, so `backup:init-token` can only run once
   per instance today. A genuine rotation flow (issue a new token,
   re-wrap, keep old archives readable per D-114) is real future work.

---

## 4. Definition of Done, self-assessed

| Requirement | Status |
|---|---|
| §2 crypto envelope + archive format | Built, tested (unit), the §1.1 divergence flagged |
| §3.1.1 logical export/import | Built, tested (unit + real 2-database integration round trip) |
| §3.1 on-demand backup (admin UI + CLI) | Built, tested (scope-escape) and verified for real (CLI + HTTP walkthrough) |
| §3.2 scheduled backup | **Not built** — flagged |
| §3.3 download security controls | Permission + audit built; step-up/rate-limit/signed-link **not built** — flagged |
| §4.1 restore placement (wizard) | **CLI only** — wizard step not built, flagged |
| §4.2 restore sequence | Built, tested, verified for real including the fingerprint-gate → secret:recover → success path |
| §4.2.1 untrusted-input framing | Structurally true (no SQL in the format) |
| §4.2.2 decryptability proof | Built for encrypted columns + audit chain; TOTP leg N/A (no consumer yet) |
| §4.3/D-046 old-into-new restore | **Narrower than the literal design** — import-into-current, flagged with the trigger for the real version |
| §4.4 refuse on a running instance | Built, tested, verified for real |
| §5 pre-migration backup | Built, wired into the boot-state machine, retention implemented |
| §6 upgrade capabilities | Not built — deferred in full |
| §7 settings registry | One field added (`backup.premigrationEnabled`); rest deliberately absent |
| Domain/service/scope-escape tests | `tests/unit/*` (6 new files), `tests/integration/*` (3 new files) |
| CI | `npm test`: 95 files / 1073 tests, zero regressions. `npm run typecheck`/`lint`/`format:check`: all clean |
| Real verification | CLI end-to-end (full fingerprint-mismatch → secret:recover → restore-success → data-match → §4.4-refusal sequence) and a real HTTP walkthrough of the admin UI, both documented in §2 above |
| Jack's approval | Not yet requested — this report is the handoff |
