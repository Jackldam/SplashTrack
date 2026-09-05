# 14 — Backup, Restore, Migration & Upgrade

> Added 2026-08-31 after Jack's requirement: *"makkelijk kunnen updaten,
> migreren, backuppen en restoren — het liefst vanuit de setup-pagina en in de
> admin-omgeving. Ik als beheerder heb een backup-file plus een token waarmee ik
> snel weer up-and-running ben."*

## 1. The requirement, and one hard limit

The requirement is right and it is the difference between software people trust
and software people abandon: an administrator must be able to take a backup,
keep it somewhere safe, and get a working instance back from it without a
consultant.

**The hard limit, stated up front:** a running application cannot restore the
database it is currently reading from, and a container cannot replace its own
image from the inside. Any design claiming otherwise is lying. So the split is:

| Operation | Where it happens | Why |
|---|---|---|
| **Backup** | Admin UI, on a running instance | Reading is safe |
| **Restore** | **Setup wizard**, on a fresh/empty instance | Cannot overwrite a database in use |
| **Migrate** | Automatically on start, **once the database state is known** (§6 of `13-…`) | Deterministic, forward-only; never on an ambiguous empty database |
| **Update** | One command by the operator; the app detects, warns and prepares | A container cannot pull its own image |

This matches what Jack asked for — restore *is* in the setup page — and it is
also the only arrangement that actually works.

---

## 2. The Recovery Kit

**Decision D-040 — Recovery is two artefacts: a backup file and a recovery
token. Both are required; neither is useful alone.** What makes that true on a
*fresh host* is specified in §2.3 (D-166) — as originally written it was false,
and the restore succeeded anyway.

```text
┌── splashtrack-backup-2026-08-31T0300.stbak ──┐   ┌── Recovery token ──┐
│  header: format, keyId,                      │   │  STK1-XXXX-XXXX-…  │
│    token-wrapped key record (§2.3, D-166)    │   │  ≥128 bits         │
│    wrapped data key                          │ + │  passphrase over   │
│  manifest (version, schema, counts, date,    │   │  the wrapped key   │
│    key fingerprint)                          │   │  record            │
│  logical export + uploaded assets            │   └────────────────────┘
│  framed AEAD, per-archive data key           │
└───────────────────────────────────────────────┘
```

**Reason.** A backup of this application is a complete copy of personal data
about children, including health notes. An unencrypted dump sitting on a NAS or
in a Dropbox folder is the most likely breach in the entire product. Encrypting
it means the file alone is inert — which makes it *safe to store casually*,
which in turn means operators will actually keep backups. Security that makes
the safe path the easy path.

### 2.1 The token is a passphrase, not the key

An earlier draft said "**the token is `SECRET_KEY`**", while the diagram beside
it said the token *wrapped* `SECRET_KEY`, and `13-…` §5 said secrets used a key
*derived from* it. Three schemes in two chapters. The lifecycle of `SECRET_KEY`
is now stated once, in `13-configuration-and-setup.md` §3.1.1 (D-112); this
chapter does not restate it. Finding **F-95**.

Making the token *be* the key was wrong on its own terms, independent of the
contradiction. One key, forever, would protect the backup archive, every medical
column and every stored OAuth/SMTP secret — printed on paper, re-displayable in
the UI, and with no revocation. A volunteer administrator who photographs it
during setup in 2026 and leaves in 2027 can decrypt any archive they obtain in
2029. And rotation would be **worse than useless**: re-encryption touches the
database and cannot reach `.stbak` files already written, so after a rotation the
operator must keep the *old* token for old archives and the *new* one for new
ones — two permanently critical secrets, and no protection whatsoever for the
archives the departing administrator can already read. Finding **F-100**.

**Decision D-114 — Two-level key envelope. A random 256-bit master key is
generated at setup and stored wrapped by a KDF over the printed recovery token.
Each archive carries its own random data key, wrapped by the master key and
stored in the archive header.**

```text
recovery token  ──Argon2id──▶  KEK  ──unwraps──▶  master key
                                                      │
                                                 unwraps per-archive data key
                                                      │
                                            framed AEAD over the archive body
```

- **KDF: Argon2id**, `m = 64 MiB`, `t = 3`, `p = 1`, 128-bit random salt stored
  beside the wrapped master key. Parameters are recorded in the wrapped-key
  record so they can be raised for new wraps without breaking old ones.
- **Rotation = re-wrap the master key under a new token.** Old archives stay
  readable, because their data keys are wrapped by the *same* master key. The
  token can genuinely be rotated when someone leaves, which is the entire point.
- **A leaked archive compromises one archive**, not the estate, because the data
  key is per archive.
- The master key is also derivable as `HKDF(SECRET_KEY, info="backup-master-v1")`
  for the bootstrap case (`13-…` §3.1.1), so a fresh install has a master key
  before any archive exists.
- **The wrapped-master-key record travels in the archive header**, not only in
  the database — salt, Argon2id parameters and the wrapped master key. Without
  this the restore sequence in §4.2 cannot run at all on a fresh host: the
  database that held the record is the database being restored. See §2.3.

**Reason.** Every property the Recovery Kit promises — printable, storable,
revocable when a volunteer leaves, safe to keep old archives — requires the
printed artefact to be a *passphrase*, not key material. This is the standard
shape and there is no reason to invent another.
**Trade-off.** Two unwrap steps on every restore and an Argon2id cost the
operator waits through (deliberately). Losing the token still loses the data —
that has not changed, and F-24 stands.

### 2.2 Token format, entropy and handling

**Decision D-115 — The recovery token carries ≥128 bits of entropy, is encoded
in Crockford base32 with a check character and grouped for transcription, and
every re-display is a high-severity audit event that notifies all
`ORGANIZATION`-scoped administrators.**

The previous specification stated a shape (`STK1-XXXX-XXXX-…`, "human
transcribable", "printable") and no entropy floor. That is the dangerous
combination: if the token had to encode a full 256-bit key it would run past
fifty characters and nobody would transcribe it correctly, so the pressure would
be to shorten it — and shortening key material is silently catastrophic in a way
shortening a passphrase over Argon2id is not. Making it a passphrase (D-114) is
what makes a transcribable length defensible. Finding **F-100**.

Handling rules, all of which were missing:

- Re-display under step-up **and** high-severity audit **and** notification to
  every organisation-scoped administrator. Step-up alone protects nothing
  against the administrator who is the threat; `07-operations.md` §1.2's audit
  list does not currently mention token re-display at all, and it must.
- The restore endpoint lives in the **unauthenticated** setup wizard. It is
  rate-limited with lockout, and failed attempts are audited. So is
  recovery-token entry generally.
- Diagnostics keeps the "recovery token acknowledged: yes/no" check (F-24) and
  adds the date of the last re-display.

### 2.3 The Kit as specified did not recover, and the restore did not say so

**This is the failure the whole chapter exists to prevent, reconstructed by the
fix that closed it once already.** D-112 makes `SECRET_KEY` the root of every
application key, including the one that encrypts medical columns and the one
that encrypts TOTP secrets. D-114 makes the *token* the root of the backup
envelope. D-040 then tells the operator the Kit is two artefacts. Compose them
on the day the Kit is for:

> The building floods. The operator holds the `.stbak` and the printed token —
> exactly what they were told to keep. They bring up a fresh container. It
> refuses to start without `SECRET_KEY_FILE` (§3.1.1 of `13-…`), so they run the
> documented `secret:init` and generate a **new** `SECRET_KEY`. They restore.
> The token unwraps the master key, the master key unwraps the data key, the
> framed AEAD verifies, `migrate deploy` is clean, **row counts match the
> manifest**, and §4.2 tells them they are done.

What they have is an instance in which every medical remark, pastoral note,
assessment remark and inquiry free text (the D-148 protected class) is
permanently undecryptable, every stored settings secret is dead, and every TOTP
enrolment fails against an instance where MFA is mandatory and not clearable
(D-150) — so it has also locked out every administrator it just restored.
Nothing failed. No chapter told the operator that `SECRET_KEY` was part of the
Kit; `13-…` §5.3 came closest and then sold the separation as a feature. This is
**F-135**, and it is D-049's own failure mode ("the restore *succeeds* and the
contents are quietly unreadable") arriving through a different door.

**Decision D-166 — The Recovery Kit stays two artefacts, because the archive
header carries a token-wrapped key record containing the master key **and**
`SECRET_KEY`; and a restore that cannot decrypt refuses instead of succeeding.**

Three parts, all required.

**1. The key record travels with the archive, wrapped by the token.**

```text
archive header
  └─ key record  ─── AEAD under KEK = Argon2id(recovery token, salt) ───┐
       salt, Argon2id parameters                                        │
       master key      (unwraps this and every archive's data key)      │
       SECRET_KEY      (the D-112 root: medical, settings, TOTP, auth)  │
       keyFingerprint  = HKDF(SECRET_KEY, info="key-check-v1"), 16 bytes│
                                                        cleartext ──────┘
```

The record is bound as AAD to the archive's manifest digest, so it cannot be
spliced from one archive into another. The fingerprint is the one field outside
the wrap: it is a one-way function of the key, it identifies *which* key an
archive needs without revealing it, and it is what §4.2 compares against the
running instance.

**2. D-113 is amended, not overridden.** Key material is still never in the
archive *in the clear*, the `DATA_DIR` key-material path is still explicitly
excluded from the asset capture, and the CI test still greps every shipped
fixture for the raw key bytes and the key file's name. What the header holds is
ciphertext under a KEK the archive does not contain. "The file alone is inert"
is unchanged; what changes is that the file *plus the token* is now sufficient,
which is what D-040 always claimed.

**3. The restore refuses rather than succeeds.** §4.2 gains a mandatory
**decryptability proof** before the restore is reported complete, and a hard
refusal when it fails — see §4.2.2.

**Reason.** The alternative — a third artefact — was considered and rejected.
It is the technically cleaner answer and it loses on the failure it creates: an
operator who must keep three things keeps two, and the one they drop is the one
with no printed sheet, no wizard acknowledgement and no diagnostics check. Jack's
requirement is verbatim *"een backup-file plus een token waarmee ik snel weer
up-and-running ben"*, and a design that quietly needs a third artefact does not
meet it — it just fails later and worse. Recovery must be possible with what the
product told the operator to keep.

**Trade-off, stated plainly because it is real.** Archive + token now yields
`SECRET_KEY`, and therefore the Better Auth signing key — so a holder of both can
forge sessions against a *live* instance, not only read the archive's contents.
That is a genuine increase over the previous (non-functioning) design. It is
accepted for three reasons: a holder of archive + token can already read every
medical note, exam result and stored secret in the school, so the marginal
capability is small; the token is revocable by re-wrapping (D-114), and the
re-wrap now covers the whole key record, so a departing volunteer's copy of **the
token** no longer opens the key record; and the alternative failure is total,
silent and permanent.

**What re-wrapping does *not* retire, stated because the previous wording
implied otherwise.** It said a departing volunteer's copy is *"genuinely
retired"*. That is true of a **token** holder and false of a **`SECRET_KEY`**
holder: the master key is also derivable as
`HKDF(SECRET_KEY, info="backup-master-v1")` (§2, `13-…` §3.1.1), so anyone who
has ever held `SECRET_KEY` derives the master key of every archive, including
archives written after a rotation, without touching the key record at all.
Re-wrapping changes which token opens the record; it cannot revoke a derivation
that bypasses the record. Recorded as **F-146**, which is open — the choice
between dropping the derivation, per-archive keys the instance cannot re-derive,
and accepting the boundary explicitly is a decision, not a repair.

**What this obliges elsewhere:**

- **Rotation.** `key:rotate` and token rotation both re-wrap the key record.
  Rotating the token re-wraps in place for the *live* instance; archives already
  written keep the old token, which is unchanged from D-114 and must be stated
  in the rotation command's output.
- **The wizard.** Step 4's acknowledgement text names what the token now
  recovers: the archive, and the instance's own key material. It still never
  displays `SECRET_KEY` (`13-…` §6.3).
- **Diagnostics.** Beside "recovery token acknowledged", the page reports
  whether the running `SECRET_KEY`'s fingerprint matches the fingerprint in the
  most recent archive — a custody check the operator can act on *before* the
  building floods.

---

## 3. Backup

### 3.1 On demand, from the admin UI

`Admin → Maintenance → Backup → Create backup now` produces one `.stbak` file:
a manifest, a database export, and the uploaded assets, streamed into an
encrypted archive. The manifest records application version, schema/migration
version, creation time and row counts per table — everything a restore needs to
refuse an incompatible file *before* touching anything.

**Decision D-095 — The database export is a structured logical export the
application writes and reads itself, not a raw `pg_dump` replayed by the
database.**

Restoring a `pg_dump` produced elsewhere is arbitrary SQL execution — see §4.2
and F-97. The honest comparison is short: a logical export deletes that entire
class of failure, costs nothing the design relies on (D-046's
`_prisma_migrations` trick carries perfectly well as a **manifest field**
recording the applied-migration list), and removes the need to ship and version
`pg_dump`/`pg_restore` binaries whose output format is tied to a server version
the operator controls. It is more code than shelling out to `pg_dump`, and it
must be kept in step with the schema. **The control that keeps it in step is
§3.1.1's round-trip test** (D-169) — this sentence previously named the restore
matrix (D-047), which has since moved out of v1, leaving the justification
resting on something that no longer runs.

**Reason.** The v1 choice should be the one where the dangerous case cannot be
expressed, not the one where it must be filtered. Filtering an attacker-supplied
dump (§4.2) is achievable but is a permanent allow-list to maintain against a
format designed to be expressive.
**Trade-off.** We own the export/import code, including every column type and
every future schema change.

#### 3.1.1 One mechanism, and the guard that keeps it honest

D-095's own risk paragraph named exactly one control — *"it must be kept in step
with the schema, which is exactly what the restore matrix (§4.3.1) tests on every
pull request anyway"* — and that matrix (D-047) was subsequently moved out of v1
(`00-overview.md` §3.5.1, `06-delivery.md` §2.1). The load was removed from under
the load-bearing sentence. Meanwhile §4.2.1 continued to specify the `pg_dump`
path to implementation depth behind an *"if v1 nonetheless"*, so two mechanisms
that differ by weeks of work and by which threat model applies were both
specified, and Phase 1 carried them as one bullet. Finding **F-138**.

**Decision D-169 — D-095 stands: the logical export is the v1 mechanism and the
only one. `pg_dump`/`pg_restore` is out of scope, not an alternative. The
schema-drift guard D-095 relied on is replaced by a round-trip test that needs
no prior release to exist.**

**Why the logical export and not the cheaper option.** The honest argument for
`pg_dump` is that D-095's threat — a stranger supplying a "known-good starter
backup" — needs a community of strangers, and D-162 makes v1 exactly one
deployment operated by its author. That argument fails on the thing this pass
exists to protect. **The archive format is written into every backup file from
the first one**, and D-048/D-049 oblige every later version to keep reading what
earlier versions wrote. Shipping `pg_dump` archives in v1 and switching to a
logical export in v2 means owning a `pg_dump` *reader* permanently, in the
version where untrusted archives actually arrive — which is strictly worse than
writing the logical export now. This is a format decision, and format decisions
are the retrofit-hostile class D-165 refuses to defer.

Two secondary reasons, both verified: `postgresql-client` is **not** in the
`Dockerfile` today, so the "cheap" option is not free; and `pg_dump`'s output
format is tied to a server version the operator controls, in a product whose
reference compose the operator may repoint at any managed PostgreSQL.

**The guard.** A **round-trip test**, part of the export/import work item rather
than a new CI gate: export a seeded database, import it into an empty one, and
assert row counts per table, **primary keys preserved exactly** (mandatory — the
D-096/D-167 AAD binds the primary key, so an importer that renumbers rows
produces a database whose every encrypted value fails to authenticate), every
encrypted column decrypting to known plaintext, and the audit chain verifying
against its checkpoints (D-168). It runs in the existing integration-test job,
which is already a blocking check, and it is the subset of D-047 that protects
what D-095 is worried about without needing a prior release to exist.

**Trade-off.** The export/import engine is real work — every Prisma column type,
and a per-release obligation to keep it in step — and Phase 1's *"backup,
restore and the recovery token"* bullet is therefore a larger item than the
`pg_dump` reading of it. That is a scope fact this decision makes visible rather
than one it creates; sizing it is `06-delivery.md`'s business, not this
chapter's.

**Decision D-102 — The archive uses a framed AEAD construction with per-chunk
sequence numbers and an explicit final-chunk marker; the manifest is
authenticated as a separate AEAD message before it is parsed.**

"AES-256-GCM encrypted" over a streamed multi-gigabyte archive was
under-specified in a way that reads as safe and is not. GCM is not a streaming
construction: a naive implementation either buffers the whole archive — which a
large instance cannot — or encrypts chunks independently, in which case an
attacker can truncate, reorder or splice chunks between archives and every
per-chunk tag still verifies. Finding **F-101**.

- Use a named framed construction — libsodium `secretstream` (XChaCha20-Poly1305)
  or `age` — with sequence-bound chunks and a final-chunk tag, so truncation and
  splicing fail.
- **Nonce policy:** random per archive, never reused. Per-archive data keys
  (D-114) give this for free, which is the second reason to have them.
- The manifest is a **separate AEAD message bound to the archive's data key**,
  verified **before any parsing**. Reading the manifest to drive the restore
  before the archive is authenticated is acting on attacker-controlled data, and
  it compounds §4.2 directly.

**Key material is never in the archive.** The writer excludes the key-material
path explicitly and CI asserts that no shipped `.stbak` fixture contains it
(`13-…` §3.1.1, D-113). Without that exclusion the archive would contain its own
decryption key and every "the file alone is inert" claim in this chapter would be
false with nothing failing. Finding **F-96**.

**Assets are files on a path, not an object store.** Uploaded assets live under
`DATA_DIR` (`13-…` §3.1) and are captured *inside* the encrypted archive. There
is no versioned, replicated object-storage tier in this product — that is a
managed-cloud assumption inherited from the hosted design, and `blob-storage.ts`
in the template supports only `"local"` and throws on anything else. Volume-level
redundancy is the operator's choice, and should be documented as such rather than
stated as our policy.

### 3.2 Scheduled, unattended

Configured in the settings registry, executed by the existing `maintenance` job
runner: frequency, retention count, and destination. Failures raise an admin
notification, because a silently broken backup schedule is worse than none.

**Decision D-103 — v1 writes backups to a mounted volume only. There is no
S3 destination, and a change of backup destination is treated as equal in
severity to a backup download.**

**No S3 in v1**, for two independent reasons.

The first is that it does not exist: `WebAppTemplate`'s `blob-storage.ts`
supports only `"local"` and throws on anything else, and there is no S3 client
in `package.json`. The design listed `backup.destination (volume | s3)` and
`backup.s3.*` as though a remote target were inherited. It is not. An operator
who wants off-site copies syncs the volume with the tool they already use —
`rclone`, `restic`, a NAS job — which is better software than we would write,
already has their credentials, and keeps three secrets out of our settings
registry.

The second is the reason it must *stay* out until the controls exist. D-042
correctly wraps the download button in step-up, rate limiting, high-severity
audit and a single-use signed link — and then a destination setting beside it
would have been an ordinary form. A departing administrator never touches the
download button: they point the destination at their own bucket, and every night
the instance ships a complete copy of every person, every medical note and every
exam result, encrypted with a key the same UI will re-display to them. The most
controlled path guarded, the uncontrolled path next to it a text field. Finding
**F-103**.

So when a remote destination does arrive, it carries the download's controls in
full:

- Step-up re-authentication, high-severity audit, and **mandatory notification
  to every `ORGANIZATION`-scoped administrator** on any change of destination or
  destination credentials.
- A **24-hour delay or a second administrator's approval** before the first
  backup reaches a new destination.
- The current destination shown **permanently on the dashboard**, beside the
  backup-age indicator (D-041), so a silent redirect is visible without anyone
  opening a settings page.

**Trade-off.** Off-site backup — the thing that survives the building burning
down — becomes the operator's job in v1, and we must say so plainly in the
installation documentation rather than leaving a checkbox that implies we did
it.

**Decision D-041 — The last-successful-backup age is surfaced on the dashboard
and in diagnostics.**
**Reason.** Backups fail quietly. An operator who thinks they have backups and
does not is in a worse position than one who knows they have none.
**Trade-off.** A nagging UI element. Worth it.

### 3.3 The download is a security event

**Decision D-042 — Downloading a backup requires step-up re-authentication, is
rate-limited, is audited at high severity, and is served via a short-lived
single-use signed link.**
**Reason.** The download button is, by construction, a one-click complete
personal-data exfiltration primitive. It is the single most dangerous UI element
in the application and must be treated as such rather than as a convenience.
**Trade-off.** Friction for a legitimate administrator. Correct friction.
Finding **F-23**.

---

## 4. Restore

### 4.1 Where

The **setup wizard**, on a fresh instance with an empty database — exactly where
Jack wants it. The wizard's first question becomes:

```text
   ┌─────────────────────────────────────────┐
   │  New installation                       │
   │  Restore from backup   ← file + token   │
   └─────────────────────────────────────────┘
```

### 4.2 What happens

```text
upload .stbak + paste recovery token
  → unwrap the key record (Argon2id over the token)     ← master key + SECRET_KEY
  → compare key fingerprints                            ← §4.2.2 (D-166)
       mismatch → STOP. Nothing is written. Offer key recovery.
  → unwrap this archive's data key
  → authenticate the manifest as its own AEAD message   ← before any parsing
  → authenticate the archive body (framed AEAD, D-102)  (fail → stop, nothing touched)
  → parse manifest, compare versions       (see 4.3 — old backups are
                                             restored then migrated forward)
  → restore into a freshly created empty schema (§4.2.1)
  → run any newer migrations forward
  → verify row counts against the manifest
  → PROVE DECRYPTABILITY                                ← §4.2.2 (D-166)
       any failure → the restore is reported FAILED, not complete
  → done: log in with your existing accounts
```

Nothing is written until authentication succeeds, so a wrong token or a corrupt
file costs nothing.

#### 4.2.1 A `.stbak` from anywhere else is untrusted input

**State this plainly, because the design previously did not: an archive from any
source other than the operator's own instance is untrusted input.** Restore was
specified as replaying a database dump produced elsewhere, and the reference
compose's database user is conventionally the superuser. The words "superuser",
"least-privilege database role" and "restrict dump contents" appeared nowhere in
fifteen chapters.

The attack is not exotic; it is the documented recovery path. A volunteer posts
"my instance won't start". A helpful stranger supplies a "known-good starter
backup" plus its token — the wizard's first question invites exactly this — and
the dump contains `CREATE FUNCTION`, `COPY … FROM PROGRAM` or `ALTER ROLE`,
executed as the database superuser. The result is code execution in the database
container and persistence via a trigger that survives every future migration.
The previous verification step made this worse by sounding sufficient: it checked
that the archive was *intact*, not that it was *benign*, and both the checksum
and the manifest came from the same attacker-supplied file. Finding **F-97**.

**Decision D-116 (amended by D-182 — the original wording was the precondition
D-182 forbids) — The runtime database role is not a superuser and **owns
nothing**. A separate, non-connecting `splashtrack_owner` role owns the schema
and every table in it; the runtime role holds `USAGE` on the schema plus DML on
the tables, `NOSUPERUSER NOCREATEROLE`, and `infra/provision-roles.sql` creates
the roles that way.**

**Why this changed, because the reasoning is the durable part.** D-116 as
originally written said the application role *"owns its own schema and nothing
else"*. Ownership was the whole problem: **an owner re-grants itself in one
statement**, so every revoke made against the runtime role — including D-149
part 2's `REVOKE ALL … ON "AuditEvent"` — is decorative while that role owns the
table it is revoked on. D-182 states the precondition and moves ownership to a
role with no password that nothing ever connects as. The implementation follows
D-182, not this section's original text: `src/lib/database/role-model.ts`
(`ALTER SCHEMA public OWNER TO <owner>` then `GRANT USAGE … TO <app>`) and
`infra/provision-roles.sql`, shipped and tested in phase 1.2. **The code was
right and this section was wrong**; the chapter is what moved.

The full role model — four roles, two credentials, what each holds and what it
deliberately does not defend against — is stated once in
`docs/adr/0002-database-roles-and-least-privilege.md` §7 and summarised in
`02-security-privacy.md` §3.2. This section states only the property the restore
path depends on, and does not re-enumerate the roles (D-134).

This is a non-negotiable property of what we ship, stated alongside "runs as
non-root" (`03-…` §1.2). It bounds the blast radius of *every* SQL-injection
class in the product, not only this one — and it is the reason the terms below
say *"a freshly created empty schema"* rather than the application's own.

**The dump-replay path is not built** (D-169). This chapter previously specified
it in full behind an *"if v1 nonetheless"*, which left two mechanisms specified
to implementation depth and one bullet of Phase 1 covering either. The restore
reads a logical export the application wrote and validates every value against
the schema it already owns; there is no SQL to filter, because there is no SQL.

Recorded for the day someone proposes it again — these are the **terms**, not a
specification: custom format only, `pg_restore --no-owner --no-acl
--no-comments` into a freshly created empty schema; an allow-list of object
types (tables, indexes, constraints, sequences) enforced by inspecting the
archive's table of contents rather than by grepping SQL, with anything outside
it aborting rather than being skipped; and `postgresql-client` actually present
in the image, which it is not today. Reintroducing the path means meeting all of
them and superseding D-169.

#### 4.2.2 A restore that cannot decrypt refuses (D-166)

The previous verification step was *row counts against the manifest*. Row counts
prove that rows arrived. They prove nothing about whether their contents can
still be read, which is the only failure mode that is both silent and permanent.
Two checks replace it. Neither is optional and neither may be skipped by a flag.

**Before anything is written — the fingerprint gate.** The key record's
`keyFingerprint` is compared against `HKDF(running SECRET_KEY, "key-check-v1")`.
On a mismatch the restore **stops with nothing written** and offers the one
useful action instead of a lecture:

```bash
docker compose run --rm app splashtrack secret:recover \
    --file backup.stbak --token STK1-… --out ./secrets/secret_key
```

which unwraps the archive's `SECRET_KEY` with the token, writes it to the named
path at mode 0600, prints nothing of the key itself, and tells the operator to
mount it as `SECRET_KEY_FILE` and restart. The restore is then re-run and the
fingerprints match. This is why the key record is in the header: without it this
command cannot exist and the mismatch is terminal.

The gate is a refusal, not a repair: the application never silently adopts a key
from an uploaded file, because §4.2.1 makes an archive from any other source
untrusted input, and a restore that installs an attacker's key material would be
the worst version of that.

**After the restore — the decryptability proof.** Before the wizard reports
success it decrypts, through the ordinary application read path and the D-096
envelope:

| Proof | Why this one |
|---|---|
| One row per encrypted **column** in the schema, chosen as the newest non-null value | Covers every `(table, column)` AAD binding actually in use — the check D-167 exists to protect |
| Every stored settings secret decrypts and its `secretSet` flag agrees | A dead SMTP password is invisible until the night a notification matters (`02-…` §1.2 leans on notification for five separate controls) |
| Every `UserAccount` with an enrolled TOTP factor: the stored secret decrypts and a token generated from it verifies | MFA is mandatory and not clearable (D-150). A restore that lands with dead second factors has locked out the people it restored |
| The audit chain verifies against its checkpoints | `02-…` §3.2 (D-168) |

Any failure means the restore is reported **FAILED**, names the class that could
not be read, and leaves the instance in the boot state machine's `TAMPERED`-free
equivalent of "restored but not serviceable": it refuses to open the application
and offers the same `secret:recover` path. A partially readable school is not a
recovery, and telling the operator so at minute five is the entire value of the
Kit.

**D-105's fixture assertion is restated accordingly.** It read *"an enrolled
TOTP still verifies — against the same recovery token"*, which asserts against
the wrong root: per D-112 the TOTP key derives from `SECRET_KEY`, not from the
token, so as written the assertion either passes vacuously (one `SECRET_KEY`
throughout the workflow) or tests something the production path does not do. It
now reads: **restore under a freshly generated `SECRET_KEY` and assert the
documented outcome** — the fingerprint gate refuses, `secret:recover` succeeds,
and the second pass decrypts. That is the case the operator will actually hit.

### 4.3 Restoring an OLD backup into a NEW version — the core promise

**This is a first-class, tested requirement, not a convenience.** An operator
holding a two-year-old backup must be able to pull the *current* image, restore
that file, and be running. They must never be told "first install v1.0, restore,
then upgrade to 1.1, then 1.2…". That instruction is how self-hosted products
lose people's data.

**Decision D-046 — Restore writes the old schema first, then migrates forward.
The order is restore → migrate, never migrate → restore.**

```text
fresh container (v2.4)   +   backup taken on v1.0
        │
        ├─ 1. empty database, NO migrations applied yet
        ├─ 2. restore the dump  → database is now v1.0 schema + v1.0 data
        │                         (including the _prisma_migrations table)
        ├─ 3. run `migrate deploy`
        │      Prisma reads _prisma_migrations, sees which of the ~140
        │      migrations already ran, applies only the missing ones in order
        ├─ 4. verify: schema matches v2.4, row counts match the manifest
        └─ 5. running, with the operator's original data and accounts
```

**Reason.** The dump carries its own schema *and* Prisma's `_prisma_migrations`
table. That table is what makes "I see this is v1.0 and I am v2.4" a **fact the
database states**, not a version string we have to trust or guess from. The
migration runner then does exactly what it does on any ordinary upgrade — there
is no special restore-migration path to keep correct, which is precisely why it
can be relied on.

**Trade-off.** The restore step must run before any migration, so the entrypoint
cannot be a naive `migrate deploy && start`. It carries the small state machine
in `13-configuration-and-setup.md` §6 (D-055), which is itself data-critical code
and is covered by a test matrix with one case per state.

### 4.3.1 What this obliges us to do — the actual cost

The promise is easy to state and easy to break silently. Three commitments make
it real:

**Decision D-047 — CI tests restore from **every supported release** into
`HEAD` — that is, every release at or above `minimumRestorableVersion` (D-048),
not merely the previous one.**

A matrix job: for each such version, restore a stored seeded backup of it into
the current build, apply migrations, and assert the schema and a set of domain
invariants. Releases below the floor are not tested because they are not
supported — the floor is the honest boundary of the promise, and the restore
path refuses them with a message naming the intermediate version required. A migration that breaks restoring from v1.3 fails the
build on the day it is written — not two years later on a stranger's server.

**Reason.** "Skipped versions are supported" is worthless as a sentence in a
document. It is only true if a machine checks it on every pull request.
**Trade-off.** The matrix grows with every release and eventually needs pruning
(§4.3.2). Both are cheap next to the failure they prevent.

**As previously written, D-047 was not implementable, and at v1.0 it protects
nothing.** It named no source for the fixtures, no generator, no fixture
encryption key, no storage, and no definition of "domain invariants" — and
structurally, at v1.0 there are zero prior releases, so the matrix is green while
asserting nothing. The trap is that **fixture generation must ship in v1.0 or
v1.1 can never test restore from v1.0**. Finding **F-107**.

**Decision D-105 — The release workflow generates the restore fixture; the
matrix consumes it from GitHub Release assets, not from the repository.**

*Generation — the final step of every release workflow:*

1. Boot the just-built image against a scratch PostgreSQL.
2. `seed --fixture=restore-matrix` — deterministic: same ids every time, every
   table non-empty, at least one encrypted column and one enrolled TOTP factor.
3. Take a backup with the fixed **public** `RESTORE_FIXTURE_KEY` — public
   deliberately, because F-19 forbids credentials in fixtures and a fixture key
   protects nothing worth protecting.
4. Upload the `.stbak` as a **GitHub Release asset**. Not a git commit: this
   repository already never squashes migrations (D-048), and adding a database
   dump plus assets per release, forever, to the same tree is how it becomes
   unclonable.

*The matrix job* lists releases at or above `minimumRestorableVersion` via the
Releases API, restores each into `HEAD`, migrates, and then asserts:

| Assertion | How |
|---|---|
| Migration state clean | `migrate status` reports no pending or failed migration |
| **Schema genuinely matches** | `prisma migrate diff --from-schema-datamodel --to-schema-datasource` produces **empty** output. One command; this is the real schema assertion, and it replaces the vague "assert the schema" |
| Row counts | Per table, against the manifest |
| Every `Person` readable | Full read of each row through the application's own repositories |
| Every award resolves | Each `Award` resolves to a non-superseded `ExamResult` (D-062) |
| **Every encrypted column decrypts to known plaintext** | Fixture plaintexts are known; compare (D-096) |
| **An enrolled TOTP still verifies** | **Restore under a freshly generated `SECRET_KEY`** and assert the §4.2.2 outcome: the fingerprint gate refuses, `secret:recover` succeeds, the second pass verifies. Stated once in §4.2.2 (D-166); this row does not restate it |
| Audit chain verifies | Segment walk against checkpoints (`02-…` §3.2, D-168) |

The two rows in bold are the ones F-25 called "the nastiest" case and then left
out of the very test meant to cover it: a restore that succeeds while the
*contents* are unreadable passes every schema check there is.

`minimumRestorableVersion` is declared in the release manifest and compared as a
semantic version, with pre-release tags excluded from the matrix.

**Decision D-048 — Migration chains are never squashed within a major version,
and every release declares a `minimumRestorableVersion`.**

Squashing migrations is the standard way this breaks: it feels like tidying, and
it silently strands everyone whose data predates the squash. If a chain ever
*must* be collapsed, it happens only at a major-version boundary, the new
major's `minimumRestorableVersion` is raised, and the release notes say plainly:
"restoring a backup older than X requires intermediate step Y."

**Trade-off.** The migration folder grows monotonically and will look untidy.
Untidy is not a problem; unrestorable data is.

**Decision D-049 — Encrypted values carry a format version, and decryptors for
every previously shipped format are retained.**

A backup contains ciphertext: encrypted secrets, encrypted medical columns. If
the encryption scheme is ever changed or strengthened, v2.4 must still be able
to read v1.0's ciphertext — otherwise the restore "succeeds" and the data is
quietly unreadable. So every encrypted value is stored with an envelope
(`v1:…`), new writes use the current format, and old formats stay decryptable
until a major boundary re-encrypts them during migration.

**Reason.** This is the failure mode that would not surface in a schema test at
all — the tables restore perfectly and the *contents* are gone. It has to be
designed in before the first release, because retrofitting an envelope onto
existing ciphertext is far harder.
**Trade-off.** A small amount of permanently retained legacy crypto code, and a
migration obligation at each major boundary.

**D-049 is extended by D-096 and D-097** (`13-…` §5.1, §5.2), which supply the
two things it was missing. The envelope is `v1:<keyId>:<nonce>:<ct>` with AAD
binding `(table, column, primary key, keyId)` — versioning the *key* as well as
the format, and binding a ciphertext to its location so it cannot be moved
between rows. And "decryptors are retained" becomes a **committed golden-vector
test** rather than a promise: one entry per format ever shipped, under a fixed
public test key, so removing a decryptor breaks the build. As it stands the
template's `decryptSecret` throws on any format mismatch and exists in two
divergent copies, which guarantees the exact failure D-049 was written to
prevent.

### 4.3.2 Compatibility rules, stated as a table

| Backup version vs running image | Behaviour |
|---|---|
| Older, ≥ `minimumRestorableVersion` | **Restore, then migrate forward. Supported, and tested in CI (D-047)** |
| Older, < `minimumRestorableVersion` | Refuse, naming the intermediate version needed. Only possible across a major boundary |
| Same | Restore directly |
| **Newer** | **Refuse**, naming the image version required |

**Decision D-043 (restated) — the application refuses to start against a schema
newer than itself, and refuses to restore a newer backup.**
**Reason.** Forward-only migrations make an older application on a newer schema
undefined behaviour that silently corrupts data. Refusing is recoverable in
seconds; corruption may surface months later.
**Trade-off.** An operator who accidentally pulls an older tag gets a container
that will not start — with an error naming the exact version they need.

### 4.4 Restoring onto a *running* instance

Not offered in the UI. It is available deliberately and awkwardly, from the host:

```bash
docker compose down app
docker compose run --rm app splashtrack restore --file … --token …
docker compose up -d app
```

Awkwardness is the feature — this destroys live data and should require intent
and host access, not a button in a browser.

---

## 5. Migration

Migrations run **automatically on container start for an already-initialised
installation**, forward-only, before the application accepts traffic. The
operator never runs a migration command.

They do **not** run on an empty or partially-initialised database: that state is
ambiguous (fresh install or the first minute of a restore) and is resolved by the
setup wizard first. The authoritative boot sequence is
`13-configuration-and-setup.md` §6 (D-055); this section describes only what
happens once the state is known.

**Decision D-044 (amended by D-104) — An automatic pre-migration backup is taken
whenever a start would apply migrations.**
**Reason.** The most dangerous moment in this product's life is a migration
against real data during an unattended upgrade. A snapshot taken automatically
at exactly that moment is the difference between a five-minute rollback and a
lost swim school.
**Trade-off.** Slower start on upgrade and disk usage. Both trivially cheaper
than the alternative. It can be disabled only by an explicit setting, which the
documentation advises against.

### 5.1 What actually happens when a migration fails

The previous text said the database "is left at its pre-migration state". **That
is not true with Prisma.** A failed migration **stays recorded** in
`_prisma_migrations` and blocks every later one — the P3009 class that the
template's own `tests/unit/migration-safety.test.ts` exists for. Without naming
that state, the container simply retries on every restart and the operator sees
an unexplained crash loop.

The container stops with a clear error, names the pre-migration backup in the
log, and the entrypoint recognises the condition as the **`FAILED`** state
(`13-…` §6.1, D-098): refuse to start, name the backup, and tell the operator
that recovery is `migrate resolve` or a restore — not another restart. It never
starts in a half-migrated state.

### 5.2 Pre-migration backups have a retention policy

"Retained for a configurable number of upgrades" was **no maximum, no policy and
no expiry trigger**, on the same volume, under the same key. Set against
`02-security-privacy.md` §5.3's commitment that special-category data is
"hard-deleted, never anonymised" at twelve months — and against a backup policy
of thirty days rolling plus one monthly for twelve months — the arithmetic is
uncomfortable: a parent requests erasure, the school reports the medical note
deleted, and it is present in up to thirteen archives plus an unbounded set of
pre-migration snapshots. Finding **F-104**.

**Decision D-104 — Pre-migration backups are deleted after the next successful
start and at most three are kept. Backup retention may not exceed the shortest
special-category retention period, and the resulting "backup horizon" is
published.**

- **Cap.** A pre-migration backup exists to make the *next* start recoverable.
  Once a start succeeds, its purpose is served: delete it, keeping at most three
  for the case of an operator upgrading repeatedly while debugging.
- **Ceiling.** The registry refuses a backup retention longer than the shortest
  special-category retention, or — where an operator has a documented reason to
  exceed it — surfaces the mismatch as a **diagnostics warning** naming both
  figures. Silently allowing the mismatch is what turns an Article 15 response
  into a false statement.
- **Backup horizon.** One computed figure — *"personal data may persist in
  backups for up to N days after deletion from live storage"* — shown in
  diagnostics and in the privacy screen, so the organisation can quote it in its
  privacy notice instead of guessing. The erasure confirmation UI states it at
  the moment of erasure.

The retention table in `01-domain-model.md` §5 needs a `pre-migration backup`
data class with this trigger and cap; that chapter is not edited here, but the
requirement is stated so it is not lost.

**Trade-off.** An operator who wants a long backup history against a short
erasure period must choose one and record why. That choice is the organisation's
to make; hiding it was ours to stop doing.

---

## 6. Upgrade

### 6.1 What the application can and cannot do

**It cannot update itself.** A container cannot replace its own image from
inside, and any mechanism that could would be a remote-code-execution path into
every self-hosted instance in existence — precisely the supply-chain risk F-18
warns about. We will not build that.

**What it does instead:**

| Capability | Where |
|---|---|
| Detect a newer release; warn loudly if the running version has a security advisory | Dashboard + diagnostics (D-034) |
| Show the release notes and any required operator action, in-app | Admin → Maintenance → Updates |
| **Pre-upgrade readiness check** — disk space, backup age, database reachable, no pending failed jobs | Admin → Maintenance |
| **Take a backup now**, one click, before you upgrade | Admin → Maintenance |
| Show the exact upgrade command for this installation, copyable | Admin → Maintenance |

```bash
docker compose pull && docker compose up -d
```

**Decision D-045 — The application prepares and verifies upgrades but never
performs them; the operator runs one documented command.**
**Reason.** It keeps the trust boundary intact (nothing in the container can
change what the container *is*), it works identically on every host, and one
command is not the part that makes upgrades scary — the fear is data loss, which
D-044 and §3 address directly.
**Trade-off.** Not literally one-click. Mitigated by making everything *around*
the command one-click, and by the honest observation that operators who want
automation already run Watchtower or a compose cron — which works unchanged
with this design.

### 6.2 Never strand a self-hoster

Restated from §2 of `03-deployment-model.md` because it is a backup concern too:
migration chains are never squashed within a major version, so an instance
upgraded once a year still migrates cleanly. Skipping versions is a supported
path, and CI tests it against a populated database.

---

## 7. What this adds to the settings registry

```text
backup.schedule.enabled          backup.schedule.intervalHours
backup.schedule.window           (e.g. 02:00–05:00 local)
backup.retention.count           backup.retention.days
backup.premigration.enabled      (default: true)
update.check.enabled             (default: true — D-034)
```

**Decision D-107 — the schedule is `intervalHours` plus a run window, not a cron
expression.**
**Reason.** `backup.schedule.cron` was specified against a job runner that has no
cron in it: `MaintenanceJob` is interval-based (`intervalMinutes`), there is no
cron parser and no cron dependency in the repository. Adding one to a
data-critical path — where a misparsed expression means backups silently stop —
buys expressiveness nobody has asked for. An interval plus "run between 02:00
and 05:00" covers every schedule a swim school will want.
**Trade-off.** "Every Sunday at 03:00" is not directly expressible. Accepted;
`intervalHours: 24` with a night window is what operators actually mean.

`backup.destination` and `backup.s3.*` are **not** in this list: v1 writes to a
mounted volume only (D-103), and a destination setting without the download's
controls is an exfiltration channel with a text field in front of it.

All live-applied (D-038), all audited, secrets encrypted (§5 of
`13-configuration-and-setup.md`).
