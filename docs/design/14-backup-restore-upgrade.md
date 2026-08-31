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
token. Both are required; neither is useful alone.**

```text
┌── splashtrack-backup-2026-08-31T0300.stbak ──┐   ┌── Recovery token ──┐
│  manifest (version, schema, checksum, date)  │   │  STK1-XXXX-XXXX-…  │
│  database dump                                │ + │  wraps SECRET_KEY  │
│  uploaded assets                              │   │  shown ONCE        │
│  AES-256-GCM encrypted                        │   │  printable         │
└───────────────────────────────────────────────┘   └────────────────────┘
```

**Reason.** A backup of this application is a complete copy of personal data
about children, including health notes. An unencrypted dump sitting on a NAS or
in a Dropbox folder is the most likely breach in the entire product. Encrypting
it means the file alone is inert — which makes it *safe to store casually*,
which in turn means operators will actually keep backups. Security that makes
the safe path the easy path.

**The token is `SECRET_KEY`** (§5 of `13-configuration-and-setup.md`), wrapped
in a checksummed, human-transcribable format. That is not a coincidence — the
same key already protects the encrypted secrets and special-category columns
*inside* the dump, so a restore needs it regardless. Making it explicitly "the
recovery token" turns a hidden dependency into a visible, printable artefact.

**Trade-off.** Lose the token and the backup is unrecoverable — genuinely,
permanently. This is a deliberate choice over a recoverable-but-weaker scheme,
and it obliges us to make losing it hard: shown at setup with a "print this"
step, an explicit confirmation that it has been stored, re-displayable later
under step-up authentication, and included in the diagnostics page as a
"recovery token acknowledged: yes/no" check. Finding **F-24**.

---

## 3. Backup

### 3.1 On demand, from the admin UI

`Admin → Maintenance → Backup → Create backup now` produces one `.stbak` file:
manifest, `pg_dump` output, and the uploaded assets, streamed into an encrypted
archive. The manifest records application version, schema/migration version,
creation time, row counts per table and a checksum — everything a restore needs
to refuse an incompatible or corrupt file *before* touching anything.

`pg_dump` runs from the app container against the database over the compose
network, so the client tooling ships in the image (§1.2 of
`03-deployment-model.md`).

### 3.2 Scheduled, unattended

Configured in the settings registry, executed by the existing `maintenance`
job runner: frequency, retention count, and destination — a mounted volume by
default, with an S3-compatible target as the one supported remote option.
Failures raise an admin notification, because a silently broken backup schedule
is worse than none.

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
  → decrypt and verify checksum            (fail → stop, nothing touched)
  → read manifest, compare versions        (see 4.3 — old backups are
                                             restored then migrated forward)
  → restore database + assets
  → run any newer migrations forward
  → verify row counts against the manifest
  → done: log in with your existing accounts
```

Nothing is written until decryption and verification succeed, so a wrong token
or a corrupt file costs nothing.

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
(§4.3.2), and seeded backup fixtures must be kept in the repository. Both are
cheap next to the failure they prevent.

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

**Decision D-044 — An automatic pre-migration backup is taken whenever a start
would apply migrations, retained for a configurable number of upgrades.**
**Reason.** The most dangerous moment in this product's life is a migration
against real data during an unattended upgrade. A snapshot taken automatically
at exactly that moment is the difference between a five-minute rollback and a
lost swim school.
**Trade-off.** Slower start on upgrade and disk usage. Both trivially cheaper
than the alternative. It can be disabled only by an explicit setting, which the
documentation advises against.

If a migration fails, the container stops with a clear error, the database is
left at its pre-migration state, and the pre-migration backup is named in the
log. It never starts in a half-migrated state.

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
backup.schedule.enabled          backup.schedule.cron
backup.retention.count           backup.destination (volume | s3)
backup.s3.*                      (endpoint, bucket, key id, secret)
backup.premigration.enabled      (default: true)
update.check.enabled             (default: true — D-034)
```

All live-applied (D-038), all audited, secrets encrypted (§5 of
`13-configuration-and-setup.md`).
