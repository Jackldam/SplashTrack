# Phase 0.4a — the encryption envelope and audit checkpointing

**Branch** `build/v1-foundation`. **From** `5346b46`. **Date** 2026-09-03.

The first half of phase 0.4: the two data-layer mechanisms that must exist
before the first byte of real data is written. The second half —
`requirePermission` / `resolveReach` / `coversResource` (D-147) and the
retention/erasure columns (D-014, D-065) — is deliberately untouched and is
accounted for in §7.

**Why this order.** Every encrypted byte written before the envelope exists has
to be unwrapped and rewritten by hand from a backup. Every audit row written
before checkpointing exists sits in a chain that the first legitimate retention
run breaks permanently. There is no released version, no tag and no deployed
instance (OD-1, closed 2026-09-02), so this was the last moment either could be
done freely. Phase 0.3 already used that freedom once, deliberately, to redefine
the frozen v1 hash array.

---

## 1. What landed

Five commits, each with the suite green before and after.

| Commit | What |
|---|---|
| `ecc6f8c` | One bootstrap secret, every key derived from it (D-112) |
| `caa1fa9` | The encryption envelope and its column registry (D-096, D-167, D-097) |
| `3cb10f8` | **Fix:** order the `Membership.status` migration after the rename that creates it |
| `86aecab` | Audit chain checkpointing across a retention boundary (D-168, D-149) |
| *(this file)* | The report |

### 1.1 The bootstrap secret (D-112)

`SECRET_KEY` **replaces** `BETTER_AUTH_SECRET`; it does not join it. The Better
Auth signing secret is now `HKDF(SECRET_KEY, info="auth-signing-v1")`.

This was not optional and not a scope stretch: D-112 is the single authoritative
statement of this key's lifecycle and it is explicit that the signing secret is
derived. Adding `SECRET_KEY` *beside* `BETTER_AUTH_SECRET` would have
constructed the exact F-95 failure the decision exists to close — a restore that
reproduces one secret but not the other, leaving every TOTP enrolment silently
dead on an instance where MFA is mandatory for administrators.

- `src/lib/crypto/secret-key.ts` — the loader and the HKDF split. `KEY_PURPOSES`
  is a frozen vocabulary reproducing D-112's diagram, including the two labels
  with no consumer yet (`totp-v1`, `backup-master-v1`), so nobody invents a
  second spelling for a label that already exists.
- Supplied via `SECRET_KEY_FILE`. The plain `SECRET_KEY` variable is accepted as
  the deprecated fallback D-112 names, and reports itself through
  `describeSecretKeySource()` so the diagnostics page can warn.
- `scripts/secret-init.ts` (`npm run secret:init -- <path>`) is design 13
  §3.1.1's `secret:init` until the CLI binary exists. It refuses to overwrite:
  replacing this key is unrecoverable data loss, not a convenience.
- Every unusable input throws — missing, empty, unreadable, shorter than 32
  bytes. D-166's rule starts upstream of the envelope, and the cheapest way to
  break it is a loader that quietly derives from an empty string.

**Environment surface: still three application-owned variables.** `DATABASE_URL`,
`BETTER_AUTH_URL`, `SECRET_KEY_FILE`. No fourth variable was added, so no ADR is
owed for one. (One *is* owed for the insert-only role's connections — §5.)

### 1.2 The envelope (D-096 as corrected by D-167, registry D-097)

Format `v1:<keyId>:<nonce>:<ct>`, AES-256-GCM, tag appended to the ciphertext,
`nonce`/`ct` base64url. Authenticated with **AAD binding
`(columnId, primary key, keyId)`**.

- `src/lib/crypto/envelope.ts` — `seal` / `open`, the `DECRYPTORS` registry and
  `CURRENT_FORMAT`. One home, not the template's two copies with different HKDF
  labels.
- `src/lib/crypto/encrypted-columns.ts` — the registry D-167 requires.
  `columnId` is permanent; `model` and `field` are ordinary mutable entry
  fields that a rename edits.
- `src/lib/crypto/index.ts` — the surface a domain module imports.
- `tests/fixtures/crypto-golden-vectors.json` — committed vectors under a fixed
  **public** test key, one per format ever shipped.

**The typed API.** `Sealed<C>` is a branded string whose only producer is
`seal`. A repository field typed `Sealed<"students.medical_remarks">` cannot be
handed a plaintext; `assertSealedEnvelope` catches a plaintext that reached a
protected column by another route (a hand-run `UPDATE`, an import) and reports
*that* rather than a decryption failure that reads like tampering. `seal`
refuses an unregistered `columnId` and refuses an empty primary key, so neither
can be skipped at a call site.

**The registry holds no production column yet, and that is the point of the
ordering.** `CLAUDE.md` rule 1 asks for the envelope *before* the first
encrypted byte. The columns that will live here arrive with the modules that own
them: `students.medical_remarks` and `SafetyNote` (D-148, D-177),
`AssessmentRemark` (D-148), the settings-registry secrets, `Inquiry` free text.

**How a column joins.** A `/// @encrypted <columnId>` doc comment on the field
plus a registry entry, checked bidirectionally by
`tests/unit/encrypted-column-registry.test.ts` in the shape D-135 already adopts
for `person-reference-sync.test.ts`.

### 1.3 Audit checkpointing (D-168, completing D-149)

- `AuditCheckpoint` in the schema, plus migration
  `20260903065800_add_audit_checkpoint`.
- `src/modules/audit/domain/audit-checkpoint.ts` — the canonicalization and the
  MAC under `HKDF(SECRET_KEY, info="audit-anchor-v1")`, verified in constant
  time. Versioned (`macVersion`) for the same reason `AuditEvent.contentVersion`
  is.
- `pruneAuditEventPrefix` — the **only** delete path for `AuditEvent`. Writes
  the checkpoint and deletes the rows it accounts for in one transaction, on the
  same advisory lock appends take. A gap no checkpoint covers is therefore
  unambiguously tampering.
- `verifyAuditChain` — checkpoints first, then events **paged by sequence**,
  reporting `intact across N pruned segments`.
- `npm run audit:verify` — D-149 part 1's command, with `--prune-before=<date>`
  for a deliberate retention pass. Exit 0 intact / 1 broken / 2 could not run.

**Prefix only, computed correctly.** The deletable set is everything below the
first *surviving* sequence — not `occurredAt < cutoff`. Appends take their
timestamp in the application before insert, so under concurrency a lower
sequence can carry a later `occurredAt`, and a naive `DELETE … WHERE occurredAt
< ?` would punch a sparse hole that no anchor can describe. That is the same
hazard D-168 gives as the reason the retention floor is one instance-wide value
rather than per-event-class.

---

## 2. Design ambiguities hit, and how each was resolved

### 2.1 D-168's record sketch contradicts its own rule 5 — **flagged, not settled by me**

D-168's record says `sequence` is the *"last SURVIVING `AuditEvent.sequence`"*
and `chainHash` is *"that row's hash — the anchor verification restarts from"*.
Its rule 5 says *"genesis is treated as checkpoint zero, so verification has
exactly one shape"*. **These cannot both hold.** `AUDIT_GENESIS_HASH` is a
`previousHash` — the value the first row *carries* — never any row's own hash.

I stopped and asked; no answer arrived inside the window, so I implemented the
reading that makes rule 5 true and flagged it:

**`sequence` and `chainHash` are the LAST PRUNED row and its hash.** That is
exactly the `previousHash` the first surviving row carries, so genesis and a
checkpoint are the same kind of value and verification has one shape.

Why the literal reading fails: a prefix prune deletes the anchor row of *every*
earlier segment, so under "last surviving" every segment except the newest
becomes unverifiable, and genesis would need a second, different shape — the
outcome rule 5 exists to rule out. The third possibility (first surviving row,
anchored on its own hash) works but also needs two shapes.

Cost of the choice, stated: `sequence == prunedToSequence` always, so the record
carries one redundant field. Both are stored and both are MAC'd, because they
answer different questions and dropping one would deviate further from the
specified record than keeping it.

**This wants a one-line correction to the D-168 row in the register.** It is the
one thing in this pass I would want confirmed before real audit rows accumulate.

### 2.2 The `@encrypted` marker convention — chosen and documented

D-167 requires a test asserting *"every field the schema marks as encrypted has
an entry"* but never says how the schema marks one. Prisma has no user-defined
field attributes, so: a `/// @encrypted <columnId>` doc comment on the field. A
doc comment survives `prisma format` and travels into the generated client's
documentation, where a reader of the model sees it.

### 2.3 The AAD byte encoding — chosen, and frozen forever

D-096 names the three components and not their encoding. Fixed as
`JSON.stringify([columnId, primaryKey, keyId])` in UTF-8 — the three it names,
in the order it names them. JSON quoting is what makes the concatenation
unambiguous; a delimiter-joined string would let a crafted primary key
containing the delimiter impersonate a different binding. The format version is
deliberately **not** in the AAD: the decision specifies a triple, and the format
tag already selects the decryptor.

### 2.4 What `keyId` identifies — chosen

`keyId` names a **generation of `SECRET_KEY`**, not a purpose. Purposes are HKDF
`info` labels and are per-column (D-112); the key id is what `key:rotate`
increments when the root secret changes. The keyring today holds exactly one
generation, `"1"`. An envelope naming a generation the keyring does not hold
**refuses** — it does not fall back to the current key, because a successful
decrypt under the wrong key is impossible and a silent null is what D-166
forbids.

### 2.5 How a migration touching an encrypted column must behave — implemented

`05-technical.md` §5 rule 6 and design 13 §5.1.1 state the rule; the design puts
the declaration in the PR description *"because that is where it will be
checked"*. A test cannot read a PR, so the declaration lives where a test can —
a comment line in the migration SQL, which the PR diff shows anyway:

```sql
-- ENCRYPTED-COLUMN-IMPACT: name-only     -- a rename; safe by construction
-- ENCRYPTED-COLUMN-IMPACT: key-changing  -- primary keys move; this migration re-encrypts
```

`tests/unit/migration-safety.test.ts` fails any migration that names a model
carrying a registered encrypted column without one. It matches nothing today,
because no production column is registered yet — the guard exists before the
first encrypted byte, not after the first migration that moves one.

**The rule itself, stated once here for the reader who arrives from a commit
message:** a **rename** needs nothing — the AAD binds `columnId`, and the
registry entry's `model`/`field` are updated. A migration that **changes a row's
primary key, splits a table, or moves an encrypted value into another row** must
decrypt with the old `(columnId, pk)` and re-encrypt with the new one *inside
the same migration*. Getting that wrong is silent, unrecoverable data loss that
reports itself as corruption, and R-20 runs migrations unattended at container
start, after the pre-migration backup.

### 2.6 `BETTER_AUTH_SECRET` — not ambiguous, but a change worth naming

D-112 is explicit, so this was implemented rather than asked about. It is called
out because the blast radius is real: every existing session and every Better
Auth-encrypted value is invalidated. On an instance with no accounts and no
deployed users that costs nothing, which is exactly why it had to happen now.

---

## 3. Two defects found by running things

### 3.1 `prisma migrate deploy` failed on a fresh database (pre-existing, since `5346b46`)

`20260903062739_drop_membership_status_flag` does `ALTER TABLE "Membership"`,
but its directory timestamp sorted **before**
`20260903065203_rename_organization_membership_to_membership`, which is what
creates that name. It applied cleanly on every developer database because the
table was already renamed there; on a fresh one:

```
ERROR: relation "Membership" does not exist
```

R-20 runs migrations unattended at container start, so this is the shape that
strands an install. Renamed to `20260903065700`, SQL unchanged. Editing applied
migration history is normally forbidden and is free exactly here — no release,
no tag, no deployed instance — the same ground phase 0.2 regenerated the initial
migration on.

**Recovering a database that already recorded the old name** (the migration has
already run there, so it needs its record renamed, not a re-run):

```sql
UPDATE _prisma_migrations
   SET migration_name = '20260903065700_drop_membership_status_flag'
 WHERE migration_name = '20260903062739_drop_membership_status_flag';
```

That is what my dev database got. The test database is disposable by design, so
it was dropped and rebuilt.

`scripts/recreate-database.ts` (`npm run db:recreate`) makes the fresh-install
check one command. It refuses any target not named as a scratch database.

### 3.2 A quiet instance forked its own audit chain (introduced and fixed in this pass)

Found by a test, not by reading. An instance quieter than its own retention
window ends a retention run with **no events left** — every one expired. The
next append then chained from `AUDIT_GENESIS_HASH`, because the table was empty,
while verification anchored on the checkpoint's `chainHash`. Silent, permanent
fork.

`appendAuditEvent` now falls back to the latest checkpoint's anchor, and to
genesis only when there is no checkpoint either — which is "genesis is
checkpoint zero" expressed at the write side. The alternative (retain one row to
hold its hash) was rejected: it keeps an audit row, which is personal data, past
its retention purely as a hash carrier.

Covered by *"empties the trail when everything has expired, and the next append
chains from the anchor"*.

---

## 4. Every `PHASE 0.4:` marker, accounted for

`grep -rn "PHASE 0.4" src prisma` found 17 hits at `5346b46`; four of those are
in `src/generated/` (a build artefact reproducing the schema's own comments) and
are not source.

| Marker | Status |
|---|---|
| `prisma/schema.prisma:13` — the phase-0.4 header block | **Rewritten.** Records the envelope as done, with the `@encrypted` recipe; retention columns still listed as absent |
| `prisma/schema.prisma:775` — `AuditEvent`, "three things this model does not have" | **Two closed, one restated.** Checkpointing done; insert-only role now points at `infra/audit-database-role.sql`; the one-event-per-aggregate-write rule (§5 rule 7) is left, and is a load-test decision, not this pass |
| `audit-event.ts:95` — genesis constant may still be revised | **Closed.** Settled by D-168, and the comment now explains why the constant is a `previousHash` and therefore checkpoint zero |
| `audit-service.ts:114` — "walks the whole chain in one read" | **Closed.** Replaced by the checkpoint-anchored, sequence-paged walk |
| `audit-repository.ts:7` — insert-only role + checkpointing | **Half closed.** Checkpointing done; the database role is a deployment step (§5) |
| `audit-repository.ts:138` — `readAuditChain` materialises everything | **Closed.** `readAuditChain` is gone; `readAuditChainPage` replaces it |
| `src/generated/prisma/{browser,client}.ts`, `models/AuditEvent.ts`, `internal/class.ts` | **Not source.** Regenerated from the schema comments above |
| `src/lib/settings/settings.ts:18` — settings admin surface needs `requirePermission` | **Left.** Second half (D-147) |
| `src/lib/settings/config.ts:159` — nothing selects between the elevated and standard idle window yet | **Left.** Second half (D-173, needs the permission set) |
| `src/lib/database/client.ts:58` — no `Reach`, no per-module narrowed client | **Left.** Second half (D-031, D-057) |
| `src/lib/auth/session.ts:84` — the step-up gate | **Left.** Second half (D-147) |
| `src/lib/auth/session.ts:165` — D-173 selects the idle window by permission | **Left.** Second half |
| `src/modules/users/infrastructure/person-reference-classification.ts:28` — the erasure path does not exist | **Left.** Second half (D-014, D-065) |
| `prisma/schema.prisma:675` — `requirePermission` resolves from `RoleAssignment` alone | **Left.** Second half (D-147) |

Nothing in the second-half list was touched, edited or partially implemented.

---

## 5. The insert-only database role: where it goes, and why not here

D-149 part 2 is **not applied** by a migration. `infra/audit-database-role.sql`
holds the SQL and the reasoning. Three reasons, none of them a preference:

1. **Role names are the operator's.** On a managed Postgres the roles exist
   already and are named by the provider; a migration hardcoding
   `splashtrack_app` fails there and only there.
2. **A migration runs *as* the application role.** Having it revoke its own
   `UPDATE`/`DELETE` on `AuditEvent` breaks the next migration that touches the
   table — and R-20 runs migrations unattended, so an install stranded by its
   own grant is worse than the grant missing.
3. **Granting needs privileges the application role must not hold.** D-116 says
   that role is not a superuser. If it could grant, the separation would be
   decorative.

The `REVOKE` on the application role is **commented out** in that file, and this
is the honest state rather than a finished control: D-149 describes three paths
with different grants, so the application half is a *second and third database
connection*. That means new environment variables, and D-037 permits one only
with an ADR. A connection string plainly cannot live in the database, so the ADR
is writable — but adding two operator-facing variables is a decision about the
deployment surface and is Jack's, not mine. Applying the `REVOKE` before those
connections exist would break the retention path with nothing to run it on.

**Also worth saying plainly, because D-149's own text does:** this role is a
control against an *external* SQL primitive — an injection, a stolen
`DATABASE_URL`, a careless script — and **not** against the compromised
administrator FM-7 names. The control that reaches that actor is the checkpoint
MAC, whose own limit is that host access holds `SECRET_KEY` and can forge one.

---

## 6. Done checks — real output

Run at `86aecab`, in the order below.

```text
### npx prisma validate
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀

### npx tsc --noEmit
(no output — clean)

### npm run lint

> splashtrack@0.1.0 lint
> eslint


### npm run build
  Collecting page data using 5 workers ...
✓ Generating static pages using 5 workers (5/5) in 355ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /api/auth/[...all]
├ ƒ /api/health
└ ƒ /api/ready

ƒ Proxy (Middleware)

### npm test
 RUN  v4.1.11 /root/projects/SplashTrack

 Test Files  12 passed (12)
      Tests  85 passed (85)
   Start at  08:57:04
   Duration  5.74s

### npm run db:recreate splashtrack_freshcheck
Applying migration `20260903065629_merge_platform_settings_into_organization_singleton`
Applying migration `20260903065700_drop_membership_status_flag`
Applying migration `20260903065800_add_audit_checkpoint`

The following migration(s) have been applied:

migrations/
  └─ 20260902230852_foundation_identity_authorization_settings_audit/
  └─ 20260903044536_remove_platform_role_assignment/
  └─ 20260903044636_remove_audit_event_organization_scope/
  └─ 20260903064952_remove_organization_scoping_columns/
  └─ 20260903065203_rename_organization_membership_to_membership/
  └─ 20260903065629_merge_platform_settings_into_organization_singleton/
  └─ 20260903065700_drop_membership_status_flag/
  └─ 20260903065800_add_audit_checkpoint/

All migrations have been successfully applied.
```

85 tests, up from 32 at `5346b46`.

### 6.1 The four proofs the definition of done names

```text
✓ envelope round trip > returns the exact plaintext it was given                      (a)
✓ refusal (D-166) > REFUSES the wrong key rather than returning garbage or null       (b)
✓ AAD binding survives a rename (D-167, F-136) > decrypts a value written before the rename   (c)
✓ AAD binding survives a rename (D-167, F-136) > computes an AAD that does not mention the model or the field
✓ audit checkpointing across a retention boundary (D-168)
    > still verifies after a retention run actually deletes aged rows                 (d)
```

(d) deletes rows and asserts the count is zero before verifying, so it cannot
pass on a soft delete.

### 6.2 The rest of the new suite

```text
tests/unit/secret-key.test.ts                    13 tests
tests/unit/envelope.test.ts                      20 tests
tests/unit/encrypted-column-registry.test.ts      7 tests
tests/integration/audit-checkpoint.test.ts       12 tests
```

Notable members:

- *refuses a ciphertext moved to another row* — child A's allergy note in child
  B's row, the failure D-096's AAD exists to prevent.
- *refuses a key id this instance does not hold* — an interrupted rotation
  reported as itself, not as corruption.
- *decrypts every committed golden vector* — D-097's enforcement, so removing a
  decryptor breaks the build rather than a restore.
- *detects rows deleted WITHOUT a checkpoint* — the tampering signal, kept
  distinguishable from retention.
- *detects a forged checkpoint* — an attacker with database write access only,
  widening a checkpoint to cover rows they deleted by hand.
- *walks a chain longer than one page* — the paged walk crossing its own page
  boundary, since an off-by-one at the cursor would silently skip a row.

### 6.3 `audit:verify`, exercised against real data

Five events written to the dev database, the oldest three aged past a cutoff,
then pruned:

```text
$ npm run audit:verify
  event at sequence 1 does not match the chain — an interior row was edited, deleted, reordered or inserted out of band
  First bad event sequence: 1
  Pruned segments recorded: 0

$ npm run audit:verify -- --prune-before=2025-01-01 --reason=demo_retention_run
Audit chain intact across 1 pruned segment(s); 3 event(s) verified.

$ npm run audit:verify
Audit chain intact across 1 pruned segment(s); 3 event(s) verified.
```

The first run reports broken because the crude seed rewrote `occurredAt` in
place, which the row hash commits to — an unintended but welcome demonstration
that verification catches an edited timestamp. After the retention run deletes
those rows behind a checkpoint, the chain verifies across the gap.

---

## 7. Left for the second half of 0.4, explicitly

- `requirePermission` / `resolveReach` / `coversResource` with the opaque
  `Reach` type (D-147), and the per-module narrowed clients (D-057).
- Retention-policy and lawful-basis columns, and the erasure registry (D-014,
  D-065).
- **The computed audit retention floor** — `max(12 months, the longest retention
  among the classes the events evidence)` (D-168 rule 6). It is not here on
  purpose: the classes it maxes over are the retention columns above. A
  hardcoded twelve months now would be exactly the "operator keeps two numbers
  in step" mistake the decision removes. Until then `pruneAuditTrail` takes an
  explicit cutoff and the caller owns it.
- The settings-layer refusal to cross that floor, and the high-severity audit
  event on lowering it (D-149 part 3).
- `05-technical.md` §5 rule 7 — one audit event per aggregate write. A load-test
  decision, unchanged by this pass.
- The diagnostics chain-status line (D-149 part 1's second half), which needs
  the permission guard.
- The second and third database connections for the insert-only role, and the
  ADR for their environment variables (§5).

---

## 8. Glossary

`docs/glossary.md` gains an **Infrastructure terms** section, per `CLAUDE.md` §3
("before introducing a domain concept, add it there"): `columnId`, `Sealed` /
`seal` / `open`, `keyId`, `AuditCheckpoint`, `prunedSegments`. None is Dutch
domain vocabulary — they are here because each is a permanent name later code
must not re-spell, and "checkpoint" in particular must not acquire "anchor" or
"watermark" as a second spelling.
