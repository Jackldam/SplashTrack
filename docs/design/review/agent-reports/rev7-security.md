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

---

### S-6 — Every "notify all administrators" control is delivered over an SMTP host the same administrator configures, and no chapter makes delivery failure visible

**Severity: high** · **CONFIRMED**

The fixes lean on administrator-to-administrator notification as *the* control
wherever step-up is admitted to be worthless. `02-…` §1.2:

> **Step-up is a freshness control, not an authorization control** … it is worth
> nothing against an actor who *is* the account holder. Every place this
> document leans on step-up alone against an insider threat is a place that also
> needs an anti-amplification rule (§2.6), an audit event, or a notification to
> a second administrator.

Five separate decisions then cash that cheque: D-140 (*"notifies every
`ORGANIZATION`-scoped administrator"* on provider create/enable/edit), D-115
(*"every re-display is a high-severity audit event that notifies all
`ORGANIZATION`-scoped administrators"*), D-103 (*"mandatory notification to
every `ORGANIZATION`-scoped administrator"* on destination change), `07-…` §1.2
(*"every break-glass invocation additionally notifies every
`ORGANIZATION`-scoped administrator by the delivery channel of §1.4"*), and
`07-…` §1.4 (*"v1 ships email and webhook delivery for the high-severity set. An
alert nobody receives is a log line."*).

The delivery channel is SMTP, configured in the settings registry
(`13-…` §3.2, category `Email`), editable by `organization.settings.manage`.
D-142's egress client is scoped to *"the SMTP test-send"* (`02-…` §1.2.2 names
the four surfaces: OIDC discovery, SMTP **test-send**, backup destination
endpoint, version check) — not to production mail delivery.

**Attack.** Actor: exactly the principal every one of those five controls is
written against — an authorised insider holding `organization.settings.manage`,
MFA'd, with their own password and second factor, for whom step-up is not an
obstacle by the design's own admission. Step 1: open Email settings and change
the SMTP host to a hostname that does not resolve, or to their own relay. This
is an ordinary `free` setting; it is not in the high-risk set as a *distinct*
permission, there is no step-up on it, no notification of it (the notification
would go through the channel being changed), and no second-administrator
approval. Step 2: do the thing. Add an identity provider they control (D-140),
re-display the recovery token (D-115), run `admin:grant-admin` from the host
(`07-…` §1.2), point the backup destination at their bucket when one exists
(D-103). Every audit event fires correctly, into a trail nobody is looking at,
and every notification that was supposed to put a second pair of eyes on it is
delivered to `/dev/null`.

Two aggravating details. First, the persistent dashboard banner `07-…` §1.2 adds
for break-glass (*"must be dismissed by a different administrator"*) is the one
control that survives — and it covers break-glass only, not the four other
notification-backed decisions. Second, nothing in the design set treats mail
delivery failure as an alertable condition: `07-…` §1.3's signal table has
`Privilege use`, `Privilege change`, `Authorization`, `Authentication` and
`Data movement`, and no row for "the notification channel is broken". A silently
broken mail configuration is indistinguishable from a quiet week.

**Recommended fix (do not apply here).** Three things, all cheap. (a) Classify a
change of notification channel — SMTP host/port/credentials, webhook URL — at
the same severity as the events it carries: step-up, high-severity audit, and
notification sent to **both** the old and the new destination, which is the one
notification that cannot be suppressed by the change itself. (b) Route
production mail through D-142's egress-controlled client, not only the test-send
— an attacker-chosen SMTP host is an outbound connection to an
administrator-named destination by definition, and the current wording exempts
the only one that runs unattended. (c) Add "no high-severity notification
delivered successfully in N days" to `07-…` §1.3's signal table and to the
diagnostics page, so the dead channel is visible where the backup-age indicator
already is.

---

### S-7 — D-149's audit chain verification and D-149's audit retention deletion are in the same decision and cannot both hold

**Severity: high** · **CONFIRMED**

`02-…` §3.2 (D-149), parts 1 and 2:

> 1. **The chain is verified, and the verification is somewhere a human sees
>    it.** A `splashtrack audit:verify` command plus a chain-status line on the
>    diagnostics page … A tamper-evident record nobody ever checks is
>    tamper-*evident* in the same way an unwatched camera is.
> 2. … Deletion by the retention job runs as a third, narrowly-scoped path with
>    its own audit event.

and part 3 sets a floor, not an exemption: *"Audit retention is an
organisation-configurable policy under D-065 … The settings layer refuses any
value below the floor"*. `01-…` §5 gives the audit row `onExpiry: DELETE`.
`14-…` §4.3.1's restore matrix asserts *"Audit chain verifies — **Full chain
walk**"*.

**Failure path.** Actor: nobody malicious required for the first half. Twelve
months and one day after installation the retention job deletes the oldest audit
rows. A hash chain in which each row hashes the previous row's hash has exactly
one property: it is verifiable from a known anchor forward. Deleting the head
destroys the anchor, and deleting any interior run leaves a break at the seam.
`audit:verify` — a full chain walk — now reports a discontinuity, permanently,
on every instance, from the first retention run onward. The diagnostics
chain-status line goes red and stays red.

Then the malicious half. The single control D-149 exists to provide is that a
compromised administrator who exports the member base and deletes the four rows
recording it is *detectable*. On any instance older than the retention window
the detector is already alarming for a benign reason, so the four deleted rows
produce no new signal — and the volunteer administrator reading diagnostics has
been trained by twelve months of red to treat it as normal. A tamper-evidence
mechanism whose false-positive rate is 100% after month twelve is worse than
none, because D-128's Article 33 assessment is now built on a trail whose
integrity check has no discriminating power.

The restore matrix makes the contradiction mechanical rather than arguable: any
fixture whose seeded audit rows straddle a retention boundary fails the "audit
chain verifies" assertion, so either the fixture is kept artificially young or
the assertion is quietly weakened — and D-105's whole point is that the
assertions are the thing.

Note also that part 2's *"third, narrowly-scoped path"* holds `DELETE` on
`AuditEvent` and lives in the same process, reachable from the same code base
where `02-…` §3.1 permits `$executeRaw` behind a reviewer sign-off. The
database-level separation is therefore a control against an *external* SQL
primitive, not against the compromised-administrator scenario FM-7 and D-149
name. That is worth stating in the decision rather than leaving a reader to
conclude that the `INSERT`-only role makes deletion impossible.

**Recommended fix (do not apply here).** Rotation with anchors: on each
retention run, before deleting, write a **checkpoint row** carrying the hash of
the last surviving row, the hash of the last deleted row, the count and the
date range deleted, signed under `HKDF(SECRET_KEY, info="audit-anchor-v1")`; the
checkpoint is itself chained and never deleted. `audit:verify` then verifies
each segment against its anchors and reports "chain intact across N pruned
segments" — a green result that still detects an interior deletion, because a
removed row inside a segment breaks that segment's hash against its checkpoint.
State in D-149 that the deletion path holds `DELETE` and what that means for the
insider threat.

---

### S-8 — D-099 turns an ordinary interrupted first run into `TAMPERED`, bricking the install between wizard step 2 and step 6, with an undefined command as the only recovery

**Severity: high** · **CONFIRMED**

`13-…` §6.2 (D-099):

> **Decision D-099 — Setup mode requires **all** of: no bootstrap record, zero
> `UserAccount` rows, zero `Person` rows and zero `RoleAssignment` rows. Data
> present with the bootstrap record missing is not `PARTIAL`; it is
> `TAMPERED`.**
> `TAMPERED` refuses to serve any request, logs at high severity, writes an
> audit event, and can be cleared only from the host via the break-glass CLI.

and §6.3, the wizard, in order:

> ```
> 2. First administrator account (email, password or passkey)
> 3. MFA enrolment — forced, not offered
> 4. Recovery token shown once, with a required "I have stored this" step (D-040)
> 5. Email settings (optional, with a test-send button)
> 6. Done → bootstrap record written, /setup permanently closed
> ```

**Failure path.** Actor: the operator, on their first evening. Step 2 creates a
`Person`, a `UserAccount` and a `RoleAssignment`. Steps 3, 4 and 5 follow. The
`InstallationBootstrap` record with `completedAt` is written at step **6**. Any
container restart in that window — and the window contains the two steps most
likely to make an operator restart something: forced MFA enrolment (a phone that
will not scan, a clock skew, a passkey that needs the right `APP_URL`) and the
SMTP test-send (which fails, so they edit the compose file and
`docker compose up -d`) — re-runs the boot predicates. D-098's predicate 4 finds
no bootstrap record with `completedAt`; D-099 finds three non-zero counts;
result: **`TAMPERED`, refuse to serve every request, high-severity log**.

The instance is now unreachable, the wizard is unreachable (§6.3: reachable only
in states `EMPTY` and `PARTIAL`), the recovery token from step 4 may never have
been displayed, and the message the operator gets is one that accuses them of
tampering. `13-…` §6's own diagram states the intended behaviour for exactly
this case and D-099 overrides it without noticing:

> `PARTIAL (no bootstrap record AND no person/account/role data)` → setup was
> interrupted. Resume SETUP MODE; do not migrate silently.

`PARTIAL` as redefined by D-099 can now only be reached in the sub-second window
between "migrations applied" and "first administrator created". The state that
exists to handle an interrupted setup no longer handles the interrupted setup.

Recovery is `splashtrack bootstrap:clear-tampered` (`13-…` §7), whose semantics
are stated nowhere in the design set. The two plausible implementations are
opposite: write the missing bootstrap record (which on a genuinely tampered
production database is the wrong answer — it serves an installation whose
`RoleAssignment` rows an attacker may have just written) or truncate to empty
(which on a half-finished setup is fine and on a populated instance destroys the
school). An operator staring at a bricked instance at 22:00 will run it either
way.

**Recommended fix (do not apply here).** Write the `InstallationBootstrap` row
at the **start** of the wizard, with `completedAt` null, and key `TAMPERED` on
the row's *absence* while data exists — which is the condition D-099 actually
argues about (a deleted row, SQL injection, a botched restore), and is
undisturbed by an interrupted setup. `PARTIAL` becomes "row present,
`completedAt` null" and resumes the wizard as §6 intends. Then specify
`bootstrap:clear-tampered` explicitly: what it writes, what it refuses to do
when `UserAccount` rows exist, and that it demands a typed confirmation naming
the instance.

---

### S-9 — D-148 audits every read of the protected class; D-126 leaves reads out of its batching rule; §1.1 denies on any audit failure. The composition denies an instructor a child's epilepsy flag at the poolside

**Severity: medium** · **PLAUSIBLE**

`02-…` §2.5 (D-148): everything in the protected free-text class is
*"**audited on read**, not only on write"*. `02-…` §1.1 rule 2:

> **Deny by default.** Missing arguments, absent membership, missing permission,
> or *any unexpected failure including the database being unreachable* result in
> denial. Nothing ambiguous becomes an allow.

`05-…` §5 item 6 (D-126) addresses only writes:

> `AuditEvent` is a tamper-evident hash chain whose appends serialize on a
> **Postgres advisory lock** … at 30 students that is 30 attendance events and,
> naively, 30 chained audit rows taken one at a time against a lock contended by
> every other audit writer in the instance. So: **write one audit event for the
> group registration**, or batch the chain append.

and `02-…` §1.3's standing constraint:

> **A security control that adds friction to the poolside moment loses to
> paper** … no control whose failure mode is "the lesson stops".

**Failure path.** An instructor opens the class list for a group of thirty on a
poolside tablet. The screen must show the medical flag — that is what
`students.medical.read` is for, and it is the field that says a child has
epilepsy in a swimming pool. Each of those reads is in the protected class and
must be audited, each audit append serialises on one instance-wide advisory
lock, and D-126's batching rule was written for aggregate *writes* and does not
cover a read-driven fan-out. On a flaky poolside connection the lock wait or the
insert times out. Rule 2 then applies: an unexpected failure in the audit write
is an unexpected failure on the path, so the read is denied — and the instructor
is looking at a class list with the safety-relevant field blank, in the one
environment where they cannot stop to ask an administrator.

The inverse implementation is worse and equally consistent with the text: the
implementer, meeting the same timeout, decides that a failed *audit* should not
block a *read*, and the audit-on-read control that D-010 and D-148 both rest on
becomes best-effort — silently, with no chapter saying it may be.

Marked PLAUSIBLE rather than CONFIRMED because the design never states that a
class list renders medical data for all thirty children at once; it may render
only a flag, and a flag may or may not be a read of the protected column. That
ambiguity is itself the defect: the question "does displaying the flag audit?"
determines both the safety behaviour and the throughput, and no chapter answers
it.

**Recommended fix (do not apply here).** Extend D-126's rule to reads
explicitly: one audit event per protected-class *read operation* (a screen, a
list, an export), recording the set of subjects covered, not one per field.
State in D-148 whether the flag/indicator is inside the class or outside it, and
state — in §1.1 or §1.3 — the deliberate exception for the poolside read path:
audit failure on a protected-class read is queued and alerted, never a denial,
because "the lesson stops" is the failure mode §1.3 forbids.

---

### S-10 — D-158 binds a security bound to role names, which D-130 forbids because roles are user-definable; and its ceiling contradicts D-150's

**Severity: medium** · **CONFIRMED**

D-158 (register, added today):

> Session idle and absolute timeouts are role-scoped `bounded` settings,
> administrator-editable at runtime with no restart. Defaults: idle 30 min
> (instructor), 15 min (administrator), absolute 12 h; ceilings 8 h idle, 24 h
> absolute.

D-130 (register; `02-…` §1.2; `07-…` §1.3):

> The MFA mandate and the security alert rules bind to **permissions**, never to
> role names … "organisation administrator roles" is not a checkable predicate
> either, since roles are user-definable.

D-143, on what the poolside threat model now rests on:

> its effect comes from the Instructor role holding no export, bulk or
> administration permission at any scope, plus a short role-based idle timeout

**Failure path.** Roles are user-definable and the starter catalogue is
explicitly *"a starting point, not a fixed object"* (`02-…` §2.4). A school
creates *"Instructeur (avond)"*, *"Hulpinstructeur"* and *"Stagiair"* — three
new roles for the same poolside context. Which timeout applies? D-158 names
"instructor" and "administrator" as if they were closed categories. The
registry entry for a role that did not exist when the setting was defined either
does not exist (so the role falls back to a global default, which is the
administrator's to set) or is created empty (so it inherits the ceiling). Either
way the wet-tablet role ends up on a timeout nobody chose, and the control
D-143 calls one of the two things v1 ships in place of `SHARED_DEVICE` is
attached to a name rather than to the thing that makes the session dangerous.
This is D-130's argument, verbatim, applied to a decision written one commit
later.

A holder of the same account can also raise it: D-158 puts the ceiling at 8 h
idle, which on a shared poolside tablet is the entire operating day of a swim
school. The bound is real (the party restricted is not the party who sets it,
so D-143's self-declaration defect is genuinely closed) and its value makes the
control ineffective at the maximum an administrator may legitimately choose.

Two secondary defects in the same decision. **The ceilings disagree.** `02-…`
§4.1's `bounded` table — the authoritative statement of the class, per D-134 —
says *"session idle ≤ 8 h and absolute ≤ 12 h"*; D-158 says *"absolute 12 h;
ceilings 8 h idle, 24 h absolute"*, making 12 h the default and 24 h the
ceiling. `13-…` §3.2 restates the bounds a third time and omits the absolute
timeout entirely. **And the registry cannot express the setting.** `13-…` §3.2's
registry schema has exactly one scope field: `scope   instance-wide`. A
role-scoped setting has no representation in it, so D-158 requires a dimension
the registry does not have and neither chapter adds it.

**Recommended fix (do not apply here).** Bind the timeout to the same thing
everything else security-relevant binds to: **permissions**. "Any principal
holding a permission in the high-risk set gets the short administrator
timeout; any principal holding none gets the instructor timeout" is checkable,
survives a school inventing a role, and needs no new registry dimension.
Reconcile the absolute ceiling to one number in `02-…` §4.1 and point the other
two mentions at it. If role-scoping is kept regardless, add the scope dimension
to §3.2's registry schema and state the fallback for an unlisted role
explicitly — the strictest bound, not the default.
