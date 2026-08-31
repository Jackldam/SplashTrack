# Staging — deployment, configuration, backup/restore/upgrade

> **MERGED, 2026-09-01.** D-095–D-107 are in `09-decision-register.md`
> unchanged. D-090–D-094 (`SECRET_KEY`, key exclusion, two-level envelope,
> recovery-token entropy, non-superuser DB role) collided with
> `15-assessment-and-fees.md`'s own D-090–D-094 and were **renumbered to
> D-112–D-116** in `13-…`, `14-…`, `03-…` and the register — see
> `08-open-decisions.md`, Register integrity. Findings F-50–F-63 are in
> `10-findings.md` as **F-95–F-108** (renumbered — this file's own F-50–F-54
> collided with `domain.md`'s claim on the same numbers). All eight rows in
> "Requirements raised against chapters I do not own" have been actioned:
> `01-domain-model.md` §5 has the pre-migration-backup data class (D-111);
> `02-security-privacy.md` §5.3 has the backup-horizon qualifier; `07-…` §1.2
> has the four audit-list additions; `05-technical.md` §3 notes the missing
> `zod` dependency; `06-delivery.md` §1 states the two-layer config split;
> the register's D-038/D-039/D-044/D-047/D-049 pointers are current. This
> file is kept for provenance; do not merge it again.

Entries to be merged into `09-decision-register.md` and `10-findings.md` by
whoever consolidates. Nothing here has been written into those two files.

**Numbers used:** decisions **D-090 … D-107** (18, contiguous, none skipped);
findings **F-50 … F-63** (14, contiguous). Chapters touched:
`03-deployment-model.md`, `13-configuration-and-setup.md`,
`14-backup-restore-upgrade.md`.

> Note for the consolidator: an intermediate renumbering pass shifted several of
> these while the chapters were being written. The numbers below are the ones
> now in the chapter text; they were re-checked for uniqueness after the fact.

---

## Decision register rows

| D-xxx | decision | why | trade-off accepted | where |
|---|---|---|---|---|
| D-090 | There is exactly one bootstrap secret, `SECRET_KEY`, supplied via `SECRET_KEY_FILE`. It is the root of every application key, including the Better Auth signing secret, derived as `HKDF(SECRET_KEY, info="auth-signing-v1")`. The application never generates it into `DATA_DIR` | The design gave four mutually exclusive accounts of this key's lifecycle, and the template has no `SECRET_KEY` at all — at-rest encryption derives from `BETTER_AUTH_SECRET`, which *also* signs sessions and encrypts TOTP secrets. Same value ⇒ the Recovery Kit prints the session-forging key on paper; different values ⇒ restore silently kills every TOTP enrolment while MFA is mandatory. Deriving the signing secret makes restore reproduce it identically. A file beats an env var, which is readable via `docker inspect`, `/proc/<pid>/environ`, crash dumps and the operator's own committed compose file | Compromise of `SECRET_KEY` compromises everything derived from it; purpose labels at least make the blast radius stateable. A plain `SECRET_KEY` env var remains a deprecated fallback so existing installs are not bricked, and raises a diagnostics warning | `13-configuration-and-setup.md` §3.1.1 |
| D-091 | Key material is never inside a backup archive; the writer excludes the key-material path explicitly and CI asserts no shipped `.stbak` fixture contains it | `14` §3.1 captures assets from `DATA_DIR`. With key material under `DATA_DIR` and assets captured as a directory tree, the archive would contain its own decryption key — and every "inert without the token" claim collapses silently, with nothing failing | The exclusion is a deny-list, the weaker shape; backed by a test that greps fixtures for both the key bytes and the file name so it does not depend on remembering | `13-…` §3.1.1, `14-…` §3.1 |
| D-092 | Two-level key envelope: a random 256-bit master key wrapped by Argon2id (`m=64 MiB, t=3, p=1`, 128-bit salt) over the printed recovery token; a per-archive random data key wrapped by the master key and stored in the archive header. Rotation re-wraps the master key | The token being the key meant one non-revocable secret forever for archives, medical columns and every stored credential — and rotation *worse* than useless, because re-encryption cannot reach `.stbak` files already written, leaving two permanently critical secrets and no protection for archives a departing administrator already holds. Two levels make rotation real and confine a leaked archive to itself | Two unwrap steps and a deliberate Argon2id delay on every restore. Losing the token still loses the data — F-24 stands unchanged | `14-…` §2 |
| D-093 | The recovery token carries ≥128 bits of entropy, Crockford base32 with a check character, grouped for transcription. Every re-display is a high-severity audit event **and** notifies all `ORGANIZATION`-scoped administrators; the restore endpoint is rate-limited with lockout and failed attempts are audited | A "human-transcribable, printable" token with no stated floor invites shortening, which is silently catastrophic for key material and merely inconvenient for a passphrase over a KDF. Step-up alone protects nothing against the administrator who *is* the threat, and `07` §1.2's audit list does not mention re-display at all. The restore endpoint sits in the unauthenticated setup wizard and had no stated limit | A longer token to transcribe, and administrators receive notifications for a legitimate colleague's legitimate action | `14-…` §2.2 |
| D-094 | The application's database role is not a superuser — owner of its own schema only, `NOSUPERUSER NOCREATEROLE` — and the reference compose creates it that way. Stated as a non-negotiable image property alongside "runs as non-root" | Restore replays a dump produced elsewhere, and the reference compose's user is conventionally the superuser. The words "superuser" and "least-privilege database role" appeared nowhere in fifteen chapters. The role bounds every SQL-injection class in the product, not only this one | Operators pointing `DATABASE_URL` at a managed database must create the role themselves; the documentation must give the exact statements | `14-…` §4.2.1, `03-…` §1.2 |
| D-095 | The database export is a structured logical export the application writes and reads itself, not a raw `pg_dump` replayed by the database | It deletes the arbitrary-SQL-execution class entirely rather than filtering it, loses nothing the design relies on (D-046's `_prisma_migrations` trick carries as a manifest field), and removes a dependency on `pg_dump`/`pg_restore` binaries tied to a server version the operator controls | We own the export/import code, including every column type and every schema change. If v1 ships `pg_dump` anyway, §4.2.1's allow-list restrictions become mandatory rather than advisory, and `postgresql-client` must actually be in the image — it is not today | `14-…` §3.1, referenced from `03-…` §1.2 |
| D-096 | Every encrypted value is `v1:<keyId>:<nonce>:<ct>`, authenticated with AAD binding `(table, column, primary key, keyId)` | D-049 versioned the ciphertext *format* but not the *key*, and bound nothing to its location. Without a key id, a rotation interrupted at 60% leaves two keys in one column with no discriminator and every failed decrypt indistinguishable from corruption. Without AAD a `v1:` blob is portable — child A's encrypted allergy note copies into child B's row and decrypts perfectly | Longer envelopes, and every read site must pass its own `(table, column, pk)`. Caught at the call site rather than in a child's medical record | `13-…` §5.1 |
| D-097 | One `src/lib/crypto/envelope.ts` with a `DECRYPTORS` registry keyed by format version and a `CURRENT_FORMAT`; per-module files become thin purpose labels. A committed golden-vector test carries one entry per format ever shipped, under a fixed public test key | The template's `decryptSecret` throws on any format mismatch — one decryptor, no registry — so shipping `v2` makes every `v1` value unreadable, which is exactly what D-049 exists to prevent. There are also two independent copies of the file with different HKDF labels. D-049 had no enforcement mechanism at all; golden vectors make removing a decryptor break the build | A permanently growing vector file and legacy crypto code that can never be deleted. Both are the point | `13-…` §5.2 |
| D-098 | The boot states are six ordered predicates evaluated against one connection, and a sixth state `FAILED` is added: (1) `_prisma_migrations` absent and zero other tables → EMPTY; (2) a recorded `migration_name` not in the image → AHEAD; (3) any row with `finished_at IS NULL` or `rolled_back_at IS NOT NULL` → FAILED; (4) no `InstallationBootstrap` with `completedAt` → PARTIAL/TAMPERED; (5) an image migration missing from `_prisma_migrations` → EXISTING; (6) otherwise CURRENT. `migrate status` exit codes are not used | D-055 named states without giving any predicate, for code the design itself calls security- and data-critical. `FAILED` exists because the claim that a failed migration "leaves the database at its pre-migration state" is untrue with Prisma: the failed migration stays recorded and blocks every later one (the P3009 class `migration-safety.test.ts` was written for), so the container otherwise crash-loops with no indication that the fix is `migrate resolve` plus the named backup | Six states rather than five, and the entrypoint reads a Prisma-internal table. D-046 already depends on that table for restore; the coupling is now stated rather than implicit | `13-…` §6.1 |
| D-099 | Setup mode requires **all** of: no bootstrap record, zero `UserAccount`, zero `Person` and zero `RoleAssignment` rows. Data present with the bootstrap record missing is `TAMPERED`: refuse to serve, log loudly, break-glass CLI only | The gate on the only unauthenticated administrative surface was the presence of one deletable row. Any primitive that deletes it — SQL injection, a compromised low-privilege credential, a botched restore, a support script, a bug in the erasure transaction — put a populated production database into unauthenticated setup mode, where "New installation" creates an `ORGANIZATION`-scoped administrator over thousands of children's records. D-039's self-destruct claim was false as specified | An operator genuinely resetting a populated instance must do it from the host rather than by deleting a row. `TAMPERED` is added to D-055's test matrix | `13-…` §6.2 |
| D-100 | The first-run record is `InstallationBootstrap`, not `PlatformBootstrap` | It kept the `Platform` prefix D-056 deletes alongside `PlatformSettings` and `PlatformRoleAssignment`, and it is the model the boot state machine reads on every start — the worst place for a name meaning something the architecture no longer has | One more rename in the extraction, on a single-row table | `13-…` §6.3 |
| D-101 | The setup token is written to `$DATA_DIR/setup-token` mode 0600 and only its *path* is printed. Single use, ≤60-minute expiry, reissued only via `splashtrack setup:token --new`. Submission is rate-limited with lockout and failures are audited | D-039's mitigation printed a bearer credential to the container logs while F-20 states as a design assumption that self-hosters paste logs into public issues — and the repository is public. Host access is the proof of ownership, which is the pattern the break-glass CLI already establishes. The same exposure exists via Portainer/Synology/Unraid panes and centralised log shipping | The operator needs filesystem access to the data volume rather than a `docker logs` scroll — one extra command, of the class they already need for break-glass | `13-…` §6.3 |
| D-102 | The archive uses a framed AEAD construction (libsodium `secretstream` or `age`) with per-chunk sequence numbers and an explicit final-chunk marker; the manifest is a separate AEAD message bound to the archive's data key, verified before any parsing; nonces are random per archive and never reused | "AES-256-GCM" over a streamed multi-gigabyte archive reads as safe and is not: GCM is not a streaming construction, so an implementation either buffers the whole archive or encrypts chunks independently — in which case truncation, reordering and cross-archive splicing all verify. Parsing the manifest before authentication is acting on attacker-controlled data, compounding D-094/D-095 | A named external construction rather than raw primitives, and a dependency on its availability in Node. Per-archive data keys make the nonce policy automatic | `14-…` §3.1 |
| D-103 | v1 writes backups to a mounted volume only — no S3 destination — and a change of backup destination or its credentials is equal in severity to a download: step-up, high-severity audit, notification to every `ORGANIZATION`-scoped administrator, and a 24-hour delay or second-administrator approval before the first backup reaches a new destination. The current destination is shown permanently on the dashboard beside the backup-age indicator | S3 does not exist to scope in: `blob-storage.ts` supports only `"local"` and throws otherwise, and there is no S3 client in `package.json`. And a destination setting without the download's controls is a complete nightly exfiltration channel behind a text field — D-042 guards the button while the uncontrolled path sits next to it | Off-site backup becomes the operator's job in v1 (`rclone`/`restic`/NAS), and the installation documentation must say so rather than leaving a checkbox implying we did it | `14-…` §3.2 |
| D-104 | Pre-migration backups are deleted after the next successful start, at most three retained. Backup retention may not exceed the shortest special-category retention, or the mismatch is a diagnostics warning naming both figures. A computed "backup horizon" is published in diagnostics, in the privacy screen and at the moment of erasure | "Retained for a configurable number of upgrades" was no maximum, no policy and no expiry trigger, on the same volume under the same key — set against `02` §5.3's unqualified promise that special-category data is hard-deleted at 12 months. A parent requests erasure, the school reports the note deleted, and it survives in up to 13 archives plus an unbounded snapshot set | An operator wanting a long backup history against a short erasure period must choose one and record why. `01` §5 needs a `pre-migration backup` data class with this trigger and cap — flagged, not edited here | `14-…` §5.2 |
| D-105 | The release workflow's final step boots the just-built image against scratch Postgres, seeds a deterministic fixture, backs it up under a fixed **public** test key and uploads it as a GitHub Release asset. The matrix job lists releases ≥ `minimumRestorableVersion` via the Releases API and asserts: `migrate status` clean; `prisma migrate diff --from-schema-datamodel --to-schema-datasource` empty; per-table row counts against the manifest; every `Person` readable; every award resolving to a non-superseded result; **every encrypted column decrypting to known plaintext**; **an enrolled TOTP still verifying**; the audit chain verifying | D-047 named no fixture source, generator, key, storage or definition of "domain invariants", and at v1.0 there are zero prior releases — so the matrix would be green while protecting nothing, yet fixture generation must ship in v1.0 or v1.1 can never test restore from v1.0. Release assets rather than commits, because the repository already never squashes migrations. The two bolded assertions are the case F-25 called "the nastiest" and then omitted from the very test meant to cover it | Fixtures live outside the git tree, so restoring an old release depends on the Releases API being reachable in CI | `14-…` §4.3.1 |
| D-106 | D-038 stands for every setting except identity providers, which are marked *requires a spike before being treated as decided*. The mechanism specified is a versioned `getAuth()` holding `{version, instance}` against a `settings_version` counter row bumped by every settings write | The design's worked example was factually inverted: the template's own comment at `src/lib/auth/auth.ts:507-509` says the Entra configuration is read once at auth-context construction and applies only on the next restart. `export const auth = betterAuth({...})` is a module-level singleton across several Next.js workers, and `genericOAuth` takes a static config array at construction while routing callbacks on `/api/auth/callback/:providerId` | One decision stays open into the build. If the spike fails, identity providers become the single named exception to the no-restart rule and the UI must say so at the point of saving | `13-…` §4.1 |
| D-107 | The backup schedule is `intervalHours` plus a run window, not a cron expression | `backup.schedule.cron` was specified against a job runner with no cron in it: `MaintenanceJob` is interval-based (`intervalMinutes`), and there is no cron parser or cron dependency in the repository. Adding one to a data-critical path — where a misparsed expression means backups silently stop — buys expressiveness nobody asked for | "Every Sunday at 03:00" is not directly expressible; `intervalHours: 24` with a night window is what operators actually mean | `14-…` §7 |

---

## Findings

### F-50 — `SECRET_KEY` had four lifecycles and does not exist in the template
**Severity: critical.** `13` §3.1 made it an operator-supplied environment
variable; `03` §1.2 said secrets are "generated on first run and written to the
data volume"; `13` §6.1 showed the wizard displaying it; `14` §2 said the
recovery token **is** it while the diagram beside it said the token **wraps** it.
Four descriptions, four failure modes, on the key that gates every backup restore
and every encrypted medical column. And the template has no `SECRET_KEY` at all:
at-rest encryption derives from `BETTER_AUTH_SECRET`, which also signs sessions
and encrypts TOTP secrets — so identifying the two prints a session-forging key
on paper, and separating them makes every restored TOTP enrolment silently dead
while MFA is mandatory for administrators.
**Response.** D-090 states the lifecycle **once**, in `13` §3.1.1: one bootstrap
secret supplied via `SECRET_KEY_FILE`, every other key derived by HKDF with a
purpose label, including the Better Auth signing secret so restore reproduces it
identically. `03` §1.2's data-volume sentence is deleted rather than softened,
and `03` and `14` point at §3.1.1 instead of restating it.

### F-51 — The backup archive could contain its own decryption key
**Severity: critical.** `14` §3.1 captures the uploaded assets from `DATA_DIR`.
If key material also lived under `DATA_DIR` — as `03` §1.2 specified — and assets
were captured as a directory tree, the archive would ship with the key that
decrypts it. Every claim that the encrypted file is inert without the token, and
therefore "safe to store casually", would be false, and **nothing in CI would
detect it**.
**Response.** D-091: the application never writes key material to the data
volume (D-090), the backup writer excludes the key-material path explicitly, and
a CI test asserts that no shipped `.stbak` fixture contains it — by key bytes and
by file name.

### F-52 — Restoring a `.stbak` from anywhere else is arbitrary SQL execution
**Severity: critical.** Restore replayed a `pg_dump` produced elsewhere, and the
reference compose's database user is conventionally the superuser. "Superuser",
"least-privilege database role" and "restrict dump contents" appeared nowhere in
fifteen chapters. The attack is the documented recovery path: a volunteer posts
"my instance won't start", a stranger supplies a "known-good starter backup" plus
its token, and the dump contains `CREATE FUNCTION` / `COPY … FROM PROGRAM` /
`ALTER ROLE`. The verification step made it worse by sounding sufficient — it
checked the archive was *intact*, not *benign*, and both the checksum and the
manifest came from the same attacker-supplied file.
**Response.** D-095 makes the v1 export a structured logical export the
application writes and reads itself, which deletes the class rather than
filtering it. D-094 makes the application's database role non-superuser
regardless. If v1 nonetheless ships `pg_dump`, §4.2.1's allow-list
(`pg_restore --no-owner --no-acl --no-comments` into a fresh empty schema; tables,
indexes, constraints and sequences only; hard rejection of functions, triggers,
extensions, event triggers and `COPY … FROM PROGRAM`; abort, never skip) is
mandatory. The chapter now states plainly that an archive from any source other
than the operator's own instance is untrusted input.

### F-53 — Setup mode was keyed on one deletable row
**Severity: critical.** `PARTIAL (tables exist, no bootstrap record) → resume
SETUP MODE`, and "New installation" then creates an `ORGANIZATION`-scoped
administrator. Any primitive that deletes one row — SQL injection, a compromised
low-privilege credential, a botched restore, a support script, a bug in the
erasure transaction — puts a populated production database holding thousands of
children's records into an unauthenticated administrative surface. D-039's claim
that the wizard self-destructs once the first administrator exists was false as
specified: it self-destructed once a *row* existed.
**Response.** D-099: setup mode requires no bootstrap record **and** zero
`UserAccount`, `Person` and `RoleAssignment` rows. Data with the bootstrap record
missing is `TAMPERED` — refuse to serve, log loudly, break-glass CLI only — and
is added to D-055's test matrix.

### F-54 — The setup token went to the logs the design tells operators to publish
**Severity: critical.** D-039's race mitigation printed a one-time setup token to
the container logs. F-20, four chapters away, states as a design assumption that
*"self-hosters debugging a problem paste logs, screenshots and database rows"*.
The mitigation and the acknowledged behaviour are mutually exclusive, and the
repository is public. Variants: Portainer/Synology/Unraid log panes visible to a
household; centralised log shipping to a third party; log rotation destroying the
token so the operator cannot finish setup.
**Response.** D-101: write the token to `$DATA_DIR/setup-token` mode 0600 and
print only its path; single use, ≤60-minute expiry, reissued only from the host;
rate-limited with lockout and audited failures. Host access is the proof of
ownership, the same pattern §7's break-glass CLI already establishes. The
diagnostics page and the issue template both warn that logs and `DATA_DIR` may
contain a live setup token.

### F-55 — One key, forever, printed on paper, with rotation that made things worse
**Severity: high.** The recovery token *being* `SECRET_KEY` meant a single
non-revocable secret protecting the backup archive, every medical column and
every stored OAuth/SMTP credential — re-displayable in the UI. A volunteer who
photographs it in 2026 and leaves in 2027 decrypts any archive they obtain in
2029. Rotation was worse than useless: re-encryption touches the database and
cannot reach `.stbak` files already written, so afterwards the operator holds two
permanently critical secrets and the departing administrator's historical
archives are unprotected. No entropy floor was stated, and the restore endpoint —
in the unauthenticated setup wizard — had no rate limit.
**Response.** D-092 (two-level envelope; the token is an Argon2id passphrase over
a master key, per-archive data keys, rotation = re-wrap) and D-093 (≥128 bits,
Crockford base32 with a check character, re-display audited at high severity and
notified to all administrators, restore endpoint rate-limited and audited).

### F-56 — The `v1:` envelope had no key id and no AAD, and GCM was assumed to stream
**Severity: high.** Two distinct defects with the same root — the crypto was
described rather than specified.
*No key id:* a rotation interrupted at 60% leaves two keys in one column with no
discriminator, every failed decrypt indistinguishable from corruption, and
medical notes for an arbitrary subset of children permanently unreadable.
*No AAD:* a `v1:` blob is portable, so any SQL write primitive or careless
migration script can move child A's encrypted allergy note into child B's row,
where it decrypts perfectly and authenticates. A child with a severe nut allergy
is recorded as having none — the exact thing column encryption is assumed to
prevent.
*Streaming:* "AES-256-GCM" over a streamed multi-gigabyte archive either buffers
the whole archive or encrypts chunks independently, in which case truncation,
reordering and cross-archive splicing all verify; and the manifest was parsed
before the archive was authenticated.
**Response.** D-096 (`v1:<keyId>:<nonce>:<ct>` with AAD over
`(table, column, pk, keyId)`), D-097 (one envelope module with a decryptor
registry plus committed golden vectors, so removing a decryptor breaks the
build), D-102 (framed AEAD with sequence-bound chunks and a final-chunk marker;
manifest authenticated as its own message before any parsing; nonce policy
stated).

### F-57 — Chapter 03's "non-negotiable properties of the image" were false
**Severity: high.** The list stated *"all configuration via environment
variables"* — inverting the whole of chapter 13 — and *"migrations run
automatically on start"*, contradicting D-055 and D-044. An implementer reading
in order builds env-var configuration and a naive `migrate deploy && start`
before ever reaching chapter 13, for code the design itself calls security- and
data-critical. And **none of the six image properties actually hold**: verified
against the repository, the Dockerfile is a self-described "development/Sprint-0
image" — single-stage, `FROM node:22-alpine` undigested, `npm ci` with
devDependencies and the full source tree in the final layer, running as root.
`pg_dump` is absent although `14` §3.1 claimed the client tooling ships in the
image.
**Response.** The list is rewritten as **target properties with their current
status stated honestly**, in a table an implementer can read as a build list. The
configuration bullet becomes "bootstrap secrets only; all runtime configuration
is database-backed and edited in-app (D-036/D-037)"; the migration bullet points
at D-055 and D-098; D-094's non-superuser database role is added as a
non-negotiable property alongside "runs as non-root".

### F-58 — Scheduled remote backup was an unguarded exfiltration channel
**Severity: high.** D-042 wraps the download button in step-up, rate limiting,
high-severity audit and a single-use signed link — and then `backup.destination`
and `backup.s3.*` sat beside it as ordinary settings. A departing administrator
never touches the button: they point the destination at their own bucket and
every night the instance ships a complete copy of every person, every medical
note and every exam result, encrypted with a key the same UI will re-display to
them. The most controlled path guarded; the uncontrolled path a text field.
Compounding it, the destination does not exist: `blob-storage.ts` supports only
`"local"` and throws otherwise, and there is no S3 client in `package.json`.
**Response.** D-103: S3 out of v1 — mounted volume only, operator syncs it. When
a remote destination arrives it carries the download's controls in full, plus a
24-hour delay or second-administrator approval before the first backup reaches a
new destination, and the current destination is shown permanently on the
dashboard beside the backup-age indicator.

### F-59 — Backup retention contradicts the erasure promise
**Severity: high.** `02` §5.3 commits, without qualification, that
special-category data is "hard-deleted, never anonymised" at 12 months — while
backup retention is 30 days rolling plus one monthly for 12 months, and D-044's
pre-migration backups were retained "for a configurable number of upgrades" with
no maximum, no policy and no expiry trigger, on the same volume under the same
never-rotated key. A parent requests erasure, the school reports the medical note
deleted, and it is present in up to 13 archives plus an unbounded snapshot set.
An Article 15 response saying "deleted" would be wrong.
**Response.** D-104: cap pre-migration backups (delete after the next successful
start, keep at most three); require backup retention ≤ the shortest
special-category retention or surface the mismatch as a diagnostics warning
naming both figures; publish a computed **backup horizon** the organisation can
quote in its privacy notice, shown at the moment of erasure. `01` §5 needs a
`pre-migration backup` data class with this trigger and cap — flagged for that
chapter's owner, not edited here.

### F-60 — D-038's worked example asserted the opposite of what the template does
**Severity: high.** The design claimed `WebAppTemplate` "already loads Entra
configuration at auth-context init, so changing a provider rebuilds the auth
context rather than the container". The template's own comment at
`src/lib/auth/auth.ts:507-509` says the configuration *"is read once at
auth-context construction and so only applies on the next restart/redeploy"*.
`export const auth = betterAuth({...})` is a module-level singleton across
several Next.js worker processes, and the `genericOAuth` plugin takes a static
config array at construction while routing callbacks on
`/api/auth/callback/:providerId`, so provider ids must exist at init.
**Response.** The claim is corrected rather than quietly reworded, the mechanism
that would actually work is specified (versioned `getAuth()` plus a
`settings_version` counter compared per request or per TTL window), and D-106
marks D-038's identity-provider case as **requiring a spike** — add a
`genericOAuth` provider through the database and complete a sign-in without
restarting. If the spike fails, identity providers become the one named exception
to the no-restart rule and the UI says so at the point of saving.

### F-61 — Key rotation would silently un-enrol every administrator's second factor
**Severity: high.** `13` §5's re-encryption command can re-wrap our envelopes; it
cannot touch Better Auth's internal TwoFactor secrets, which the template
encrypts with `BETTER_AUTH_SECRET`. Rotating the key would therefore destroy
every administrator's TOTP enrolment at once, while MFA is mandatory for
administrators — a lockout of exactly the accounts that can fix it.
**Response.** D-090's HKDF split brings TOTP secrets under the same root, so
rotation covers them. `13` §5.3 now states in a table exactly which values
`key:rotate` touches and which it does not, and D-105 adds a restore-matrix
invariant asserting an enrolled TOTP still verifies after a restore with the same
token.

### F-62 — The restore matrix was unimplementable, empty at v1.0, and omitted the case F-25 called worst
**Severity: high.** D-047 named no fixture source, no generator, no fixture
encryption key, no storage and no definition of "domain invariants". Structurally
it is empty at v1.0 — zero prior releases — so it would ship green while
protecting nothing, and yet **fixture generation must ship in v1.0 or v1.1 can
never test restore from v1.0**. F-25 identified the encryption case as "the
nastiest" because it passes every schema check, then left it out of the test
meant to cover it.
**Response.** D-105 specifies generation (release workflow boots the just-built
image, seeds a deterministic fixture, backs it up under a fixed public test key,
uploads it as a GitHub Release asset — not a git commit) and the assertions,
including `prisma migrate diff --from-schema-datamodel --to-schema-datasource`
being empty as the real schema check, every encrypted column decrypting to known
plaintext, and an enrolled TOTP still verifying.

### F-63 — `zod` is not present in either repository
**Severity: medium.** The settings-registry design is "one Zod schema per
setting" and `05-technical.md`'s module template lists `validation/` as Zod
schemas, both written as though the dependency were inherited. It is in neither
`package.json`, and there are no imports of it anywhere.
**Response.** Stated plainly in `13` §3.2 as a build task rather than an existing
capability. It is a one-line addition, but it is load-bearing for the registry
and the same correction applies to `05-technical.md` — flagged for that chapter's
owner.

---

## Requirements raised against chapters I do not own

Stated here so they are not lost; **no edits were made to these files**.

| Chapter | Requirement | Source |
|---|---|---|
| `01-domain-model.md` §5 | Add a `pre-migration backup` data class with the trigger and cap from D-104, and reconcile the retention table with the published backup horizon | F-59 |
| `02-security-privacy.md` §5.3 | "Hard-deleted, never anonymised" needs the qualifier "from live storage; persists in encrypted backups until they age out", with the backup horizon named | F-59 |
| `07-operations.md` §1.2 | The authoritative audit list must include recovery-token re-display (high severity, notifies all administrators), backup-destination change, break-glass CLI invocation and failed restore-token attempts | D-093, D-103 |
| `07-operations.md` §2 | "Object storage — versioned, replicated" is a hosted-design assumption; assets live on a filesystem path and are captured inside the `.stbak` archive, with volume redundancy the operator's choice | consistency M-19 |
| `05-technical.md` §3 | `zod` is not present in either repository | F-63 |
| `06-delivery.md` §1 | "Config: env vars per environment" should read "Layer-1 bootstrap env vars per environment; all runtime settings database-backed (D-036/D-037)" | consistency M-17 |
| `09-decision-register.md` | D-038 needs its row amended to reference D-106 (spike required for identity providers); D-039, D-044, D-047 and D-049 rows need amendment pointers to D-101, D-104, D-105 and D-096/D-097 | — |
| `10-findings.md` | F-24 stands unchanged. F-25's response should point at D-105's two new assertions, which are the case it names as worst | — |
