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
