# rev7 — Independent security & GDPR verification of the D-139..D-161 fixes

Branch `design/architecture-phase`, HEAD `29a0021`. Read-only on the design
chapters. Chapters 11/12 treated as history.

This round exists because the fixes for the previous security pass
(commits `ff0258a`, `9de14c9`, `29a0021`) had never been independently checked
against the chapter text. Two things are reported: findings against the fixes
and against the mechanisms the fixes introduced, and — at the end — a one-line
verdict on each of D-139..D-156.

The rewrite of chapter 02 is, on the whole, real work: most of the fourteen
decisions land in enforceable chapter text rather than in a register row. The
failures cluster in two places. First, the **crypto/recovery path**, where three
decisions written independently (D-112, D-113, D-114) compose into a Recovery
Kit that does not recover. Second, the **new mechanisms themselves** — a scope
ordering that is asserted and never defined, a settings class that claims to
protect objects it cannot reach, a notification channel that the threat actor
administers, and a boot state that bricks first-run.

---

### S-1 — The Recovery Kit needs a third artefact nobody is told to keep, and without it a restore succeeds with unreadable medical records and dead MFA

**Severity: critical** · **CONFIRMED**

`14-backup-restore-upgrade.md` §2 (D-040):

> ```
> ┌── splashtrack-backup-…stbak ──┐   ┌── Recovery token ──┐
> │  header: format, keyId, …     │ + │  STK1-XXXX-XXXX-…  │
> ```
> **Decision D-040 — Recovery is two artefacts: a backup file and a recovery
> token. Both are required; neither is useful alone.**

`14-…` §4.2, the restore sequence, in full:

> `upload .stbak + paste recovery token` → unwrap master key (Argon2id) → unwrap
> this archive's data key → authenticate the manifest → … → `done: log in with
> your existing accounts`

`13-configuration-and-setup.md` §3.1.1 (D-112):

> ```
> SECRET_KEY  (32 random bytes, operator-held, supplied via SECRET_KEY_FILE)
>    ├─ HKDF-SHA256(info="auth-signing-v1")   → Better Auth signing secret
>    ├─ HKDF-SHA256(info="totp-v1")           → TOTP secret encryption
>    ├─ HKDF-SHA256(info="settings-secret-v1")→ SMTP / OAuth / registry secrets
>    ├─ HKDF-SHA256(info="medical-v1")        → special-category column encryption
> ```
> **Generation.** The application never generates the bootstrap secret into
> `DATA_DIR`. If `SECRET_KEY_FILE` is absent the container **refuses to start**
> and prints the command that generates one.

And `13-…` §6.3: *"The wizard displays the token; it never displays
`SECRET_KEY`."*

**Attack / failure path.** Actor: an ordinary volunteer administrator, no
attacker required. The building floods; the server is gone. They have done
exactly what the product told them: they hold the `.stbak` and the printed
recovery token. They bring up a fresh container. It refuses to start without
`SECRET_KEY_FILE`, so they run the documented `splashtrack secret:init` and
generate a **new** `SECRET_KEY`. They restore. The archive decrypts — the token
unwraps the master key, the master key unwraps the per-archive data key, the
framed AEAD verifies, row counts match the manifest, `migrate deploy` reports
clean. `14-…` §4.2 tells them they are done.

What they actually have: every column encrypted under
`HKDF(old SECRET_KEY, "medical-v1")` is undecryptable — every medical remark,
allergy, physical limitation, pastoral note, assessment remark and inquiry free
text in the school (the whole D-148 protected class). Every settings secret
(SMTP password, any stored OAuth client secret) is dead. Every TOTP enrolment,
encrypted under `HKDF(old SECRET_KEY, "totp-v1")`, fails to verify — while
`02-…` §1.2 makes MFA mandatory and non-clearable (`invariant`, D-150) for
everyone in the high-risk set. So the restored instance also locks out every
administrator it restored, and the break-glass `admin:reset-mfa` is now the only
way back in, on a fresh host the operator may or may not still have.

Worse than the loss is that **nothing fails**. This is precisely the failure
mode D-049 exists to prevent — "the restore *succeeds* and the contents are
quietly unreadable" — reconstructed through a different door by the fix that was
supposed to close it. The one check that would catch it, D-105's restore-matrix
assertion *"an enrolled TOTP still verifies — **against the same recovery
token**"*, is stated against the wrong root: per D-112 the TOTP key derives from
`SECRET_KEY`, not from the recovery token, so the CI job as written either
passes vacuously (same `SECRET_KEY` throughout the workflow) or asserts
something the production restore path does not do.

No chapter tells the operator to keep `SECRET_KEY` with the backup. `13-…` §5.3
comes closest — *"Losing `SECRET_KEY` means every encrypted value becomes
unreadable … it is not recoverable from a database backup alone"* — but it is
filed under key rotation, never connects to the Recovery Kit, and the very next
line sells the separation as a feature (*"A database backup without `SECRET_KEY`
is therefore safer to move around"*). The setup wizard's step 4 acknowledgement,
the diagnostics *"recovery token acknowledged: yes/no"* check (F-24) and the
printed artefact all cover the token and none cover `SECRET_KEY`.

**Recommended fix (do not apply here).** State the Recovery Kit as **three**
artefacts, or make it genuinely two by carrying the wrapped `SECRET_KEY` inside
the archive header — wrapped by the *recovery token's* KEK, never by anything
derived from `SECRET_KEY` itself, so the archive still contains no usable key
material without the token (D-113 survives). Then: the wizard's step 4
acknowledgement must cover both artefacts; diagnostics must carry a
`SECRET_KEY` custody check beside the token check; the restore wizard must ask
for the original `SECRET_KEY` (or detect its absence and refuse rather than
proceed); and D-105's TOTP assertion must be restated as *"restore under a
freshly generated `SECRET_KEY` and assert the documented outcome"* — whichever
outcome the design chooses, the point is that CI exercises the case the operator
will actually hit.

---

### S-2 — The backup master key is *also* derivable from `SECRET_KEY`, so the recovery token protects nothing against anyone who has ever held host access, and D-114's rotation revokes nothing

**Severity: high** · **CONFIRMED**

`14-…` §2 (D-114) defines the master key as generated and wrapped:

> **Decision D-114 — Two-level key envelope. A random 256-bit master key is
> generated at setup and stored wrapped by a KDF over the printed recovery
> token.**
> - **Rotation = re-wrap the master key under a new token.** … The token can
>   genuinely be rotated when someone leaves, which is the entire point.

Four bullets later, in the same decision:

> - The master key is also derivable as
>   `HKDF(SECRET_KEY, info="backup-master-v1")` for the bootstrap case
>   (`13-…` §3.1.1), so a fresh install has a master key before any archive
>   exists.

and `13-…` §3.1.1's derivation tree lists `backup-master-v1` as a first-class
branch of `SECRET_KEY`.

**Attack.** Actor: a volunteer administrator, contractor or ex-sysadmin who at
any point had host access — the population `13-…` §7 treats as *"proof of
ownership"*, and the same population D-114's own rotation story is written
against (*"the token can genuinely be rotated when someone leaves"*). They copy
the `SECRET_KEY_FILE` once — 32 bytes, one `cat` of a mounted Docker secret, no
audit event anywhere in the design covers reading it. They leave. Two years
later they obtain any `.stbak` by any means: an old NAS, a decommissioned drive,
the operator's Dropbox — the file the design explicitly encourages to be stored
casually (*"which makes it safe to store casually, which in turn means operators
will actually keep backups"*). They derive
`HKDF(SECRET_KEY, "backup-master-v1")`, unwrap the archive's data key from its
header, and read every archive ever written by that instance, including ones
written **after** the recovery token was rotated — because a value derived from
`SECRET_KEY` cannot be re-wrapped, and re-wrapping the token's copy does not
invalidate the derivation.

This restores F-100/B-2 in full: one key, forever, non-revocable, covering the
archive body, every medical column and every stored secret. D-114's headline
property — *"A leaked archive compromises one archive, not the estate"* — holds
only against an attacker who has the archive and not `SECRET_KEY`. D-040's
*"neither is useful alone"* is false: `SECRET_KEY` alone is sufficient.

It also breaks the two-artefact security story in the operator's most likely
storage arrangement. The design tells them the archive is inert and safe to
store casually; the `SECRET_KEY` file lives in `./secrets/secret_key` next to
the `docker-compose.yml` (§3.1.1's own example path), and both end up in the
same NAS snapshot or the same `git` repository the operator commits their compose
file to — which `13-…` §3.1.1 names as the *most common* leak of exactly this
value.

**Recommended fix (do not apply here).** Delete the derivation. The bootstrap
case D-114 invokes it for does not need it: at setup the application generates
the random master key, wraps it under the token's Argon2id KEK, and stores the
wrapped record — there is no window in which an archive exists before a master
key does, because the wizard produces the token before it produces any archive.
If a derived fallback is genuinely wanted for the restore-onto-fresh-host case
(S-1), it must be a *separate* branch used only to wrap, never a second
independent path to the same key, and D-040/D-114 must then state plainly that
`SECRET_KEY` custody is equivalent to token custody.

---

### S-3 — D-141 deleted an unenforceable safeguard in chapter 02 and left it standing verbatim in chapter 13, where the settings layer is actually specified

**Severity: high** · **CONFIRMED**

`02-…` §1.2.1 spends a section killing the claim:

> **Trivially bypassed.** Configure a second provider — including one the
> attacker controls — and local login is no longer "the only" method. Every
> check passes at every step. … It is a point-in-time assertion sold as a
> continuous invariant.

`13-configuration-and-setup.md` §7, *"Safety rails in the settings layer
itself"*, unchanged by any of the three fix commits:

> - Local administrator login can never be disabled while it is the only working
>   authentication method (D-035).
> - Email and identity-provider settings must pass a **test** before they can be
>   enabled.

**Failure path.** Actor: the implementer. Chapter 13 is the chapter that
specifies the settings layer, and it names its own section *"Safety rails in the
settings layer itself"* — this is where someone building the settings layer
looks. They build the bypassable check, cite D-035, and ship. Nothing in
chapter 13 mentions D-141, the database-level *"at least one local
`ORGANIZATION`-scoped account with a verified MFA factor"* invariant, the
re-evaluation triggers (authentication-settings change, role revocation, account
disable), or the documentation sentence D-141 makes the actual control. The
second bullet likewise reinstates the test-connection gate as a *safety rail*
after §1.2.1 demoted it to *"it catches typos. It is not a safety net."*

Chapter 02 §1.2.1 is also the only place the real invariant is stated, and
D-134 ("a normative rule is stated once, and every other mention points at it")
makes chapter 13's silence a defect in its own terms: the rule is stated twice,
in two versions, and the newer one is in the chapter that does not own the
mechanism.

The attack this leaves open is exactly F-110/F-111's: a holder of
`identity.providers.manage` adds a second provider, disables local login, and
every "safety rail" in chapter 13 passes — with the compensating control
(a database-checked local MFA'd administrator) unbuilt because the chapter that
specifies the layer never asked for it.

**Recommended fix (do not apply here).** Replace both bullets in `13-…` §7 with
a pointer to `02-…` §1.2.1 (D-141), and add the database-level invariant and its
re-evaluation triggers to §3.2's registry description as a `Security` category
constraint, since that is where a settings write is validated.

---

### S-4 — D-139's "at or below their own scope" rests on an ordering over scope types that no chapter defines, and `COURSE` crosses units

**Severity: high** · **CONFIRMED**

`02-…` §2.6 (D-139), invariant 2:

> 2. **Scope confinement.** The scope of the grant must be at or below the scope
>    at which the granter holds that same permission. A `UNIT`-scoped Location
>    Manager cannot grant anything `ORGANIZATION`-scoped, and cannot grant at a
>    unit that is not theirs — which under D-121's flat `UNIT` means their own
>    unit and nothing else.

The phrase "at or below" appears in the whole design set only in this decision
(and its register row). No chapter defines a partial order over
`{ORGANIZATION, UNIT, GROUP, COURSE, SESSION, SELF}`. The only examples given
are the two unambiguous ones (`ORGANIZATION` above everything, a unit that is
not yours). And §2.1's own table places `COURSE` **across** units:

> | `COURSE` | One course across groups | "Examiner for Diploma B" |

with §2.2 coverage: *"That course, its levels, its enrolments, and **all** its
exam sessions"*.

**Attack.** Actor: a Location Manager at Zuidbad, `UNIT`-scoped, holding
`exams.manage` and `roles.assign` at that unit — an ordinary bundle for the
person who runs a location. Diploma B runs at Zuidbad *and* Noordbad; it is one
`Course`. The implementer, given "at or below" and no lattice, writes the
obvious thing: a table of scope types ranked by breadth,
`ORGANIZATION > UNIT > COURSE > GROUP > SESSION > SELF`, because a course names
fewer resources than a unit. The Location Manager then grants themselves — or a
colleague — `exams.manage` and `exams.results.record` at `COURSE = Diploma B`.
Confinement passes: `COURSE` is "below" `UNIT`, they hold the permission, the
window is inside their own (null). Reach now resolves to
`{kind: 'COURSES', courseIds: [Diploma B]}`, which under §2.2 covers **all** of
that course's exam sessions — including Noordbad's. They read and amend exam
results for children at a location they have no grant over, and D-062 makes an
amendment the effective result.

The mirror-image failure is equally likely and equally bad in the other
direction: an implementer who ranks `UNIT > GROUP` but has no place for `COURSE`
or `SESSION` denies every legitimate delegation of a `SESSION`-scoped aftest
assessor by a `GROUP`-scoped instructor — and the fix at 17:00 on an exam
Saturday is a special case in the grant service, which is D-147's own argument
about ad-hoc widening, applied to the path D-139 calls the one without which
"every other control in this chapter is decorative".

`SELF` is a third instance of the same gap: it is in the enum, D-146 makes it a
seeded assignment "subject to §2.6", and it is not comparable to `GROUP` or
`COURSE` under any breadth ordering.

**Recommended fix (do not apply here).** State the relation explicitly and
non-hierarchically: confinement is **resource containment**, not type ranking —
the set of resources covered by the proposed grant must be a subset of the set
covered by the granter's own grant of that permission, computed through the same
§2.2 coverage rules and evaluated live (D-145). Under that definition `COURSE`
is grantable by a `UNIT` granter only when every group in the course sits in
that unit, which is checkable, and `SELF` needs no ordering at all. Add the
cross-unit `COURSE` case to D-032's per-module scope-escape cases explicitly —
it is the case the type-ranking implementation passes.

---

### S-5 — D-144 makes `validUntil` mandatory for `SESSION` but puts no ceiling on it, and window confinement is vacuous for the granters who matter

**Severity: high** · **CONFIRMED**

`02-…` §2.1 (D-144):

> - `validUntil` is **mandatory for `SESSION` scope** — schema-level, not
>   documentation-level.
> - … Instructor and administrator grants may leave `validUntil` null; the
>   scopes where a bounded window is the whole point cannot.

D-068, on what that window should be:

> The grant itself carries its own `validFrom`/`validTo` — **typically** the
> session's date, occasionally a short window around it for preparation and
> follow-up.

D-139, invariant 3:

> 3. **Window confinement.** `validFrom`/`validUntil` must fall inside the
>    granter's own window for that permission.

**Attack.** Actor: any granter whose own `validUntil` is null — which D-144
explicitly permits for instructor and administrator grants, i.e. every
`ORGANIZATION`-scoped administrator and every standing Planner. Invariant 3 is
therefore vacuous for exactly the principals who issue examiner grants: a null
window contains every window. The schema requires a non-null `validUntil` on the
`SESSION` grant and nothing constrains its value, so the administrator setting
up the March exam Saturday enters `2099-12-31` — or the UI defaults to "no end
date I have to think about", which is what a date field with no ceiling gets on
a form filled in under time pressure.

The external examiner then holds `exams.assess` and `exams.results.record` on
that session for seventy-three years. This is F-113/B-7's attack verbatim: they
amend a child's diploma outcome years later, and because results are append-only
(D-062) the amendment becomes the effective result. D-144 changed the shape of
the tuple and did not change the outcome — the register row's own justification
("the examiner who assessed one Saturday in March keeps `exams.assess` … on that
session forever") is still true, one `validUntil` value later.

D-144's compensating controls do not reach it either: *"Expiring and expired
grants are surfaced in the administration UI"* surfaces nothing when the expiry
is in 2099, and *"staff grants default to a bounded `validUntil`"* is stated for
staff grants, not for the bounded-window scopes.

**Recommended fix (do not apply here).** For `SESSION` scope, derive rather than
accept: `validUntil` defaults to the session's date and may be extended only to
a stated maximum (D-068's "short window around it" made numeric — e.g. the
session date + 7 days), enforced in the schema alongside the not-null
constraint. For `COURSE` scope, which §2.4 already calls "time-bounded", require
non-null with a ceiling too. And close invariant 3's hole: a null granter window
must be treated as bounded by the granter's own maximum-grantable window, not as
unbounded.
