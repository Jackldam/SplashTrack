# 13 — Configuration, Setup & Administration

> Added 2026-08-31 after Jack's requirement: *"een organisatie moet een simpele
> manier hebben om met deze app te werken — een setup-pagina waar je alles kunt
> instellen zonder dat je Docker steeds hoeft te herstarten. Ook de configuratie
> moet volledig in de webapp te beheren zijn."*

## 1. The requirement, stated precisely

A self-hosted operator (D-012 final) must be able to install and fully
administer SplashTrack **through its own web interface**. Editing environment
variables, rebuilding an image or restarting a container must not be part of
normal administration.

This is a product requirement, not a convenience: the audience is a swim school
with limited IT capacity. If configuring email or SSO requires SSH and a
`docker compose down`, they will either not do it or do it wrong.

---

## 2. Prior art — how Vaultwarden does it, and what to take from it

Vaultwarden is the closest comparable: a self-hosted, open-source, single-org
application distributed as a container, aimed at operators who are not
full-time sysadmins. Its approach, verified from the project wiki:

| Aspect | Vaultwarden's approach |
|---|---|
| Admin surface | A separate `/admin` page, disabled unless an `ADMIN_TOKEN` is set |
| Admin authentication | The `ADMIN_TOKEN` itself **is** the password. A single shared secret, no user account |
| Session | Exchanging the token yields a JWT, default lifetime 20 minutes |
| Session revocation | **Not possible** — changing or removing the token does not invalidate issued JWTs. Only deleting `rsa_key.pem` invalidates them |
| Settings storage | Env vars, an env file, **or** a `data/config.json` written by the admin page |
| Live changes | Settings edited in the admin page apply without a restart |
| Project's own advice | **`config.json` is explicitly *not* recommended**; environment variables are the recommended method |

### 2.1 What to copy, and what to reject

**Copy the user experience.** A settings page inside the application, changes
applying immediately, and a diagnostics page showing effective values and where
each came from. That is exactly right and it is why Vaultwarden is pleasant to
self-host.

**Reject the authentication model, entirely.** A shared bearer token as the
admin password, in an environment variable, with non-revocable sessions, would
be a significant regression for SplashTrack — and unacceptable for an
application holding health data about children. We already have real user
accounts, MFA, passkeys, per-permission authorization, step-up re-authentication
and an audit trail. The settings page belongs behind *those*, not beside them.

**Reject the file-based store.** Vaultwarden writes `config.json` to a data
volume and then advises against using it — a telling contradiction. A file
inside a container needs a writable volume, drifts out of sync with the env
vars it overrides, is invisible to backups that only cover the database, and
has no transactional or audit story. **We have PostgreSQL.** Settings belong in
it: backed up with everything else, transactional, auditable, and readable by
the same code that reads everything else.

**Decision D-036 — Configuration lives in the database and is administered
in-app behind normal authentication; not in a file, not behind a shared token.**
**Reason.** As above: it inherits backup, transactions, audit and access control
for free, and avoids the shared-secret admin pattern that the closest comparable
project demonstrates the weaknesses of.
**Trade-off.** Settings cannot be read before the database is reachable, which
forces the small bootstrap layer described in §3. Accepted — that layer is
irreducible anyway.

---

## 3. The three configuration layers

The honest position is that **not everything can be in the database**, and
pretending otherwise produces a chicken-and-egg failure. Three layers, and the
first is kept deliberately tiny.

### 3.1 Layer 1 — Bootstrap (environment, restart required)

**Application-owned bootstrap variables** — the values the application must know
*before* it can read its own database, or that select where its own state lives:

```text
DATABASE_URL      where the database is
APP_URL           the public origin (also the WebAuthn relying-party origin)
SECRET_KEY_FILE   path to the file holding the bootstrap secret (§3.1.1)
DATA_DIR          uploads/assets path (optional, sane default)
PORT              listen port (optional, sane default)
```

That is the current set, not a quota. It may grow when a value genuinely meets
the criterion below, and it should stay small because few values do.

#### 3.1.1 `SECRET_KEY` — the single authoritative statement

**This subsection is the only place in the design that defines the lifecycle of
the bootstrap secret.** `03-deployment-model.md` §1.2 and
`14-backup-restore-upgrade.md` §2 point here and do not restate it. An earlier
draft gave four mutually exclusive accounts — an operator-supplied environment
variable (here), a value "generated on first run and written to the data volume"
(`03` §1.2), a value *displayed* by the wizard (§6.3 step 4), and the recovery
token itself (`14` §2, whose own diagram said it *wrapped* the key rather than
being it). Four descriptions, four failure modes. Finding **F-95**.

Worse, the design asserted a template capability that does not exist. Verified
against `WebAppTemplate`: **there is no `SECRET_KEY`.** At-rest encryption
derives its key from **`BETTER_AUTH_SECRET`** via HKDF-SHA256 with a per-module
`info` label (`src/modules/identity/infrastructure/secret-crypto.ts`, plus a
near-duplicate in `notifications` carrying a *different* label), and
`BETTER_AUTH_SECRET` **also signs sessions and encrypts TOTP secrets**. Both
readings of "is `SECRET_KEY` that value?" fail:

- **Same value** → the Recovery Kit prints the session-signing key on paper. A
  printed artefact that forges administrator sessions.
- **Different values** → a restore supplies `SECRET_KEY` while the fresh
  container holds a *new* `BETTER_AUTH_SECRET`, so every TOTP enrolment and
  every Better Auth-encrypted value in the restored dump is silently dead. MFA
  is mandatory for administrators, so the Recovery Kit fails at precisely the
  moment it exists for.

**Decision D-112 — There is exactly one bootstrap secret, `SECRET_KEY`. It is
the root of every key the application uses, including the Better Auth signing
secret, which is derived from it rather than configured separately.**

```text
SECRET_KEY  (32 random bytes, operator-held, supplied via SECRET_KEY_FILE)
   │
   ├─ HKDF-SHA256(info="auth-signing-v1")   → Better Auth signing secret
   ├─ HKDF-SHA256(info="totp-v1")           → TOTP secret encryption
   ├─ HKDF-SHA256(info="settings-secret-v1")→ SMTP / OAuth / registry secrets
   ├─ HKDF-SHA256(info="medical-v1")        → special-category column encryption
   └─ HKDF-SHA256(info="backup-master-v1")  → backup master key (14 §2, D-114)
```

**The five above are D-112's own branches. The vocabulary is not five, and this
section does not own it.** The authoritative list is `KEY_PURPOSES` in
`src/lib/crypto/secret-key.ts` — one exported, frozen array — and it currently
holds nine labels: the five above plus

| Label | What it derives | Decided in |
|---|---|---|
| `audit-anchor-v1` | The audit checkpoint MAC | D-168, `02-…` §3.2.1 |
| `relationship-evidence-v1` | `PersonRelationship.evidence` — *not* `medical-v1`, because guardian evidence is sensitive free text but not special category, and one branch for two lawful bases is the collapse `BETTER_AUTH_SECRET` performed one layer down | D-063, phase 1.1 |
| `setup-session-v1` | A MAC key for the setup wizard's short-lived cookie — a label of its own so a wizard cookie is not forgeable in Better Auth's session key space | D-101/D-187, phase 1.5 |
| `fixture-v1` | The committed golden vectors only; never a real column, and the registry sync test enforces that | D-097 |

**Why the list lives in code and this section points at it.** A label is
permanent: editing or removing one orphans every value ever written under it, so
the vocabulary is frozen against change and *additive* by design — a new
protected column adds a branch. A closed diagram in a chapter therefore goes
stale by the ordinary operation of the rule it describes, and it did: this tree
closed with `└─` after five labels while the code had nine, in a section headed
*"the single authoritative statement"*. **The rule this section owns is the
derivation** — one root, HKDF per purpose, the purpose recorded in the envelope.
**The list of purposes has one home and it is `KEY_PURPOSES`** (D-134).

Every application envelope uses `HKDF(SECRET_KEY, info=<purpose>)` and records
the purpose in the envelope itself (§5.1, D-096). Deriving the auth signing
secret means restore reproduces it **identically**, so sessions, TOTP enrolments
and Better Auth-encrypted values survive a restore — and it is not a second
variable an operator can get out of step.

**Reason.** One root, one thing to keep, one thing to lose. The alternatives
were a second secret nobody would keep in sync, or reusing the session-signing
key as a printable artefact.
**Trade-off.** Compromise of `SECRET_KEY` compromises everything derived from
it. That is already true of `BETTER_AUTH_SECRET` today; making the derivation
explicit at least makes the blast radius stateable, and the purpose labels mean
a future scheme can rotate one branch without touching the others.

**Supplied as a file, not an environment variable.** `SECRET_KEY_FILE` names a
mounted file or Docker secret; the application reads it at start and never logs
it. An environment variable is readable via `docker inspect`,
`/proc/<pid>/environ`, crash dumps and — most commonly — the operator's own
`docker-compose.yml` committed to a repository. A plain `SECRET_KEY` variable is
accepted as a deprecated fallback so an existing install is not bricked, and its
use raises a diagnostics warning.

**Generation.** The application never generates the bootstrap secret into
`DATA_DIR`. If `SECRET_KEY_FILE` is absent the container **refuses to start**
and prints the command that generates one:

```bash
docker compose run --rm app splashtrack secret:init --out ./secrets/secret_key
```

**Decision D-113 (amended by D-166) — Key material is never inside a backup
archive **in the clear**. The backup writer excludes the key-material path
explicitly, and CI asserts it.**

*The amendment, stated here because this is D-113's home:* `14-…` §2.3 (D-166)
puts a **token-wrapped** key record in the archive header, carrying the backup
master key and `SECRET_KEY`. That is ciphertext under a KEK the archive does not
contain, so every property below is unchanged — the exclusion of the `DATA_DIR`
key-material path, the CI grep for the raw key bytes and the key file's name,
and "the file alone is inert". What D-166 changes is that the file *plus the
token* now recovers the instance, which is what D-040 always claimed and could
not do.
**Reason.** `14-…` §3.1 captures the uploaded assets from `DATA_DIR`. If key
material also lived under `DATA_DIR` and assets were captured as a directory
tree, **the archive would contain its own decryption key** — and every claim
that the encrypted file is inert without the token collapses silently, with
nothing failing. That is why the "generated on first run and written to the data
volume" sentence is deleted from `03` §1.2 rather than softened. Finding
**F-96**.
**Trade-off.** The exclusion is a deny-list entry, which is the weaker shape; it
is backed by a test that greps every shipped `.stbak` fixture for the key bytes
and for the file name, so the check does not depend on remembering.

**Decision D-037 — Environment holds only what must be known before
the database is readable, or what selects where state lives. Everything else
belongs in the settings registry. Adding a variable requires an ADR stating why
it cannot live in the database.**

**Reason.** A hard numeric cap would be an arbitrary architectural rule that
could later block genuinely necessary pre-database or platform configuration —
a TLS trust store, a proxy, a read-only-filesystem path. The *criterion* is what
matters, not the count: if a value can be read from the database, it must be. A
self-hoster should still never have to grep a two-hundred-entry `.env.template`
to find why email is failing.

**Trade-off.** The rule requires judgement rather than counting, so it needs the
ADR gate to stay honest. Settings that conventionally live in environment
variables (SMTP host, log level) move into the database and therefore cannot be
changed while it is unreachable — acceptable, because if the database is down,
those are not the settings being fixed.

Separately, and **not** application-owned: standard runtime and platform
variables an operator may need (`TZ`, `NODE_ENV`, proxy settings, a custom CA
bundle, container resource limits). We document them where relevant but do not
own or invent them.

### 3.2 Layer 2 — Runtime settings (database, in-app, live)

Everything else. A typed registry defines each setting once:

```text
key            organization.name
category       Organisation | Email | Authentication | Security | Privacy |
               Appearance | Website | Integrations | Maintenance
type           string | number | boolean | enum | json | secret
default        the built-in value
validation     Zod schema
scope          instance-wide
appliesLive    true | false  (see §4)
permission     which permission may change it
sensitive      whether the value is encrypted and masked
class          free | bounded | invariant   (D-150)
```

**The `class` field is where the registry's "single source of truth for
validation" claim earns its keep** (D-150). `free` settings take any value the
Zod schema accepts. `bounded` settings carry hard floors and ceilings the schema
enforces and which `settings:reset` also respects — it clamps to the bound
rather than restoring an unbounded default. `invariant` settings are not
editable at all and have no override flag. The UI renders an invariant as a
**stated fact**, not a disabled control — a disabled control invites a support
question whose answer is "no".

**Which settings are in which class, and the bounds themselves, are stated once
in `02-security-privacy.md` §4.1 and §4.1.1 (D-150, D-171, D-173) and are not
restated here** (D-134). This paragraph previously carried a fourth normative
copy of the bounds list, and it silently omitted the absolute session lifetime —
the one value the other three copies disagreed about. Two corrections that
happened there are worth knowing while reading this chapter: `invariant` no
longer lists reach filtering, audit append-only or the `SELF` permission set,
because the registry cannot refuse a write to any of them; and backup retention
is `free` with a mandatory diagnostics warning rather than `bounded`, because
D-104 lets a documented reason exceed it, which is a warning and not a
ceiling.

**One registry constraint is not expressible as a floor, a ceiling or a Zod
schema, and it belongs here because this is where a settings write is
validated.** Any write in the `Authentication` or `Security` category is refused
if it would leave the installation without **at least one local
`ORGANIZATION`-scoped account holding a verified MFA factor** — checked against
the database at write time, not against the values being written, and
re-evaluated on every role revocation and account disable as well. This is
D-141's invariant; the reasoning for it, and why the "local login cannot be
disabled while it is the only method" formulation it replaced is unenforceable,
live in `02-security-privacy.md` §1.2.1 and are not restated here.

The registry is the single source of truth: it generates the admin UI, the
validation, the API surface, the documentation table, and the diagnostics page.
Adding a setting means adding a registry entry — never touching a form, a
migration and a docs page separately.

**One correction to a stated assumption:** `zod` is **not present in either
repository** — not in `WebAppTemplate`'s `package.json`, not in SplashTrack's,
and there are no imports of it anywhere. The design has described the registry
as "one Zod schema per setting" as though the dependency were inherited. It is
not. Adding it is a one-line change, but it is a build task rather than an
existing capability, and the same correction applies to `05-technical.md`'s
module template, which lists `validation/` as Zod schemas. Finding **F-108**.

### 3.3 Layer 3 — Organisation content

Branding, pages, skill catalogues, roles: already database-backed domain data
(§4 and §5 of `03-deployment-model.md`). Mentioned only to note it is *not* part
of the settings registry — content and configuration stay separate.

The rule governing what may live in the environment is stated once, in §3.1
(D-037). It is not restated here.

---

## 4. Applying changes without a restart

A settings service holds a cached snapshot with a version counter. A write
bumps the version; readers revalidate on next access. No restart, no
redeployment.

**Two categories of setting, made explicit rather than glossed over:**

- **`appliesLive: true`** — the overwhelming majority. Read per request:
  session timeouts, retention periods, email templates, branding, feature
  toggles, password policy, rate limits.
- **`appliesLive: false`** — settings consumed by an object constructed once at
  startup. These are re-applied by **rebuilding that object**, not by restarting
  the process. The identity-provider registry (D-035) is the intended worked
  example, and it is the one case where the mechanism does not exist yet — see
  §4.1.

**Genuinely restart-requiring settings are only those in Layer 1**, and the UI
says so plainly where relevant — for example, changing `APP_URL` alters the
WebAuthn relying-party ID and **invalidates every existing passkey**, which must
be a loud, confirmed warning rather than a silent save.

**Decision D-038 — Every setting is either live or explicitly rebuild-scoped;
"restart the container" is never the answer for a Layer 2 setting.**
**Reason.** It is the actual requirement. It also forces a healthier
architecture: no module may capture a setting in a module-level constant at
import time, which is a common source of stale-configuration bugs.
**Trade-off.** Settings must be read through the service rather than a constant,
which is marginally more verbose and needs a lint rule to enforce.

### 4.1 The identity-provider case, corrected

An earlier draft of this section said: *"`WebAppTemplate` already loads Entra
configuration at auth-context init, so changing a provider rebuilds the auth
context rather than the container."* **That is factually inverted.** The
template's own comment at `src/lib/auth/auth.ts:507-509` says the opposite —
the Entra login configuration *"is read once at auth-context construction and so
only applies on the next restart/redeploy"*. `export const auth =
betterAuth({...})` is a module-level singleton, Next.js runs several worker
processes, and there is no rebuild mechanism at all. The `genericOAuth` plugin
the design bets on takes a **static config array at construction** and routes
callbacks on `/api/auth/callback/:providerId`, so provider ids must exist at
init for routing to work. Adding a provider at runtime is not something the
plugin does today. Finding **F-105**.

The mechanism that would actually work, and which must be built:

```text
getAuth()  →  { version, instance }        (module-level cache, per worker)
                    │
  every request (or every TTL window):
    read settings_version  (one indexed row, cheap)
    version moved?  →  reconstruct the Better Auth instance, store new version
```

A `settings_version` counter row, bumped by **every** settings write, gives
cross-process invalidation via a cheap indexed read with no IPC. The same
counter serves the settings-service cache above.

**Decision D-106 — D-038 stands for every setting except identity providers,
which are marked *requires a spike before being treated as decided*.**
**Reason.** D-038's worked example rested on a template capability that does not
exist, and `genericOAuth`'s construction-time config array may make an instance
rebuild insufficient even with `getAuth()`. The spike is narrow and decisive:
add a `genericOAuth` provider through the database and complete a sign-in
**without restarting the container**.
**Trade-off.** One decision stays open into the build. If the spike fails,
identity providers become the single named exception to the no-restart rule, the
admin UI must say so at the point of saving ("this provider becomes active after
the next container restart"), and the release notes must say so too — rather
than the operator discovering it when sign-in silently uses the old
configuration.

---

## 5. Secrets and encrypted values in the database

SMTP passwords, OAuth client secrets, TOTP secrets and special-category columns
are all stored encrypted under a purpose-derived key
(`HKDF(SECRET_KEY, info=<purpose>)`, §3.1.1). Decryption happens server-side
only, and values are **never returned to any client** — the admin API exposes a
`secretSet: boolean`, never the value. That last part is the one piece
`WebAppTemplate` genuinely already implements, for the Entra client secret.

### 5.1 The envelope

**Decision D-096 (as corrected by D-167) — Every encrypted value is stored as
`v1:<keyId>:<nonce>:<ct>`, authenticated with AAD binding
`(columnId, primary key, keyId)`, where `columnId` is a stable logical
identifier and *not* the physical table and column name.**

D-049 versioned the ciphertext *format* but not the *key*, and nothing bound a
ciphertext to its location. Both omissions are load-bearing:

- **No key id.** A rotation interrupted at 60% — container restart, OOM, an
  upgrade — leaves two keys in one column with no discriminator. Both decryptors
  are present; neither knows which applies, and every failed decrypt is
  indistinguishable from corruption. Medical notes for an arbitrary subset of
  children become permanently unreadable, and the restore matrix would not catch
  it, because it asserts schema rather than plaintext.
- **No AAD.** A `v1:` blob is then **portable**. Anyone with a SQL write
  primitive — or a careless data-migration or de-duplication script — can copy
  child A's encrypted allergy note into child B's row, where it decrypts
  perfectly and authenticates. A child with a severe nut allergy is recorded as
  having none. Column encryption is assumed to prevent exactly this and, as
  previously specified, does not.

With a key id, rotation becomes **resumable and observable**: "how many rows
remain under `keyId=1`" is a query. With AAD, a relocated ciphertext fails to
authenticate. Finding **F-101**.

**Trade-off.** Envelopes get longer and every read site must pass its own
`(columnId, pk)`. That is a small, mechanical cost, and it is paid at the call
site rather than discovered in a child's medical record.

#### 5.1.1 What the AAD binds to, and what a migration must do

D-096 as first written bound the AAD to the **table and column names**. Two of
its four components are identifiers this design has already committed to
changing: D-159 makes every schema identifier English *"without exception"* and
OD-10's closure adds that chapters using Dutch terms as identifiers are
*"corrected when the module is written"*; D-100 renames `PlatformBootstrap` to
`InstallationBootstrap`; D-056 merges `PlatformSettings` — a table holding
settings-registry secrets, which D-096's own rotation table lists as encrypted —
into the organisation singleton. **Renames are scheduled, not hypothetical.**

A rename changes the AAD, so every existing ciphertext in that column fails to
authenticate — indistinguishably, by design, from the tampering the AAD exists
to detect. Neither mechanism that looks like it would catch this does:
`key:rotate` is keyed by `keyId` (§5.3), which a rename does not change; and
R-20 runs migrations unattended at container start, *after* the pre-migration
backup, so the backup holds ciphertext bound to the old names and the running
instance can read neither. An AAD failure on a medical note is silent data loss
wearing a corruption-shaped error message. Finding **F-136**.

**Decision D-167 — The AAD binds to a stable `columnId` from a committed
encrypted-column registry, never to the physical name. A migration that changes
the primary key of a row holding an encrypted value must decrypt and re-encrypt
that value inside the same migration.**

```ts
// src/lib/crypto/encrypted-columns.ts — the registry, one entry per column
{ columnId: "student.medical_remarks",   model: "StudentProfile", field: "medicalRemarks", purpose: "medical-v1" }
{ columnId: "settings.secret_value",     model: "OrganizationSettingSecret", field: "value", purpose: "settings-secret-v1" }
```

- **`columnId` is assigned once and never changes.** It is not derived from the
  model or field name; those are ordinary mutable columns of the registry entry.
  A rename edits `model`/`field` and leaves `columnId` alone, so no ciphertext
  is disturbed. A `columnId` is never reused for a different column, because
  reuse is precisely the ciphertext-portability D-096 exists to prevent.
- **The registry is bidirectionally test-enforced**, in the shape D-135 already
  adopts for `person-reference-sync.test.ts`: every registry entry resolves to a
  real model and field, and every field the schema marks as encrypted has an
  entry. A rename that forgets to update the mapping fails the build rather than
  the decryption.
- **The primary key stays in the AAD.** That is the binding that stops child A's
  allergy note being copied into child B's row, and it is not obtainable from
  anything stable-by-construction. The consequence is a rule, not a hope: **any
  migration that changes a row's primary key, splits a table, or moves an
  encrypted value to another row must decrypt with the old `(columnId, pk)` and
  re-encrypt with the new one, in the same migration.** This is added to
  `05-technical.md` §5 as rule 6, next to the retention-impact rule, because the
  PR description is where it will be checked.
- **A migration touching an encrypted column declares it.** The migration-safety
  test already blocks one class of unsafe migration; this adds a second
  assertion: a migration whose SQL names a model carrying a registered encrypted
  column fails unless the PR states which of the two cases it is (name-only, so
  nothing to do; or key-changing, so re-encryption is required and present).

**Reason.** The alternative — "state that renames must decrypt and re-encrypt" —
was the reviewer's other option and it is weaker for the same reason
deny-lists are weaker than structure: it makes correctness depend on every
future author remembering an obligation that only bites months later, on a path
that runs unattended at container start. Binding to an identifier that has no
reason to change removes the class. The re-encrypt rule is still stated, because
the primary key genuinely cannot be made immutable-by-construction, and one
narrow rule is enforceable where a broad one is not.

**Trade-off.** One more registry file that every encrypted column must be added
to, and a `columnId` vocabulary that is permanent — a typo in one is a name we
live with forever. Both are cheap next to a rename that reads as tampering.

### 5.2 One decryptor registry, and a test that enforces it

The template already stamps `FORMAT = "v1"` — good — but `decryptSecret`
**throws on any format mismatch**. There is one decryptor and no registry, so
the moment a `v2` ships every `v1` value becomes unreadable, which is precisely
the failure D-049 exists to prevent. There are also **two independent copies of
the file with different HKDF labels and separate `FORMAT` constants**
(`identity` and `notifications`), so a v2 rollout would have to happen twice,
consistently, with nothing enforcing it.

**Decision D-097 — One `src/lib/crypto/envelope.ts` holds a
`DECRYPTORS: Record<FormatVersion, Decryptor>` registry and a `CURRENT_FORMAT`.
Per-module files become thin purpose labels over it. A committed golden-vector
test carries one entry per format ever shipped.**

The golden vectors are `{format, purpose, ciphertext, expectedPlaintext}` under a
fixed **public** test key, committed to the repository. Removing or breaking a
decryptor breaks the build. That is what converts "we retain decryptors for
every previously shipped format" from a promise into a check — D-049 as written
had no enforcement mechanism at all.

**Trade-off.** A permanently growing vector file and a small amount of legacy
crypto code that can never be deleted. Both are the point.

### 5.3 What rotation actually touches

Consequences the documentation must state plainly:

- Losing `SECRET_KEY` means every encrypted value becomes unreadable and every
  secret must be re-entered. It is not recoverable from a **database** backup —
  a `pg_dump`-shaped copy of the tables — and it *is* recoverable from a
  SplashTrack `.stbak` archive plus the recovery token, which is precisely what
  makes the Recovery Kit two artefacts rather than three (`14-…` §2.3, D-166).
  That is the only recovery path; there is no escrow and no reset.
- A raw database copy without `SECRET_KEY` is therefore *safer* to move around.
  A `.stbak` is not in that category, and never was: it is protected by the
  token, not by the absence of key material. The rule is one sentence — **the
  token is what the archive's security rests on** — and it is why D-115 gives it
  an entropy floor and D-042 guards the download.
- Rotating `SECRET_KEY` requires the re-encryption command that ships with the
  image, and the command must state **exactly** what it covers. Rotation also
  re-wraps the key record carried in future archives (D-166); archives already
  written keep the key they were written with, and the command says so.

`splashtrack key:rotate` re-wraps, in one resumable pass per column, keyed by
`keyId`:

| Covered | Not covered |
|---|---|
| Settings-registry secrets (SMTP, OAuth client secrets) | `.stbak` archives already written — see `14-…` §2 (D-114), which is why the backup key is a *two-level* envelope and rotation there means re-wrapping the master key rather than re-encrypting archives |
| Special-category columns (D-013) | Nothing else. If a value is not in this table the command does not touch it, and the release notes must say so |
| TOTP secrets and Better Auth-encrypted values, **because §3.1.1 derives their key from `SECRET_KEY`** | — |

That last row is not a detail. Before D-112, Better Auth's internal TwoFactor
secrets were encrypted with an *independent* `BETTER_AUTH_SECRET` that our
re-encryption command could not reach — so rotating the key would have silently
un-enrolled **every administrator's second factor at once**, while MFA is
mandatory for administrators. The HKDF split is what makes rotation safe, and
the restore matrix carries an invariant asserting that an enrolled TOTP still
verifies after a restore (`14-…` §4.3.1). Finding **F-106**.

This is the same key-management question as OD-7 (special-category column
encryption); both are answered by one root key, one envelope and one documented
rotation path.

---

## 6. Start-up, setup, restore and migration — one sequence

This is the **authoritative boot sequence**. Chapter 14 describes backup and
restore mechanics; where the two appear to differ, this section defines the
order.

**Decision D-055 — The container never migrates a database whose purpose is not
yet known. State is detected first; migration is a consequence of that state,
never the first action.**

```text
container start
  │
  ├─ database reachable?            no → fail fast, clear error, do not retry blindly
  │
  ├─ inspect schema state
  │
  ├── EMPTY  (no tables at all)
  │     → SETUP MODE. No migrations are run yet.
  │       Every request redirects to /setup. The wizard asks the one question
  │       only the operator can answer:
  │
  │         ┌─ New installation
  │         │    → run migrations  → seed catalogue + starter roles
  │         │    → create first administrator, force MFA
  │         │    → write bootstrap record → serving
  │         │
  │         └─ Restore from backup
  │              → decrypt + verify archive (nothing written until this passes)
  │              → restore export: old schema + old data + migration history
  │              → run forward migrations from that point (D-046)
  │              → verify against manifest → serving with the original accounts
  │
  ├── PARTIAL  (no bootstrap record AND no person/account/role data)
  │     → setup was interrupted. Resume SETUP MODE; do not migrate silently.
  │
  ├── TAMPERED  (no bootstrap record, but data exists)
  │     → REFUSE TO SERVE. Log loudly. Break-glass CLI only (§7, D-099).
  │
  ├── FAILED  (a migration is recorded as unfinished or rolled back)
  │     → REFUSE TO START. Name the pre-migration backup (D-098).
  │
  ├── EXISTING  (tables + bootstrap record, schema older than app)
  │     → take automatic pre-migration backup (D-044)
  │     → run forward migrations → serving
  │
  ├── CURRENT  (schema matches app)
  │     → serving
  │
  └── AHEAD  (schema newer than app)
        → REFUSE TO START. Name the image version required (D-043).
```

**Reason.** An empty database is ambiguous: it is either a fresh installation or
the first minute of a restore. Migrating it immediately resolves that ambiguity
in the wrong direction — the operator then has a fully migrated empty schema and
a backup that no longer restores cleanly into it. Detecting state first makes the
two paths explicit and keeps restore a normal operation rather than a rescue.

**Trade-off.** The entrypoint cannot be a naive `migrate deploy && start`; it
carries a small state machine, and that state machine is security- and
data-critical code. It is therefore covered by its own test matrix, one case per
state.

### 6.1 The states, as decidable predicates

The diagram above describes intent; it does not tell an implementer how to
*decide* a state, and a state machine the design itself calls security- and
data-critical cannot be specified in prose. These predicates are evaluated **in
order, against one connection**, and the first that matches wins.

**Decision D-098 — The boot states are the following ordered predicates, and a
sixth state, `FAILED`, is added.** **(Extended by D-186: predicate 4 splits
three ways rather than two, adding `PENDING_ENROLMENT`.)**

| # | Predicate | State | Action |
|---|---|---|---|
| 1 | `_prisma_migrations` absent **and** zero other tables | **EMPTY** | Setup mode |
| 2 | `_prisma_migrations` holds a `migration_name` not present in the image's migrations directory | **AHEAD** | Refuse to start; name the version required (D-043) |
| 3 | Any row with `finished_at IS NULL` **or** `rolled_back_at IS NOT NULL` | **FAILED** | Refuse to start; name the pre-migration backup |
| 4a | No `InstallationBootstrap` row with `completedAt`, and the installation holds no `Person`, `UserAccount` or `RoleAssignment` row | **PARTIAL** | Setup mode |
| 4b | No completed record, data present, **an `InstallationBootstrap` row exists** with `completedAt` NULL, **and** the data is only what setup itself creates | **PENDING_ENROLMENT** (D-186) | Setup mode |
| 4c | No completed record, data present, and either of 4b's two conditions fails | **TAMPERED** — see D-099 as corrected by D-186 | Refuse |
| 5 | An image migration is missing from `_prisma_migrations` | **EXISTING** | Pre-migration backup (D-044) → `migrate deploy` |
| 6 | Otherwise | **CURRENT** | Serve |

**Eight states, seven predicates.** The enum is `BootState` in
`src/lib/boot/state.ts:72-80`, and the state → action mapping is the exported
`ACTION_BY_STATE` table beside it, so "which states may migrate" is one object a
test can assert over rather than a property inferred from whichever branches
happen to be written. `SETUP_MODE` is reachable from **three** states — `EMPTY`,
`PARTIAL` and `PENDING_ENROLMENT` — and `MIGRATE_THEN_SERVE` from exactly one.

**One reading predicate 4 needs and D-098 never stated.** Predicate 4 asks about
a *row* in `InstallationBootstrap`; it presumes the *table*. On a schema older
than the migration that creates that table the question is unanswerable, and
answering it "false" would classify every pre-`InstallationBootstrap`
installation as `TAMPERED` and refuse the upgrade predicate 5 exists for. So:
table absent **and** migrations pending ⇒ `EXISTING`. Table absent with nothing
pending falls through to the counts, because a schema claiming to be current
while missing a table this image's own migrations create is not a state to
migrate (`src/lib/boot/state.ts:436-460`).

**`FAILED` exists because a claim in `14-backup-restore-upgrade.md` §5 was
untrue.** That section said a failed migration leaves the database "at its
pre-migration state". With Prisma it does not: the failed migration **stays
recorded** and blocks every later one — the P3009 class that the template's own
`tests/unit/migration-safety.test.ts` was written for. Without this state the
container retries `migrate deploy` on every restart, fails identically, and the
operator sees a crash loop with no indication that the fix is `migrate resolve`
plus the named backup.

**Do not rely on `prisma migrate status` exit codes.** They are not a stable
API. The predicates above read the `_prisma_migrations` table directly, which is
a documented schema.

**Trade-off.** Six states rather than five, and the entrypoint reads a
Prisma-internal table. Reading it is already the mechanism D-046 depends on for
restore, so the coupling is not new — it is now stated.

### 6.2 Setup mode requires an empty installation, not a missing row

The previous specification keyed the only unauthenticated administrative surface
in the product on the presence of a **single row**: `PARTIAL (tables exist, no
bootstrap record) → resume SETUP MODE`, and the wizard's "New installation" path
then creates a first administrator with full `ORGANIZATION` scope.

Any primitive that deletes one row — SQL injection, a compromised low-privilege
database credential, a botched restore, a support script, a bug in the erasure
transaction — therefore puts a **populated production database holding thousands
of children's records into unauthenticated setup mode**. D-039's claim that the
wizard self-destructs once the first administrator exists was false as
specified: it self-destructed once a *row* existed. Finding **F-98**.

**Decision D-099 — Setup mode requires an empty installation, not a missing
bootstrap record. Data present with no completed record is not `PARTIAL`; it is
`TAMPERED` unless D-186's two conditions both hold.**

**Decision D-186 corrects D-099's predicate. The rule above is unchanged and is
not weakened.** Setup mode may open on a database holding data **only** when
both of these hold:

1. **The installation says setup started.** An `InstallationBootstrap` row
   exists with `completedAt` NULL. `setup:init` and `admin:create` write that
   row *before* either creates anything (`recordSetupStarted` in
   `src/lib/boot/setup-mode.ts`), so the row's **existence** is the record that
   first-run setup is under way. **No row at all with data present is still
   `TAMPERED`** — on a pending installation exactly as on a finished one, so the
   deletion primitive F-98 is about still fires.
2. **The data is only what setup itself creates.** Every `Person` has a
   `UserAccount`, every `RoleAssignment` names one of those people, and **no
   account holds an MFA factor**. That is byte-for-byte what `admin:create`
   leaves behind, and it is nothing like a running installation, where D-141
   requires a verified factor at all times and where the person rows are mostly
   children who will never have an account.

That combination is its own state, **`PENDING_ENROLMENT`**, action `SETUP_MODE`.
Anything else with no completed record is `TAMPERED`. `TAMPERED` refuses to
serve any request, logs at high severity, writes an audit event, and can be
cleared only from the host via the break-glass CLI (§7) — the same host-access
proof of ownership everything else in this chapter rests on. **The entrypoint
reads the STATE, not only the action**, so it can print the remedy that matches:
telling an operator to run `admin:create` when they have already run it is the
failure D-186 was written after.

**Why the predicate had to change, and it is not a softening.** D-099 was
written before D-185 existed, and there was then exactly one reading of "no
record, and data present": somebody removed the record to reopen the
unauthenticated setup surface. D-185 created a second, legitimate reading and
did not revisit this section. **Measured on the UAT instance on 2026-09-04:**
`admin:create` succeeded, leaving one person, one account, two grants and no
completed record; the container was restarted and refused to serve with *"the
installation holds data (1 person row(s), 1 account(s), 2 role assignment(s))"* —
the product refusing the one page that could finish its own install.

Condition 2 is what keeps this from being weaker than a single deletable row. An
attacker who can `UPDATE` — a strictly stronger primitive than the `DELETE` F-98
describes — cannot reopen setup mode by clearing `completedAt` on a real
installation: the enrolled factors and the unaccounted people are still there,
and they are not one statement to remove.

**And the serving path repairs the one state this cannot classify.** An
installation where D-141's invariant already holds but no record was written —
`verifyEnrolment` flips the factor and writes the record in two steps that
cannot be one transaction, because the flip belongs to Better Auth — has
`resolveSetupStage` write the record and answer `COMPLETE`, once, inside a
request.

**Reason.** The gate on an unauthenticated administrative surface must be a
property of the *installation*, not the presence of one deletable row. The
counts and lookups are cheap; they run once per boot.
**Trade-off.** An operator who genuinely wants to reset a populated instance to
factory state must do it deliberately from the host rather than by deleting a
row. That is the correct amount of friction. `TAMPERED` and `PENDING_ENROLMENT`
are both cases in D-055's test matrix alongside the states above.

**This section was rewritten on 2026-09-05 because the code was right and it was
not.** `src/lib/boot/state.ts:436-545` implements D-186; `src/lib/setup/gate.ts`
quoted this chapter back and noted it was stale. A source file that has to warn
the reader about the specification is the specification's problem.

### 6.3 The setup wizard

**The wizard is the primary first-run path and the break-glass CLI is recovery**
(D-187). It is reachable **only** in `SETUP_MODE` — states `EMPTY`, `PARTIAL`
and `PENDING_ENROLMENT` (D-099 as corrected by D-186) — so it cannot be
re-opened once an installation holds data that setup did not create.

**The three steps that are built:**

```text
1. The one-time setup token (D-101) — host access as proof of ownership
2. Organisation name, and the first administrator: email, name,
   and a password ENTERED TWICE (D-187)
3. MFA enrolment, with the QR code, in the same flow (D-185)
   → verifying the factor writes the bootstrap record; /setup closes
```

**Setup completes when that administrator holds a *verified* second factor, and
not before** (D-185). Step 3 is not a formality at the end: it is the step that
writes `InstallationBootstrap`, and `PENDING_ENROLMENT` is the boot state
between steps 2 and 3 — reused rather than duplicated. The wizard is gated on
**both** sides: the token at the front, the boot state at the back.
`decideWizardAccess` is total over `BootState`, and `CURRENT` and `TAMPERED`
answer `404` — not a redirect, which would tell a stranger the route is there —
to a caller holding a valid wizard cookie *and* a signed-in pending session
(`src/lib/setup/gate.ts`). In `PENDING_ENROLMENT` the surface is
**authenticated**: the token has been consumed, so a signed-in pending session
is required. There is no state in which an anonymous caller reaches an
administrative step on a database holding rows.

**Three steps are specified and deliberately not built, because the engine
behind each does not exist.** Naming them is how that stays a decision rather
than an oversight; `src/app/setup/page.tsx:31-48` records the same list:

| Step | Why it is absent |
|---|---|
| **0. New installation, or restore from backup?** | There is no restore. D-095/D-169 make a backup a structured export the application writes and reads itself, `pg_dump` is out of v1 scope, and the export engine is unbuilt. A question with one answer is not a question, and a dead "restore" branch is worse than its absence |
| **4. Recovery token, shown once with an "I have stored this" step (D-040)** | It is a passphrase over the archive's key record (D-114, D-166), so it needs the same missing engine |
| **5. Email settings, optional, with a test-send button** | There is no mail transport yet |

They belong here when those engines land. When step 4 does land: the token is a
**passphrase over the archive's key record**, not the bootstrap secret itself —
see `14-backup-restore-upgrade.md` §2. The wizard displays the token; it never
displays `SECRET_KEY`. The acknowledgement text states what the token recovers —
the archive **and** the instance's own key material — so the operator
understands that the two artefacts they were told to keep are genuinely
sufficient and genuinely necessary.

**This subsection was rewritten on 2026-09-05 against the built wizard** (phases
1.3–1.5). It previously listed seven steps of which three do not exist, and said
the bootstrap record is written at a step 6 "Done" when D-185 writes it on MFA
verification. The code was right.

**Decision D-100 — The first-run record is `InstallationBootstrap`, not
`PlatformBootstrap`.** The template's enforced-singleton record is reused, but
it keeps the `Platform` prefix that D-056 deletes alongside `PlatformSettings`
and `PlatformRoleAssignment`. Leaving one `Platform*` model behind reintroduces
the namespace the extraction exists to remove — and it is the model the boot
state machine reads on every start, the worst place for a name that means
something the architecture no longer has.

**Decision D-039 (amended) — The setup wizard is the only unauthenticated
administrative surface, and it self-destructs.**
**Reason.** First-run configuration is the one moment where no account can exist
yet. Bounding that window to "before the installation holds any data" (D-099)
removes the standing unauthenticated admin surface that a permanent admin-token
model keeps open forever.
**Trade-off.** A race exists between container start and the operator reaching
`/setup` — whoever arrives first becomes administrator. It is mitigated by a
one-time setup token, which the wizard requires.

#### The setup token does not go to the logs

The original mitigation printed that token **to the container logs**. Four
chapters away, F-20 states as a design assumption that *"self-hosters debugging a
problem paste logs, screenshots and database rows"*. The mitigation and the
acknowledged behaviour are mutually exclusive, and the repository is public: an
operator whose setup fails opens an issue, pastes `docker compose logs app`, and
publishes a credential that makes a stranger the administrator of an instance the
school is about to populate. The same exposure occurs through Portainer, Synology
and Unraid log panes, and through centralised log shipping to a third party.
Finding **F-99**.

**Decision D-101 — The setup token is written to `$DATA_DIR/setup-token`, mode
0600, and only its *path* is printed. It is single-use, expires in ≤60 minutes,
and is reissued only from the host.**

```bash
docker compose exec app splashtrack setup:token --new
```

**Reason.** Host access is the proof of ownership, which is the pattern §7's
break-glass CLI already establishes for every other privileged operation. A
bearer credential does not belong in a log stream that the design elsewhere
expects to be published.
**Trade-off.** The operator needs filesystem access to the data volume rather
than a `docker logs` scroll. That is one extra command, of the same class they
already need for break-glass.

Token submission is **rate-limited with lockout**, and failed attempts are
audited — the existing rate-limiting specification covers login, password reset,
export and public forms, and did not cover this. §8's diagnostics page and the
GitHub issue template both carry a warning that container logs may contain a
setup-token *path*, and that the file itself must never be pasted.

---

## 7. Break-glass: locked out of your own instance

A self-hosted application must have a recovery path that does **not** depend on
a network-reachable secret. Ours requires host access, which is proof of
ownership:

```bash
docker compose exec app splashtrack admin:reset-mfa   --email …
docker compose exec app splashtrack admin:grant-admin --email …
docker compose exec app splashtrack settings:reset    --key …
docker compose exec app splashtrack settings:list
docker compose exec app splashtrack setup:token --new           (D-101)
docker compose run  --rm app splashtrack secret:init --out …    (D-112)
docker compose run  --rm app splashtrack secret:recover --file … --token … --out …
                                                                (14 §4.2.2, D-166)
docker compose exec app splashtrack key:rotate                  (§5.3)
docker compose exec app splashtrack bootstrap:clear-tampered    (D-099/D-186)
```

**The host path the wizard replaced, kept for the instance the wizard cannot
finish** (D-187 demotes these *"in the usage text and the documentation"*, and
this is the documentation):

```bash
docker compose exec app splashtrack setup:init                  (D-187)
docker compose exec app splashtrack admin:create --email …      (D-185, D-187)
                                — no --password-file; D-187 removed it
```

**Diagnostics, which are read-only and answer "why is this instance behaving
like that":**

```bash
docker compose exec app splashtrack boot:state                  (§6.1, D-098/D-186)
docker compose exec app splashtrack audit:verify                (D-149, D-168)
docker compose exec app splashtrack audit:grants                (D-182)
docker compose exec app splashtrack db:apply-grants             (D-182)
```

`db:apply-grants` is the only one of the four that writes: it re-applies the
audit grants of `src/lib/database/role-model.ts` as the owner, idempotently,
which is what a migration adding a table needs afterwards.

`admin:grant-admin` issues a **time-limited grant (24 hours)**, not a permanent
one: the use case is recovery, not provisioning. The recovered administrator
makes their own standing grant through the normal path, where D-139's
anti-amplification invariants apply.

Every one of these writes an audit event, with a `system:cli` actor carrying
host user, container id, timestamp and the exact subcommand, and every
invocation notifies all `ORGANIZATION`-scoped administrators (`07-…` §1.2).
This replaces Vaultwarden's
"disable the admin token" escape hatch with something that cannot be reached
from the internet at all.

**Safety rails in the settings layer itself:**

- **The lockout invariant is stated once, in `02-security-privacy.md` §1.2.1
  (D-141), and this chapter does not restate it.** The two bullets that stood
  here — *"local administrator login can never be disabled while it is the only
  working authentication method"* and *"email and identity-provider settings
  must pass a test before they can be enabled"* — were the claims D-141 deleted
  as unenforceable, left standing verbatim in the chapter that specifies the
  settings layer. Configure a second provider and local login is no longer "the
  only" method; "working" is not decidable, because a provider that passed a
  test at 14:00 fails at 14:05 on a certificate or a tenant policy the
  application cannot observe. A test-connection gate **catches typos; it is not
  a safety net**, and calling it a safety rail here is how an implementer builds
  the bypassable check and ships. Finding **F-140**.
- What the settings layer must actually enforce, per D-141, is a
  **database-level invariant**: *at least one local `ORGANIZATION`-scoped
  account with a verified MFA factor exists at all times*. It is re-evaluated on
  every authentication-settings change, every role revocation and every account
  disable, and a settings write that would break it is refused. §3.2 carries it
  as a `Security`-category constraint on the registry, because a settings write
  is validated there.
- Every setting has a visible "restore default".
- Settings changes are audited: who, when, old → new (secrets recorded as
  `changed`, never with values).
- Configuration can be exported and imported **without secrets**, so an operator
  can reproduce an instance or hand it to a colleague.

---

## 8. Diagnostics page

Borrowed directly from Vaultwarden, because it is genuinely good: one screen
showing effective configuration, where each value came from (default, env,
database), database connectivity, migration state, email test result, storage
writability, version, and whether a newer release with a security advisory
exists (D-034).

**The page requires `diagnostics.read` at `ORGANIZATION` scope and is never
served unauthenticated** (D-156). Its "safe to paste" property is about
*content* — no secrets, no personal data — and is independent of who may open
it. The two were previously conflated, and the page reports version, migration
state, backup posture and whether a newer release with a security advisory
exists: a machine-readable answer to "is this instance exploitable?" for anyone
scanning for instances.

It is the first thing to ask for in a support issue, and it must be safe to
paste into a public GitHub issue — so it renders **no secrets and no personal
data** (F-20).

It additionally surfaces:

- A warning that container logs and `$DATA_DIR` may contain a live **setup
  token**, with the instruction never to paste either (D-101). The same warning
  is in the issue template.
- A warning if `SECRET_KEY` is supplied as a plain environment variable rather
  than `SECRET_KEY_FILE` (§3.1.1).
- The **backup horizon**, and any mismatch between backup retention and the
  shortest special-category retention period (`14-…` §5.2, D-104).
- The current **backup destination**, permanently, beside the backup-age
  indicator (`14-…` §3.2, D-103).
- Whether any encrypted column still holds ciphertext under a superseded
  `keyId` — the resumability signal D-096 makes possible.
- The **audit chain-status line** D-149 part 1 requires and this section did not
  carry: the result of the last `audit:verify`, its timestamp, and the number of
  pruned segments it verified across (`02-…` §3.2.1, D-168). The count is shown
  because "intact across 3 pruned segments" is a green result and a bare
  "intact" would hide the deletions that legitimately happened.
- A **key-custody check** beside the recovery-token acknowledgement: whether the
  running `SECRET_KEY`'s fingerprint matches the fingerprint recorded in the most
  recent archive (`14-…` §2.3, D-166). A mismatch means the newest backup can no
  longer be restored into this instance without `secret:recover`, and the
  operator should learn that from a diagnostics line rather than from a flood.
