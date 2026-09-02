# rev7 — repairs to the retrofit-hostile core

Branch `design/architecture-phase`, from HEAD `9acfbfa`. Write access to the
design chapters. Scope was deliberately narrow: the mechanisms that must be
correct before the first line of code, because fixing them after data exists
means rewriting that data. D-165 fences this core inside v1 whatever else the
scope pass cuts, so this work is safe to do while the rest of the scope is still
being decided.

**Not touched, by instruction:** v1 scope, the cut list, feature cuts, chapter
06's estimates, and §2.1's blocking-check table (see the note under defect 4 —
the round-trip test lands inside an existing blocking check rather than adding
one).

New decisions start at **D-166**; new findings at **F-135**. Both registers were
checked first: the highest existing were D-165 and F-134.

---

## Defect 1 — S-1: the Recovery Kit did not recover · **closed** · D-166, F-135

**What was wrong.** D-112 + D-114 + D-040 composed into a Kit that fails exactly
where it is needed. On a fresh host the operator generates a new `SECRET_KEY`
(the container refuses to start without one), restores, and gets a green result:
token unwraps, AEAD verifies, migrations clean, row counts match. Every value in
the D-148 protected class is undecryptable, every settings secret is dead, and
every TOTP enrolment fails against a mandatory-MFA instance. Nothing fails.

Two further defects surfaced while verifying it, neither of which the reviewer
named:

- The **wrapped-master-key record lived only in the database being restored**.
  §4.2's first step — "unwrap master key (Argon2id)" — could not run on a fresh
  host at all. The chapter's own diagram listed only `format, keyId, wrapped
  data key` in the header.
- `13-…` §5.3's *"not recoverable from a database backup alone"* is filed under
  key rotation and never connects to the Kit, and the sentence after it sells
  the separation as a feature.

**What I wrote.** D-166, in `14-…` §2.3 and §4.2.2:

1. The archive header carries a **token-wrapped key record** — salt, Argon2id
   parameters, master key, `SECRET_KEY`, and a cleartext
   `HKDF(SECRET_KEY,"key-check-v1")` fingerprint — bound as AAD to the manifest
   digest so it cannot be spliced between archives.
2. A **fingerprint gate** before anything is written. On a mismatch the restore
   stops with nothing written and offers `splashtrack secret:recover`, which
   unwraps the archived key with the token to a 0600 file the operator mounts.
   The application never silently adopts key material from an uploaded file —
   §4.2.1 makes a foreign archive untrusted input.
3. A **decryptability proof** replacing row counts as the success condition: one
   row per encrypted column (covering every `(table, column)` AAD binding in
   use), every stored settings secret, every enrolled TOTP verifying a generated
   token, and the audit chain. Any failure reports the restore FAILED.

**What I rejected.** The reviewer's first option — state the Kit as *three*
artefacts. It is technically cleaner and it loses on the failure it creates: an
operator told to keep three things keeps two, and the one they drop is the one
with no printed sheet, no wizard step and no diagnostics check. It also breaks
Jack's stated requirement verbatim. I took the reviewer's second option and
stated the cost honestly in the decision: archive + token now also yields the
auth signing key, so a holder of both can forge sessions against a live
instance. That is a real increase, and it is smaller than the alternative's
silent total loss.

**Consequential edits.** D-113 amended (wrapped, never plaintext) in its own home
in `13-…` §3.1.1 and in its register row; D-114 gains the header bullet; D-105's
TOTP assertion restated as *"restore under a freshly generated `SECRET_KEY`"*
with the detail stated once in §4.2.2 and the matrix row pointing at it; `13-…`
§5.3's two rotation bullets corrected; wizard step 4's acknowledgement text;
`secret:recover` added to §7's break-glass list; a key-custody line added to the
diagnostics page beside the token-acknowledgement check.

---

## Defect 2 — B-12: the AAD bound to names that are scheduled to change · **closed** · D-167, F-136

**What was wrong.** Verified against the chapters: `13-…` §5.1 bound the AAD to
`(table, column, primary key, keyId)`, while D-159, D-100 and D-056 each plan a
rename of a table holding encrypted values. `key:rotate` is keyed by `keyId`
(`13-…` §5.3) and cannot see a rename; R-20 runs migrations unattended after the
pre-migration backup, so both copies become unreadable at once.

**What I wrote.** D-167, in `13-…` §5.1.1 — the AAD binds `(columnId, primary
key, keyId)` against a committed encrypted-column registry whose `columnId` is
assigned once, never derived from a name and never reused. Renames edit the
registry's `model`/`field`, not the identifier. The registry is bidirectionally
test-enforced in the same shape D-135 adopts for `person-reference-sync.test.ts`,
so a forgotten mapping fails the build instead of the decryption.

**What I rejected, partly.** The reviewer offered "or state explicitly that any
migration renaming an encrypted column must decrypt-and-re-encrypt". I did not
take that as the primary mechanism — it makes correctness depend on every future
author remembering an obligation that bites months later on an unattended path.
I kept a narrow version of it, because the primary key genuinely cannot be made
stable by construction and it is the component that stops one child's ciphertext
being pasted into another child's row: `05-technical.md` §5 gains rule 6,
covering key-changing migrations only.

**Not taken.** B-20 (the new envelope reusing the version tag `v1`, which the
inherited `secret-crypto.ts` copies already use for a different four-field
layout) is adjacent to this and squarely in the same mechanism, but it is not on
the list I was given and it interacts with D-097's golden vectors. It is worth a
decision before the first encrypted byte is written.

---

## Defect 3 — B-17 / S-7 / S-18: audit checkpointing · **closed** · D-168, F-137

**What was wrong.** Confirmed as reported, and the two halves compound: the
mechanism ranked #2 by retrofit cost had no decision and no phase, while the
retention policy that *was* specified guarantees it breaks. I verified the
template side rather than taking it on report — `audit-service.ts:107` walks
from `AUDIT_GENESIS_HASH` over `readAuditChain()`'s full ascending read, and the
module's own comment concedes the chain is unkeyed and that tail truncation
still verifies.

**What I wrote.** D-168, in `02-…` §3.2.1 — the home of D-149, so the rule stays
in one place and chapters 01, 06, 07 and 13 point at it:

- Prefix-only pruning; a deletion without a checkpoint *is* the tampering
  signal.
- `AuditCheckpoint` written in the same transaction as the delete, chained to
  its predecessor, MAC'd under `HKDF(SECRET_KEY,"audit-anchor-v1")`.
- `audit:verify` walks segment by segment, paged by sequence, and reports
  "intact across N pruned segments" — green, and still able to detect an
  interior deletion.
- The genesis constant decided now: `genesis:splashtrack:audit:v1`.
- Phase 1, stated in `06-delivery.md` §5's phase list.

**Where I went beyond the reviewer.** S-18 asked me either to settle the
retention floor or record why the partial state is accepted. I settled it, and
the settlement is forced by the chain rather than chosen: F-133's recommended
fix — per-event-class retention keyed to the class evidenced — deletes a
**sparse interior subset**, which no checkpoint can anchor. So the floor is one
instance-wide value, **computed** as `max(12 months, the longest retention among
the evidenced classes)`, which with 7–10 year exam records is the number F-133
wanted anyway. That closes S-18 and removes the fourth normative copy of the
number from `07-…` §1 and `01-…` §5.

**What I refused to overstate.** The MAC key derives from `SECRET_KEY`, so an
administrator with host access can forge a checkpoint. The decision says so, and
also says what S-7 asked for: the `INSERT`-only role bounds an external SQL
primitive, not the compromised administrator D-149 is written against.

---

## Defect 4 — B-13: two export mechanisms, one bullet · **closed** · D-169, F-138

**What I decided, and on what grounds.** D-095 stands. I did *not* decide it on
the reviewer's framing (which mechanism is safer against a hostile archive),
because under D-162 that argument now runs the other way — one deployment
operated by its author has no community of strangers supplying starter backups.
I decided it on **format permanence**: the archive format is written into every
backup file from the first one, D-048/D-049 oblige every later release to keep
reading what earlier ones wrote, and shipping `pg_dump` archives in v1 means
owning a dump reader permanently in the version where untrusted archives
actually do arrive. Two verified secondary facts support it —
`postgresql-client` is not in the `Dockerfile`, and dump format is tied to a
server version the operator controls.

The loser is deleted from §4.2.1 rather than kept behind an "if": what remains
is four lines of *terms* for anyone who proposes it again, explicitly not a
specification.

**On the guard.** The round-trip test is written into D-169 as part of the
export/import work item and it runs inside the **existing** integration-test
blocking check. I deliberately did not add a row to `06-delivery.md` §2.1's
table — adding a gate is scope, and that belongs to the scope pass. The
assertion set includes one the reviewer did not name and which is not optional:
**primary keys preserved exactly**, because D-096/D-167 bind the primary key
into the AAD, so an importer that renumbers rows yields a database where every
encrypted value fails to authenticate.

**Flagged, not changed.** D-169 makes Phase 1's "backup, restore and the
recovery token" bullet visibly larger than the `pg_dump` reading of it. That is
a sizing consequence for the scope pass; I stated it in the decision and touched
no estimate.

---

## Defect 5 — S-19 and the five "partially closes" verdicts · **closed** · D-170, D-171, D-172, F-139–F-142, F-144

Taken one verdict at a time, since each names a different open limb.

**D-139 → closed by D-170** (`02-…` §2.6.1). Both open limbs, S-4 and S-5, in
one decision because they are the same failure: an invariant stated in terms an
implementer cannot execute, failing open. Confinement becomes **resource
containment** through §2.2's coverage rules — no ordering over scope types
exists, so none is invented — and the bounded-window scopes get schema ceilings
(`SESSION`: session date, extendable to +7 days; `COURSE`: course end +7 days),
with a null granter window read as that granter's maximum grantable window
rather than as infinity. Without that last clause the ceiling binds the schema
and not the check, and the principals who issue these grants are exactly the
ones D-144 permits a null window.

**D-141 → closed by F-140**, no new decision: this is a D-134 problem, not a
design problem. The rule already has a correct home in `02-…` §1.2.1, so
`13-…` §7's two contradicting "safety rails" bullets become a pointer, and
§3.2 gains the enforceable form as a registry constraint — because §3.2 is
where a settings write is validated and §7 is not.

**D-149 → closed under defect 3** (D-168), including S-18's retention floor.

**D-150 → closed by D-171** (`02-…` §4.1.1). S-11's three non-settings leave the
`invariant` class and are stated where they are enforced; `SELF` is protected at
the boundary that owns it (`system: true`, roles module refuses, test-backed)
rather than by a registry that cannot see it. I also closed the D-104/D-150
conflict the verdict names in passing: backup retention is `free` with a
mandatory warning, because a ceiling with a documented-reason escape is a
warning, and `bounded` must mean one thing. S-10 is defect 6.

**D-151 → closed by D-172** (`02-…` §5.4.1). Both limbs. The importer rule is
also stated at the importer's own home in `00-…` §2.2 as a third constraint
beside "authority is never inferred" and "consent cannot be imported". On the
second limb I took the reviewer's direction but not their framing: rather than
softening §5.5's row, v1's withdrawal path is stated as what it actually is —
staff-operated in the privacy admin area, with the same `withdrawnAt`,
`withdrawnByPersonId` and D-152 cascades — so the portal adds a caller in v2
rather than a data model.

**S-19 → closed by F-144**, no new decision: the fix is a framing correction in
`07-…` §1.4 and a note on D-128's register row. The capability was never
justified by the legal conclusion, so removing the conclusion costs nothing
built.

---

## Defect 6 — C-1 / C-7 / S-10 / B-3 / B-5: D-158 was mine and it was wrong · **closed** · D-173, F-143

**Verified first, as instructed.** The claim that `WebAppTemplate` already
implements this was checked against the source, not taken from the report:
`src/lib/settings/config.ts:111-115` (`SESSION_TIMEOUT_MINUTES = {min: 15,
max: 43_200, default: 720}`), `:132-136` (`SESSION_IDLE_TIMEOUT_MINUTES =
{min: 1, max: 43_200, default: 30}`), `:706-735` (the cross-field rule refusing
idle > absolute), and `src/lib/auth/session.ts:33-46` and `:125-142` (live
enforcement through `getConfiguredSecurityPolicy()`, fail-safe-to-strict, the
application-owned `Session.lastSeenAt` idle check and the recorded reason Better
Auth's own `expiresIn` cannot serve). It holds in every particular. The
template's ceilings are 30 days, so the work is **narrowing** them, not building
a mechanism.

**What D-173 says.** The idle window is selected by whether the principal holds
any permission in the high-risk set — the predicate the MFA mandate already
computes — with strictest-wins and strictest-on-unknown. Three instance-wide
`bounded` keys, so C-7's missing registry dimension is not needed rather than
added. The absolute ceiling is settled at **24 h**: a `bounded` setting whose
ceiling equals its default cannot be raised, which makes it an invariant filed
in the wrong class, and Jack's OD-6 answer was explicitly "make it a setting an
admin can change later".

**Where the numbers live now.** One place: `02-…` §4.1.2. §1.2's "Proposal…
see OD-6" (C-2), §1.3's "applied by role", §4.1's `bounded` cell, OD-6's closure
table and `13-…` §3.2's fourth copy all became pointers. `05-technical.md` §5.1
gained a third row and is retitled.

**Where I disagreed with a reviewer.** B-3 recommended deriving the timeout from
"the highest-risk permission the principal holds… one `free`→`bounded` numeric
per risk tier". I took the binding and not the tiering: there is one risk set in
this design (the high-risk permission set), not a graded ladder, and inventing a
second gradation would create a new thing to maintain as permissions are added —
which is the maintenance cost D-130's trade-off column already names. Two tiers,
one existing set.
