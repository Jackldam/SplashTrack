# 10 — Findings: Gaps, Inconsistencies, Security Risks, Scalability Problems

The brief explicitly asks for these. Each finding states what is missing or
wrong, why it matters, and what this design does about it.

## Missing requirements

### F-01 — ~~`Person` is cross-organisation~~ **(dissolved by single-tenancy)**
**Status: closed.** This was the highest-severity finding in the original
design: `Person` spanned organisations and therefore could not use the
automatic tenant-scoping extension. With one instance per organisation
(D-012 revised) a person exists in exactly one database and the hole is gone.
The `assertPersonReachable` guard is no longer needed.

**Replaced by F-15** — the same *shape* of risk now lives one level down, in
unit- and group-scoped reach filtering.

### F-02 — **(Resolved into v1)** Consent for minors was not specified
**Severity: high.** The brief mentions consent but not that the overwhelming
majority of data subjects are children who cannot legally consent. A consent
record that only names the subject is useless for a minor.
**Response.** R-04: `PersonRelationship` carries an `authority` flag and validity
dates, every consent record references both subject and consenting person, and a
consent is valid only if the authority existed when it was given. Changes to the
relationship are audited. The guardian *portal* is deferred (P-04); the guardian
*authority model* is v1.

### F-03 — **(Resolved)** External examiners were not modelled
**Severity: medium.** Swim diplomas are frequently assessed by an examiner who
appears for one afternoon and is not a member of the organisation. A model
where assessment requires org membership either blocks the real workflow or
forces over-granting.
**Response.** D-052: `ExamAssessor` references a `Person` directly. If the
examiner records results themselves they receive an individual, expiring account
scoped to `exams.assess` / `exams.results.record` only — never a shared login,
because attribution on a child's diploma outcome is exactly what must not be
lost.

### F-04 — Photographs of minors were not called out
**Severity: high.** "Afbeeldingen" appears in the branding list, but the real
risk is class-list photos of children: personal data, biometric-adjacent, and
the field most likely to be added casually.
**Response.** Consent-gated; EXIF stripped; served through an authorising
route, never a public bucket path; suppressed in `SHARED_DEVICE` sessions for
non-assigned groups; deleted on erasure.

### F-05 — **(Closed)** No Data Processing Agreement is mentioned
Self-hosting removes the processor relationship: the organisation is both
controller and operator, and we never touch their data. The formulation now used
in `02-security-privacy.md` §5.1 replaces the earlier flat claim that no DPA is
needed: *"The project receives no personal data from your installation and
performs no processing on your behalf. Whether any agreement is required between
you and any party is your assessment to make with your own advisor."* Stating
the conclusion was itself the legal advice F-27 forbids (F-126). The
organisation still needs its own privacy notice and, where it
uses sub-processors (hosting, email), its own agreements — which the
documentation should point out without pretending to be legal advice.

### F-06 — **(Revised)** Retention and erasure conflict was resolved wrongly
**Severity: high.** Exam results are retained ~10 years; a data subject may
demand erasure. Both cannot be satisfied literally.
**Original response was wrong, twice.** It treated pseudonymisation as if it
ended the obligation — it does not, a pseudonymised record is still personal
data while re-identification is reasonably possible — and it assumed the
existence of a diploma creates an Article 17 exception, which it does not.
**Correct response.** D-065: retention is policy-driven, per data class, with an
explicit lawful basis and expiry action. An erasure request deletes or genuinely
anonymises everything with no live retention ground; where a ground exists the
record is kept *with that ground recorded* and the data subject is told what was
kept and why. Where a certificate number remains looked-up-able, the privacy
notice must say **pseudonymised, not anonymous**.

### F-07 — Backups are in GDPR scope and were not addressed
**Severity: medium.** Erasure cannot practically reach historical backups, and
a 12-month backup retention can silently outlive a shorter data retention
policy.
**Response.** Documented in `07-operations.md` §2: privacy notices state that
erased data persists in backups until they age out, backups are only restored
wholesale and never mined, and backup retention is reviewed against the data
retention policy.

### F-08 — No specified behaviour for a student who leaves and returns
**Severity: low-medium.** Common in practice; ambiguous in the brief. Reuse the
old `StudentProfile` (keeping history) or create a new one (clean slate)?
**Response.** Reuse the profile. The gap is modelled with `MembershipPeriod`
rows and a `StudentLifecycleEvent` (D-059), never a `leftAt` column or a second
profile: history is the product's value, a status flag destroys the answer to
"when were they a member?", and a second profile would fragment history and
duplicate PII.

## Inconsistencies in the brief

### F-09 — "API-first where logical" vs "minimal amount of code"
Building a full REST API alongside a Server-Component portal means writing
every operation's surface twice.
**Response.** Resolved by making **application services** the API-first layer.
The portal and any future HTTP API call the same services, so behaviour and
security cannot diverge, and no HTTP endpoint is written until an integration
needs it (P-01). "API-first" becomes an internal design property rather than a
speculative endpoint inventory.

### F-10 — "Publieke website" vs "privacy by default"
A public site and a database of children's data in one application is inherent
tension, and single-tenancy does not reduce it — the public site and the
student records now live in the *same* database by definition.
**Response.** D-017 — the public surface has no code path to person tables. The
tension is resolved structurally rather than by care.

### F-11 — "Lucky develops autonomously" vs "least privilege"
An agent with full development-lifecycle rights is a powerful principal.
**Response.** D-025 — the boundary is *absent credentials*, not instructions.
Lucky has no production path, no secrets, no real data, and workflow files are
outside its write scope so it cannot weaken its own CI.

### F-12 — The existing SplashTrack repo contradicts the brief's own requirement
The brief demands a Person/Account separation; the prototype has a single
`User` model plus `Student`. This is one of the concrete reasons D-001 rebuilds
from the template rather than evolving the prototype.

## Security risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Scope escape on a list query** (instructor sees students outside their groups) | High | Reach is a required repository argument (D-031); scope-escape tests per module (D-032). *This replaces cross-tenant read as the top internal risk* |
| Public page leaks person data | High | D-017 — no code path exists |
| **Release-pipeline or dependency compromise** | High | F-18 — pinned deps, audit gate, signed images, SBOM, provenance, tag-only release workflow |
| Stored XSS via CMS content | High | Closed token set (D-016); server-side sanitisation on save *and* render; no arbitrary HTML/JS |
| Shared tablet left unlocked | High | `SHARED_DEVICE` mode (D-009) |
| Health data in a backup leak | High | Column encryption (D-013) + encrypted backups |
| Org admin bulk-exports and leaves | Medium | Step-up, rate limit, high-severity audit event visible to the org |
| Operator runs an unpatched version | High | F-17 — advisories, in-app version warning, never-stranded upgrade path |
| Prompt injection via GitHub issue text | Medium | D-025; human-reviewed PR is the only output channel |
| Raw SQL bypassing reach filtering | Medium | Lint flag on `$queryRaw`/`$executeRaw`, explicit reviewer sign-off |
| Third-party font/CDN leaking visitor IPs | Low-medium | Self-hosted curated fonts only |
| User enumeration on public forms | Low-medium | Uniform responses, rate limits, writes go to `Inquiry` not `Person` |

### F-13 — **(Revised)** We cannot patch what we do not operate
**Severity: high, and unfixable by design.** Self-hosting means a vulnerable
instance stays vulnerable until its operator upgrades. We have no fleet to
patch — that was the point — but the residual risk is real and lands on
schools with limited IT capacity.
**Response.** Everything we can control, we do: safe defaults, no default
credentials, automatic migrations, one-command upgrades, plain-language release
notes, published security advisories, and an in-app warning when the running
version has a known advisory (D-034). Beyond that it is the operator's duty,
and the documentation must say so plainly rather than implying we have their
back.

### F-14 — **(Closed)** Fleet-operator threat model
No principal has access to any customer instance, because no such access
exists. Closed by D-012 (final).

### F-15 — Scope filtering has the same failure mode tenancy did
**Severity: high — the highest-severity internal risk in the product.** The
isolation problem did not disappear when multi-tenancy did; it moved down a
level. An instructor must not browse another location's students, another
group's students, or a student outside the session they are assigned to. That
is now enforced by **scope filtering**, which has *exactly* the same failure
mode tenant filtering had: a missed `where` clause silently returns too much.
It fails open, it fails quietly, and no user reports it because nothing looks
broken.
**Response.** The tenancy tests are not simply deleted — they are **replaced**:
reach is a required repository argument (D-031), reach may only be constructed
by `resolveReach()` (D-030), and scope-escape tests are mandatory per module
(D-032). The minimum content of that suite — including the **list** case,
which is the one that must never be dropped — is specified in
`06-delivery.md` §2.1.

### F-16 — **(Closed)** Per-customer cost floor
Hosting cost is the organisation's own. Closed. It reappears only if a hosted
offering is ever added (OD-14).

### F-17 — Outdated self-hosted instances are the biggest residual risk
**Severity: high.** The realistic failure is not a clever attack; it is a swim
school running version 1.0 three years later, unpatched, on a server nobody
maintains, holding children's health data.
**Response.** The version check with advisory warning (D-034); an upgrade path
that never strands a skipped version; migrations that survive long gaps; and
documentation that treats upgrading as a routine operational duty rather than a
project. Consider an explicit end-of-life policy per major version.

### F-18 — Supply-chain compromise now ships to every operator
**Severity: high.** A malicious dependency or a compromised release pipeline
propagates to every organisation that pulls the image, and they trust it
because it is the official artifact.
**Response.** Pinned dependencies and lockfile; Dependabot with a blocking
audit gate; multi-stage builds with a minimal final layer; signed images with
provenance attestation; published SBOM; releases built only from a tag on
`main` by a workflow no contributor — including Lucky — can modify.

### F-19 — A public repository makes leaked secrets permanent
**Severity: medium-high.** In a private repo a committed secret is a rotation
task. In a public one it is scraped within minutes and lives in forks and
mirrors forever.
**Response.** Secret scanning with push protection enabled before the repo goes
public; no real credentials in seeds, fixtures, examples or documentation; the
image generates its own secrets on first run so no example value is ever
plausible as a real one.

### F-20 — Public issues will contain other people's personal data
**Severity: medium.** Self-hosters debugging a problem paste logs, screenshots
and database rows. Those will contain student names.
**Response.** Issue templates warn explicitly and ask for redaction;
maintainers redact on sight; the application's own logs are PII-free by design
(`07-operations.md` §1.1), which makes an accidental paste far less damaging.

### F-21 — "Open source" is not yet a licence decision
**Severity: medium (commercial).** The brief says fully open source so any
party can download and use it. That is a direction, not a licence. Permissive
(MIT/Apache-2.0) allows a competitor to run a paid hosted SplashTrack;
copyleft (AGPL-3.0) requires them to publish modifications.
**Response.** Flagged as OD-13 — a commercial decision, not a technical one,
and expensive to change after third-party contributions arrive.

### F-22 — Better Auth is a young dependency on a critical path
**Severity: medium.** Authentication is the one component where a maintenance
lapse or an unfixed vulnerability is immediately serious, and Better Auth is a
comparatively young project.
**Response.** Accepted deliberately, with three structural mitigations rather
than optimism: it is MIT-licensed and self-hosted, so it cannot be withdrawn or
paywalled; the database schema is **ours** (`UserAccount`, `Account`, `Session`
are our tables, not a vendor's), so data survives any replacement; and every
call site goes through our own `identity` module, so substituting the
implementation is a contained refactor. Additionally: pin the version, watch its
advisories explicitly, and treat an auth dependency bump as a security-reviewed
change rather than a routine one.

**The alternative was examined and rejected** — see D-008. Writing our own
authentication would trade a bounded dependency risk for an unbounded
implementation risk, in public source, on data about minors.

### F-23 — The backup download is a complete exfiltration primitive
**Severity: high.** One click produces a file containing every person, every
medical note and every exam result in the organisation. It is more dangerous
than any individual data screen, and it is easy to treat as a mundane admin
convenience.
**Response.** D-042 — step-up re-authentication, rate limiting, high-severity
audit event, short-lived single-use signed link, and the archive encrypted at
rest so the artefact is inert without the recovery token (D-040).

### F-24 — Losing the recovery token makes backups permanently useless
**Severity: high (operational).** The token is `SECRET_KEY`. Without it the
backup cannot be decrypted and the encrypted columns inside it cannot be read.
There is no reset — that is the point of encryption, but it is a foot-gun aimed
directly at a volunteer administrator.
**Response.** Shown once at setup with an explicit print step and a required
"I have stored this" acknowledgement; re-displayable later under step-up
authentication; surfaced in diagnostics as an acknowledged/not-acknowledged
check; and stated plainly in the installation documentation next to the backup
instructions rather than buried in a security appendix.

### F-25 — "Old backups still restore" fails silently and late
**Severity: high.** This is the promise most likely to be broken by accident,
because breaking it produces no symptom at development time. Someone squashes
migrations to tidy up, or strengthens the encryption scheme, and nothing fails —
until an operator restores a two-year-old backup and either gets an error they
cannot act on, or worse, a database that restores cleanly with unreadable
contents.
**Response.** Three structural commitments rather than vigilance: D-047 (CI
restores every supported release into `HEAD` on every PR), D-048 (never squash
within a major; declare `minimumRestorableVersion`), D-049 (versioned encryption
envelopes with retained legacy decryptors). The encryption case is the nastiest,
because it passes every schema check — it is called out separately for that
reason.

### F-26 — Unused multi-tenant machinery would have been left dormant
**Severity: medium.** The plan was to simply not use the template's tenant
scoping, platform settings and platform roles. Dormant security code is worse
than absent security code: it is attack surface, it must be kept compiling
through every migration, and it teaches the next reader that something is being
enforced when nothing is.
**Response.** D-056 — it is removed at extraction time, not disabled. Accepting
the resulting divergence from the upstream template is the cost.

### F-27 — Retention defaults must not masquerade as legal advice
**Severity: medium.** Shipping retention periods that look authoritative invites
an organisation to adopt them without deciding anything, which leaves them
unable to justify their own processing under Article 5(2).
**Response.** Every default is presented as a **proposal requiring confirmation**
in the setup wizard and the privacy admin area, with the lawful basis field
empty until the organisation fills it. The documentation states the roles
(D-064) and the questions, and explicitly declines to answer them.

### F-28 — The relicensing window closes at the first external contribution
**Severity: high, and time-bounded rather than technical.** The licence was
changed from GPL-3.0 to AGPL-3.0 on 2026-09-01 (D-067). That was only possible
because every commit in the repository traced to a single rightsholder. **The
moment one genuine third-party contribution is merged, the licence is frozen**
unless that person agrees to a change — and in practice contributors disappear,
so "frozen" means permanent.

The design had treated the licence as an open question (OD-13) while the
repository had in fact been carrying GPL-3.0 the whole time, and had already
accepted pull requests. The gap between "we will decide this later" and "this is
already decided, wrongly, and is about to become unchangeable" was invisible
because nobody looked at the repository root.

**Response.**
1. `CONTRIBUTING.md` ships with a **DCO sign-off** requirement (`Signed-off-by:`
   on every commit), enforced by a CI check, **before** the repository invites
   contributions. The DCO does not permit relicensing on its own — it records
   provenance and the right to contribute. It is what makes the contributor
   history auditable if a future licence question ever arises.
2. The `AGPL-3.0` header and the licence file are treated as part of the release
   artefact and checked in CI, so a future refactor cannot quietly drop them.
3. **Generalised lesson, worth more than this instance:** a design document that
   opens a decision must first check whether the decision has already been made
   somewhere in the repository. Several other entries in `08-open-decisions.md`
   deserve the same test — an open decision that is silently already implemented
   is more dangerous than an unmade one, because nobody is looking for it.

## Scalability problems

Covered in full in `07-operations.md` §4. Scale is defined **per installation**
(`00-overview.md` §4.2), not across organisations. Two risks bite first:

1. **Derived progress state.** The group skill matrix (30 students × 40 skills)
   computed from an append-only log is still the first query that will be
   measurably slow, even in a small instance. The materialised summary is
   designed but deliberately not built (D-005).
2. **Audit and attendance table growth.** The two fastest-growing tables within
   an installation. Partitioning plus retention rotation is the answer, and the
   retention policy doubles as the growth control.

Neither justifies added complexity today. Knowing the answer is the deliverable
at this stage; building it would be exactly the premature complexity the brief
warns against.

## Assessment, fees and the v1 re-cut

Raised while closing the gap between the design and what the domain expert
actually described (`15-assessment-and-fees.md`, `00-overview.md` §3.5).

### F-40 — *Aftesten* — the four-eyes gate on exam entry — was absent from the design entirely
**Severity: high.** The word *aftest* did not appear once in `docs/design/`,
and neither did *NRZ*. The entire assessment budget went to the exam (D-052,
D-054, D-062, `ExamAssessor`, `Certificate`, `04-ux.md` §4.4), but in the
process actually used the exam is the formality: a child reaches it only
because a **second, qualified instructor who is not their own** graded every
requirement and found all of them at least *voldoende*. `ExamResult.outcome` +
`remarks?` was the only assessment detail in the schema.
**Response.** `15-assessment-and-fees.md` §2–§3: a versioned criterion
catalogue, an ordinal grade scale, graded per-criterion results, recorded
waivers, `PersonQualification`, and D-085 making the gate a domain invariant
on `ExamCandidate → CONFIRMED` — overridable only with an explicit permission
and a recorded reason.

### F-41 — The independent assessor cannot read the student under the current authorization model
**Severity: high.** The assessor conducting an *aftest* is by definition not
the child's instructor and therefore holds no `GROUP` grant covering them.
Under D-030/D-031 they cannot read the student at all, which makes D-085
unimplementable as the security model stood. The same hole blocked a
substitute instructor, the receiving instructor of a make-up lesson and the
visiting delegate.
**Response.** Resolved in `02-security-privacy.md` §2.1–2.2 as `SESSION`
participation reach (D-068), replacing the `EXAM_SESSION` scope of D-054.

### F-42 — Two criterion catalogues were being specified for the same concept
**Severity: medium.** `Skill`/`SkillRequirement` (`01-domain-model.md` §3.3)
is "criteria per level, assessed per student"; `SchemeCriterion` is the same
thing with an ordinal grade instead of a four-state enum. Shipping both
guarantees divergence — not by anyone's decision, but because a criterion gets
added to whichever catalogue the current screen writes — after which "what
does Diploma A require?" has two answers and two seed catalogues to maintain.
**Response.** D-084 collapses them: `SchemeCriterion` is the single catalogue,
`SkillProgress` is the informal per-lesson log referencing a criterion, and
`AssessmentCriterionResult` is the formal graded observation. This **reduces**
the `skills` module rather than doubling it.

### F-43 — `Certificate` named two different things in the same domain
**Severity: medium.** The schema's `Certificate` means "the physical proof of
a diploma". In this domain a *certificaat* is a **different award with weaker
requirements** — a distinct thing a child is assessed for. One word, two
meanings, one of them already modelled.
**Response.** D-082: rename to `Award`; `AwardType.kind ∈ {DIPLOMA,
CERTIFICATE}` carries the distinction. A rename in a design document today;
after the first release, a migration through every issued diploma row.

### F-44 — The NRZ criteria and thresholds are unverified, and blocking
**Severity: medium, and blocking for one deliverable.** Chapter 15 specifies
the *shape* of the scheme catalogue. Its **contents** — the concrete NRZ
criteria, codes and thresholds — are not confirmed, and were not verifiable in
the sessions that produced this design.
**Response.** No catalogue may be seeded until the criteria are confirmed with
the domain expert. A seed containing invented swimming requirements would be
worse than an empty one, because it would look authoritative and would be
assessed against. `AssessmentScheme.source` and D-083's fork rule exist so
that the provenance of whatever is eventually seeded stays visible.
**Status 2026-09-02: CLOSED — dissolved rather than answered.** Jack's answer
was not a set of criteria but a rejection of the premise:

> The NRZ requirements are **reference, not content to ship**. An administrator
> authors the skill list, the certificates and diplomas it maps to, and their
> requirements **inside the application**. That keeps the product generic.

This is the better answer and it removes the blocker outright:

- **No catalogue is ever seeded.** SplashTrack ships with an empty catalogue and
  no swimming requirements in its source. The finding's original fear — invented
  requirements that look authoritative and get assessed against — cannot occur,
  because the project never asserts any.
- **`AssessmentScheme.source` gains its real meaning.** Provenance is
  "authored by this organisation" rather than "shipped by us and possibly
  forked" (D-083).
- **It generalises the product for free.** A club following a different scheme,
  or the NRZ changing its requirements in 2028, needs no release from us — which
  is exactly what D-160's versioned `CriterionSet` was already built to survive.

**The cost, and it is real: v1 acquires a catalogue-authoring surface.** Somebody
must be able to create an `AwardType`, define its `CriterionSet`, set each
criterion's minimum grade, and publish a version — before a single aftest can be
recorded. That is a screen and a workflow that no chapter currently specifies.
Recorded as **D-164**, and it is now on the v1 critical path in place of the
seeding task it replaces.

### F-45 — Fee tracking's first regret is reconciliation, and it is deliberately not in v1
**Severity: medium.** What kills a tracked-billing feature is not the absence
of a payment provider; it is someone marking 180 charges `PAID` by hand each
quarter from a bank statement in another window. That is worse than the
spreadsheet the school has today.
**Response.** Named in advance rather than discovered. The specific missing
piece is **CAMT.053 / MT940 import with reference matching** — one uploaded
bank file, automatic matching on a structured reference in the charge, the
remainder queued for review. No payment provider, no PSD2, no bank API,
roughly a week. It is out of v1 and it is the **first** thing added after the
first full billing period.

### F-46 — Financial retention conflicts with person retention
**Severity: high.** D-066 defaults person retention to 24 months after the
last relationship ends; Dutch fiscal law wants administration kept seven
years. Adding `Charge`/`Payment` puts both rules on the same rows.
**Response.** D-092: register both tables in the D-014 erasure registry with
a financial retention ground, and **pseudonymise** rather than delete on
erasure. Without this the first erasure request either destroys the
bookkeeping or silently skips it, and which one is not discovered until an
accountant asks.

### F-47 — Adding money raises the value of a breach without changing the controls
**Severity: medium.** The database now holds children's health notes **and**
who owes money. Nothing about D-040 (encrypted backups) or D-042 (the export
as an exfiltration primitive) becomes wrong; both become more load-bearing.
**Response.** Recorded rather than mitigated, deliberately — the correct
controls were already chosen. This finding exists so that the change in stake
is stated when the money tables land, rather than discovered in an incident
report.

### F-48 — "Anonymise attendance to aggregate" was not anonymisation
**Severity: medium.** The retention default for attendance events was
`ANONYMISE` to aggregate. Stripping the student reference does not anonymise
here: a group holds around twelve children, `GroupMembership` is retained and
time-bounded, and session dates are known — so a join and a counting argument
re-identify a large share of the stripped rows. That fails the mechanical
anonymisation test in `02-security-privacy.md`, and describing it as
anonymisation in a privacy notice would be the false comfort D-065 exists to
prevent.
**Response.** D-111: delete expired attendance events. An aggregate may be
kept because it was **computed and stored**, never because a row was
stripped.

### F-49 — Pre-migration backups had no retention policy at all
**Severity: medium.** D-044 takes an automatic backup before every
migration — the right behaviour — and no rule anywhere said what happens to
it. A full copy of the database, including medical notes, therefore
accumulated once per upgrade and outlived every rule in the retention table.
**Response.** D-104/D-111 add it to `01-domain-model.md` §5 as a data class
with a real trigger and cap: deleted after the next successful start, at most
three retained, so that a bad migration discovered late is still recoverable.

### F-71 — `PersonRelationship` was defined twice with different fields, and consent validity depended on the difference
**Severity: high.** One definition carried `evidence?` and no `authority`;
the other carried `authority` and no `evidence`, sitting as a stray row in
prose outside any table. **Both fields are load-bearing** — D-063 requires
`authorityEvidenceId → PersonRelationship`, F-02 requires the `authority`
flag. An implementer picking the second definition never builds `evidence`,
and in a custody dispute the school can show a flag saying someone was
authorised and nothing recording how that was established — precisely the
false comfort D-063 exists to prevent.
**Response.** Merged into one row —
`type, fromPersonId, toPersonId, authority, evidence, validFrom, validTo?` —
with `evidence` **non-optional where `authority = true`**. The duplicate is
deleted.

### F-72 — The attendance entity had two names, and the aggregate boundary used the wrong one
**Severity: medium.** D-061 makes append-only superseding *events* a
data-integrity requirement, but the ER diagram, the §3.4 session row and the
§4 aggregate table all still said `AttendanceRecord` — the superseded,
mutable name, and exactly the three places a schema author copies from.
**Response.** All occurrences renamed to `AttendanceEvent`.

### F-74 — F-08's resolution contradicted D-059 in the sentence that resolved it
**Severity: medium.** F-08's response read "model the gap with `leftAt`" —
exactly the status column D-059 forbids, and for exactly the reason D-059
gives: a flag silently destroys the answer to "when were they a member?".
The text was written before D-059 existed and was never updated.
**Response.** D-059 wins; F-08 above now reads `MembershipPeriod` +
`StudentLifecycleEvent` and no `leftAt` appears anywhere in
`01-domain-model.md`.

### F-73 — Chapter 01 contradicted D-057 twice, in the same chapter
**Severity: medium.** §2.3 asserted *"One table, two module owners — planning
writes it, attendance reads it… This is the only shared table in the design
and it is deliberate"*, and §3.4's Notes column repeated it, while D-057 four
sections earlier says `sessions` owns `ScheduledSession`. The contradicted
text was the part a reader trusts, because it explains itself.
**Response.** Both rewritten to "owned by `sessions`; `planning` and
`attendance` are both consumers". The paragraph defending the shared table as
*deliberate* is deleted rather than softened.

## Platform hardening: secrets, crypto, backup and boot

Raised while specifying `13-configuration-and-setup.md` and
`14-backup-restore-upgrade.md` in detail. Numbered F-95 onward to avoid
colliding with the F-40s above — both sets were drafted concurrently against
the same then-empty part of the register.

### F-95 — `SECRET_KEY` had four lifecycles and does not exist in the template
**Severity: critical.** Different sections of the design gave four mutually
exclusive accounts of the bootstrap secret's lifecycle — operator-supplied
env var, generated on first run, displayed by the wizard, and simultaneously
*being* and *wrapping* the recovery token — on the key that gates every backup
restore and every encrypted medical column. The template has no `SECRET_KEY`
at all: at-rest encryption derives from `BETTER_AUTH_SECRET`, which also
signs sessions and encrypts TOTP secrets, so identifying the two prints a
session-forging key on paper, and separating them silently kills every
restored TOTP enrolment while MFA is mandatory.
**Response.** D-112 states the lifecycle once, in `13-…` §3.1.1: one
bootstrap secret via `SECRET_KEY_FILE`, every other key derived by HKDF with a
purpose label, including the Better Auth signing secret so restore reproduces
it identically.

### F-96 — The backup archive could contain its own decryption key
**Severity: critical.** If key material lived under `DATA_DIR` and assets
were captured as a directory tree, the archive would ship with the key that
decrypts it — every claim that the file is "inert without the token, and
therefore safe to store casually" would be false, with nothing in CI to
detect it.
**Response.** D-113: the application never writes key material to the data
volume, the backup writer excludes the key-material path explicitly, and a CI
test asserts no shipped fixture contains it, by key bytes and by file name.

### F-97 — Restoring a `.stbak` from anywhere else is arbitrary SQL execution
**Severity: critical.** Restore replayed a `pg_dump` produced elsewhere,
against a database role that was conventionally the superuser, with no stated
least-privilege role or restore allow-list anywhere in fifteen chapters. The
attack is the documented recovery path itself: a stranger supplies a
"known-good starter backup" whose dump contains `CREATE FUNCTION` /
`COPY … FROM PROGRAM` / `ALTER ROLE`, and the verification step checked the
archive was *intact*, not *benign* — both the checksum and the manifest came
from the same attacker-supplied file.
**Response.** D-095 makes the v1 export a structured logical export the
application writes and reads itself, deleting the class rather than filtering
it. D-116 makes the database role non-superuser regardless. The chapter now
states plainly that an archive from any source other than the operator's own
instance is untrusted input.

### F-98 — Setup mode was keyed on one deletable row
**Severity: critical.** Setup mode resumed whenever the bootstrap record was
absent, and "New installation" then created an `ORGANIZATION`-scoped
administrator. Any primitive that deletes one row — SQL injection, a
compromised low-privilege credential, a botched restore, a bug in the erasure
transaction — put a populated production database holding thousands of
children's records into an unauthenticated administrative surface.
**Response.** D-099: setup mode requires no bootstrap record **and** zero
`UserAccount`, `Person` and `RoleAssignment` rows. Data with the bootstrap
record missing is `TAMPERED` — refuse to serve, log loudly, break-glass CLI
only.

### F-99 — The setup token went to the logs the design tells operators to publish
**Severity: critical.** The one-time setup token was printed to the container
logs, while the design elsewhere states as an assumption that self-hosters
debugging a problem paste logs into public issues — in a public repository.
Variants: Portainer/Synology/Unraid log panes visible to a household;
centralised log shipping to a third party; log rotation destroying the token
before setup finishes.
**Response.** D-101: write the token to `$DATA_DIR/setup-token` mode 0600 and
print only its path; single use, ≤60-minute expiry, reissued only from the
host; rate-limited with lockout and audited failures.

### F-100 — One key, forever, printed on paper, with rotation that made things worse
**Severity: high.** The recovery token *being* `SECRET_KEY` meant a single
non-revocable secret protecting the backup archive, every medical column and
every stored credential — re-displayable in the UI. Rotation was worse than
useless: re-encryption cannot reach `.stbak` files already written, so
afterwards the operator holds two permanently critical secrets and every
historical archive stays unprotected by the new key. No entropy floor was
stated, and the restore endpoint had no rate limit.
**Response.** D-114 (two-level envelope: an Argon2id passphrase over a master
key, per-archive data keys, rotation = re-wrap) and D-115 (≥128 bits,
Crockford base32 with a check character, re-display audited at high severity
and notified to all administrators, restore endpoint rate-limited and
audited).

### F-101 — The `v1:` envelope had no key id and no AAD, and GCM was assumed to stream
**Severity: high.** Three defects with the same root — the crypto was
described rather than specified. No key id: an interrupted rotation leaves two
keys in one column with no discriminator, every failed decrypt
indistinguishable from corruption. No AAD: a ciphertext blob is portable, so
any careless write can move child A's encrypted allergy note into child B's
row, where it decrypts and authenticates perfectly. Streaming: plain
AES-256-GCM over a multi-gigabyte archive either buffers the whole thing or
encrypts chunks independently, in which case truncation, reordering and
splicing all verify, and the manifest was parsed before the archive was
authenticated.
**Response.** D-096 (`v1:<keyId>:<nonce>:<ct>` with AAD over
`(table, column, pk, keyId)`), D-097 (one envelope module with a decryptor
registry plus committed golden vectors), D-102 (framed AEAD with
sequence-bound chunks and a final-chunk marker; manifest authenticated as its
own message before any parsing).

### F-102 — Chapter 03's "non-negotiable properties of the image" were false
**Severity: high.** The stated list inverted chapter 13 ("all configuration
via environment variables") and contradicted D-055/D-044 ("migrations run
automatically on start"), and none of the six claimed image properties held
against the actual Dockerfile: single-stage, undigested base image, dev
dependencies and full source tree in the final layer, running as root;
`pg_dump` absent although claimed present.
**Response.** The list is rewritten as target properties with current status
stated honestly. The configuration bullet now reads "bootstrap secrets only;
all runtime configuration is database-backed" (D-036/D-037); the migration
bullet points at D-055/D-098; D-116's non-superuser role is added alongside
"runs as non-root".

### F-103 — Scheduled remote backup was an unguarded exfiltration channel
**Severity: high.** D-042 wraps the backup **download** button in step-up,
rate limiting, high-severity audit and a single-use signed link — while a
backup **destination** setting sat beside it as an ordinary text field. A
departing administrator never touches the guarded button: pointing the
destination at their own bucket ships a complete copy of every person, every
medical note and every exam result, nightly. The destination did not even
exist in the codebase (`blob-storage.ts` supports only `"local"`).
**Response.** D-103: S3 destinations are out of v1 — mounted volume only.
When a remote destination arrives it carries the download's controls in full,
plus a 24-hour delay or second-administrator approval before the first backup
reaches a new destination, shown permanently on the dashboard.

### F-104 — Backup retention contradicts the erasure promise
**Severity: high.** `02-security-privacy.md` §5.3 commits, without
qualification, that special-category data is "hard-deleted, never
anonymised" at 12 months, while backup retention kept rolling and
pre-migration copies indefinitely on the same volume under the same
never-rotated key. A parent requests erasure, the school reports the medical
note deleted, and it is present in up to a dozen archives plus an unbounded
snapshot set.
**Response.** D-104: cap pre-migration backups (delete after the next
successful start, keep at most three); require backup retention ≤ the
shortest special-category retention or surface the mismatch as a diagnostics
warning; publish a computed **backup horizon** the organisation can quote in
its privacy notice, shown at the moment of erasure. §5.3's promise needs the
qualifier "from live storage; persists in encrypted backups until they age
out" — flagged for that chapter, not edited here.

### F-105 — D-038's worked example asserted the opposite of what the template does
**Severity: high.** The design claimed the template "already loads Entra
configuration at auth-context init, so changing a provider rebuilds the auth
context rather than the container". The template's own source comment says
the opposite: configuration is read once at construction and applies only on
the next restart, because `auth` is a module-level singleton across worker
processes and the OAuth plugin takes a static provider array.
**Response.** The claim is corrected, the mechanism that would actually work
is specified (a versioned `getAuth()` against a `settings_version` counter),
and D-106 marks the identity-provider case as **requiring a spike** before
D-038's no-restart promise is trusted for it.

### F-106 — Key rotation would silently un-enrol every administrator's second factor
**Severity: high.** The re-encryption command could re-wrap the application's
own envelopes but not Better Auth's internal TwoFactor secrets, which the
template encrypts with `BETTER_AUTH_SECRET` directly — rotating the key would
destroy every administrator's TOTP enrolment at once, while MFA is mandatory
for administrators, locking out exactly the accounts that could fix it.
**Response.** D-112's HKDF split brings TOTP secrets under the same root, so
rotation covers them, and D-105 adds a restore-matrix invariant asserting an
enrolled TOTP still verifies after a restore with the same token.

### F-107 — The restore matrix was unimplementable, empty at v1.0, and omitted the case F-25 called worst
**Severity: high.** D-047 named no fixture source, generator, key or storage,
and at v1.0 there are zero prior releases, so the matrix would ship green
while protecting nothing — yet fixture generation must ship in v1.0 or v1.1
can never test restoring from it. F-25 named the encryption case "the
nastiest" and it was the one left out of the test meant to cover it.
**Response.** D-105: the release workflow generates a fixture (boot the
just-built image, seed deterministically, back it up under a fixed public
test key, upload as a GitHub Release asset) and the matrix asserts, among
other things, every encrypted column decrypting to known plaintext and an
enrolled TOTP still verifying.

### F-108 — `zod` is not present in either repository
**Severity: medium.** The settings-registry design ("one Zod schema per
setting") and `05-technical.md`'s module template both assume the dependency
is inherited. It is in neither `package.json`, and there are no imports of it
anywhere.
**Response.** Stated plainly in `13-…` §3.2 as a build task rather than an
existing capability.

## The v1 re-cut: mis-scope, not over-scope

Raised while closing the six-capability gap named in `00-overview.md` §3.5.

### F-80 — v1 was mis-scoped, not over-scoped
**Severity: high.** About 45% of specified effort went into a self-hosting
*product* — an identity-provider registry, a restore-from-every-release CI
matrix, a settings registry with a generated UI, a separate UAT environment,
a retention engine, a CMS, a versioned public API and a fifteen-check
pipeline — for an operator who does not exist. Meanwhile six capabilities
named as weekly needs were absent from the documents entirely, one of them
the single most consequential control in the domain.
**Response.** D-120. Both estimates are recorded, not just the new one
(`00-overview.md` §3.5.3). OD-2's closure is what makes the cut safe rather
than a gamble.

### F-81 — No breach-response capability at all
**Severity: high.** The controller must assess and notify within 72 hours
(Article 33) and notify data subjects for high-risk breaches (Article 34).
This is health data about children, so the Article 34 threshold is met by
default. The design shipped an audit trail and a list of metrics and stopped.
**Response.** D-128, R-37, `07-operations.md` §1.4. The third question — whose
data was in a leaked artefact — is answered honestly rather than solved: the
backup manifest holds row counts, not data subjects, so a leaked archive is
treated as covering **every** subject in the instance at that timestamp.

### F-82 — The design asserted CI capabilities that do not exist
**Severity: high.** The design claimed the template's CI "already runs …
container build, and a migration-against-populated-database job". The actual
`ci.yml` has three jobs — `verify`, `e2e`, `migrate-populated` — with no
container build, no `npm audit` gate, no CodeQL, no secret-scanning job and no
axe assertion anywhere in `tests/`. Of fifteen required checks, seven
existed. Compounding it, `deploy-uat.yml` builds at deploy time on the target
host — the direct inversion of D-022.
**Response.** Both chapters corrected in place (D-136). v1 ships eight
blocking checks, listed in one place so the two chapters cannot drift apart
again.

### F-83 — An application that will not load has no equivalent of a wet sheet
**Severity: high.** The design measured itself against another system; there
is none — the incumbent is a clipboard. Paper never has a zero-percent day. An
app that will not load shows nothing and the instructor has no move, and the
failure is not recoverable in the usual sense: when paper fails the
instructor blames the rain, when the app fails they go back to paper and do
not come back.
**Response.** D-129 — print fallbacks in the first release, and P-02's
"prepared, not built" is now explicitly conditional on them.

### F-84 — The attendance latency target was set without knowing about a lock
**Severity: medium.** `AuditEvent` is a hash chain whose appends serialize on
a Postgres advisory lock. Thirty attendance events plus thirty naively
chained audit rows per group registration serialize against a lock contended
by every other audit writer, under a p95 target written before the lock was
known about.
**Response.** D-126: one audit event per group registration, decided before
the load test is written, not after it fails.

### F-85 — The module-boundary lint rule does not catch the violation it exists to prevent
**Severity: medium.** `no-restricted-imports` catches cross-module *imports*.
The violation D-057 was written to prevent — a direct Prisma call into
another module's table — imports nothing and passes cleanly.
**Response.** D-125: boundaries enforced on Prisma model access, not only on
imports.

### F-86 — The WebAuthn RP-ID lockout sits on the expected deployment path
**Severity: medium.** Starting on something like `http://nas.local:3000` and
moving to a real domain later is the **expected** sequence for this
deployment, not an edge case, and passkeys — the design's best wet-hands
answer — are exactly the credential a domain change invalidates.
**Response.** D-132: RP ID set deliberately at setup, loud warning on change,
password + TOTP fallback retained per account.

### F-87 — The skill-matrix undo boundary requires an administrator for a mis-tap
**Severity: medium.** Two states existed: free undo before Save, and a
permissioned `skills.revoke` with a mandatory reason after it. A
`GROUP`-scoped instructor holds no `skills.revoke`, so a fat-fingered
achievement on a 30×40 grid with wet hands becomes an administrator's job,
weekly, by construction.
**Response.** D-131 — a bounded self-correction window on the instructor's
own sign-offs from the current session.

### F-88 — The Article 15 export discloses third parties and can silently omit health data
**Severity: medium.** Two defects in one surface: the export includes
guardian details, instructor names and staff-authored notes with no preview
and no redaction pass, while the erasure flow next door has a mandatory
preview; and medical data is omitted unless the *requester* holds
`students.medical.read`, when the entitled party in an Article 15 request is
the **data subject**, not the operator running the export — so a member
administrator can produce an export that looks complete and is silently
missing the health data.
**Response.** Reuse the erasure preview pattern for export, including what is
disclosed about third parties, and make the export fail loudly rather than
quietly omit (`04-ux.md` §4.6). The redaction pass and the
retention/recipients/source annex remain to be specified in
`02-security-privacy.md`.

### F-89 — Five decisions have no statement in any active chapter
**Severity: medium.** D-011, D-015, D-027, D-028 and D-029 existed only as
register rows, with their full text in chapters 11 and 12 — whose banners
forbid citing them as requirements — and three of the register's own "Where"
pointers named the wrong section.
**Response.** D-133: for a withdrawn or superseded decision the register row
is the authoritative text and says so. The register's pointers are corrected
at the same time.

### F-90 — Whether a digital pupil list exists has never been checked
**Severity: medium — and the cheapest open question in the set.** CSV import
has been described as what makes a pilot possible at all, but the incumbent
is pen and paper — if the school genuinely runs on paper there may be no
digital list to import at all.
**Response.** OD-16. A different question from OD-1: if both answers are
"nothing", R-29 and the import path leave v1 together.
**Status: closed 2026-09-02.** The two answers diverged. OD-1 is "nothing" (no
deployed prototype); OD-16 is **a commercial membership administration system
that offers export**. R-29 therefore stays in v1 with a new source, D-157
forbids specifying a column mapping before a sample export is in hand, and the
pen-and-paper premise is confirmed only for the poolside surfaces (attendance,
assessment) — not for the member base. The answer also raised **OD-18**:
whether that system is retired or stays authoritative, which decides whether
chapter 15's `Membership` half is a system of record or a read-only projection.

### F-91 — D-048 was enforced by nothing
**Severity: medium.** "Migration chains are never squashed within a major
version" is the policy that keeps every self-hoster's old backup restorable,
and it was a sentence in a document with no test behind it.
**Response.** D-124: `tests/unit/migration-history-append-only.test.ts`.

### F-109 — No permission existed for assigning roles, and no anti-amplification rule
**Severity: critical.** (Reviewer A-1.) Grepping the active set, `roles.assign`
appeared only in `07-operations.md` §1.3's high-risk permission list and existed
in no catalogue. Role assignment is the highest-privilege operation in the
product, and `AccessGroup` (§2.7) bundles *permissions plus scopes* into one
assignable object. A `UNIT`-scoped Location Manager opens People & roles —
listed in `04-ux.md` §1 as an admin screen with no permission named — and
assigns themselves or an accomplice an `ORGANIZATION`-scoped role, or an access
group containing `students.medical.read`. They hold every medical note in the
school. Step-up re-authentication is required for role changes and is no
obstacle whatsoever: it is their own password and their own second factor. The
audit event records a legitimate-looking role change.
**Response.** D-139 (three invariants: no amplification, scope confinement,
window confinement — in the grant service, not the UI, tested per module) and
the catalogue additions in `02-…` §2.5: `roles.read/assign/manage`,
`accessgroups.read/assign/manage`. `roles.manage` is separated from
`roles.assign` because editing which permissions a role carries is strictly
stronger than assigning it.

### F-110 — An admin-configurable OIDC provider is an account-takeover primitive
**Severity: critical.** (Reviewer A-2.) The registry stores per provider an
issuer URL, a client id, an encrypted secret, a **claim→field mapping**, a JIT
toggle and a JIT role — guarded by "a permission-guarded admin screen" whose
only candidate permission was `organization.settings.manage`. Nothing stated how
an external identity binds to an existing `UserAccount`. A Planner or office
manager holding that one permission adds a free Keycloak tenant they control,
maps `email` onto the administrator's address, passes the mandatory test
connection against their own IdP, and signs in as instance administrator. MFA on
the local account is irrelevant — the local method is never used. Second attack:
edit only the token endpoint of an *existing* provider, leaving the secret in
place, and the application posts that client secret to the attacker on the next
login. A control that hides a secret from reads while allowing a redirect of
where it is sent is not a control.
**Response.** D-140, recorded as **preconditions** rather than v1 build items —
the registry is out of v1 (D-120), which is why the hardening is cheap now and
expensive later. Every clause is structural rather than procedural: link on
`(issuer, sub)` only, delete the JIT-role field rather than defaulting it to
none, clear the secret on any endpoint change, opt-in per account for
`ORGANIZATION`-scoped principals.

### F-111 — The lockout safeguard justifying runtime IdPs cannot be enforced
**Severity: high.** (Reviewer B-5.) "Local administrator login can never be
disabled while it is the only working method" was presented as one of two
*mandatory mitigations* for D-035. It is bypassed by configuring any second
provider — including the attacker's, per F-110 — after which local login is not
"the only" one and every check passes. And "working" is not decidable: a
provider that passed a test at 14:00 stops working at 14:05 through certificate
expiry, a tenant policy change, an admin removed from a group, or a discovery
endpoint the application can reach and users cannot. The test-connection gate
has the same shape — it proves the app reached the IdP once, not that a human
can log in through it.
**Response.** D-141. The claim is deleted, not softened. The real control is
already in the design and was not being credited: the break-glass CLI (§7 of
`13-…`), which depends on host access rather than a network-reachable secret.
The enforceable invariant that replaces it — at least one local
`ORGANIZATION`-scoped account with a verified MFA factor, checked at the
database — is re-evaluated on role revocation and account disable, not only when
SSO is switched on.

### F-112 — `resolveReach` had no shape for four of six scope types
**Severity: high.** (Reviewer B-6.) The signature returned
`{units, groups, all: false}`. An internal examiner (`COURSE`) and an aftest
assessor or external examiner (`SESSION`) both resolve to empty reach: every
list denies them and the candidate list they are physically present to assess is
blank. D-031 calls list filtering "the highest-risk code path in the
application", and the fix under time pressure is `{all: true}`. Separately,
D-031's claim that a required argument "turns a silent over-fetch into a type
error" was overstated: the compiler enforced *presence*, and
`{units: [], groups: [], all: true}` was a literal writable at any call site or
test helper.
**Response.** D-147 — an opaque branded discriminated union covering every scope
type, `NONE` explicit, `UNION` explicit, no `all` field, constructible only by
`resolveReach`. `06-delivery.md` §2.1 already requires asserting that a `Reach`
cannot be constructed outside the resolver; this is the shape that makes the
assertion possible. **One part of the reviewer's framing is rejected:**
`all: false` is default-*closed*, not "a default-open shape" — a forgotten field
denies. The two real defects (incomplete coverage, forgeability) are sufficient.

### F-113 — `RoleAssignment` could not express the expiry two decisions depend on
**Severity: high.** (Reviewer B-7.) The tuple was
`(personId, roleId, scopeType, scopeId)` with no validity fields, while D-052
requires "a mandatory expiry after which it lapses automatically", §2.4 lists
External examiner as "always with an expiry" and Internal examiner as
"time-bounded", and D-068 says the `SESSION` grant "carries its own
`validFrom`/`validTo`". As specified, the external examiner who assessed one
Saturday in March 2026 retains `exams.assess` and `exams.results.record` on that
session **forever**, and because D-062 makes results append-only, an amendment
they make years later becomes the effective result. Nobody at the school has any
reason to look at that assignment again.
**Response.** D-144. Note the enforcement detail: expiry is a predicate inside
`requirePermission` and `resolveReach`, **not** a cleanup job — a job that has
not run yet is an open grant, and a predicate cannot be behind schedule.

### F-114 — `GROUP` coverage was per-entity, permanent, and ambiguous in the sentence that defines it
**Severity: high.** (Reviewer B-8 and C-15, which are one defect.) Coverage read
"the students in it *for the period of their membership*" — which can mean the
instructor's access lasts during the membership, or that they may see records
dated within it. In a union-of-grants model over an append-only membership table
that D-059 keeps for life, the natural implementation is the second: **every
instructor who has ever taught a child retains read access to that child's
complete record permanently.** And because scope covers an *entity*, one
`students.read` opens `Progress · Attendance · Enrolments · Exams · Notes ·
Privacy` — every group she has been in, attendance at other locations, failed
exam attempts, guardian relationships. None of it is needed to teach a Tuesday
lesson. The cross-unit case compounds it: a child registered at Zuidbad
attending a summer course at Noordbad is fully reachable by both Location
Managers, because effective reach is a union and the broader answer always wins.
**Response.** D-145: live evaluation of both membership and instructor
assignment at query time; per-relation coverage with scope-escape tests
asserting on the **fields returned**, not only on row reachability; and the
home-unit rule for profiles versus the group-unit rule for that group's records.

### F-115 — Pastoral notes and public inquiry free text sat outside the protected class
**Severity: high.** (Reviewer B-9 and B-10, which share one root: protection
tracked the permission pair rather than the data.) D-010 promises medical and
pastoral notes "their own permission **pair**", singular; the catalogue defines
**two**, and §5.3 named only medical remarks as special category — so pastoral
notes were gated by `students.notes.*`, an ordinary-looking teaching permission,
plausibly unencrypted, unaudited and present in every export and every backup.
*"Moeder zit in de opvang"*, *"via jeugdzorg aangemeld"*, *"mag niet opgehaald
worden door vader"* is more sensitive than an allergy and may be special
category by inference. Separately and worse, `Inquiry` takes free text from an
**unauthenticated public form**, and in this domain the first message a parent
sends is very often *"mijn zoon heeft epilepsie…"*. Inquiry reach was
instance-wide, D-013 covered `students` columns only, D-010's audit rules
covered `students.medical.*` reads only, and the table lives in the `pages`
module — so the Content Editor, whose catalogue entry says in bold "**No person
data**", would have been given health data about named children by module layout
alone.
**Response.** D-148 defines one protected free-text class over four fields
(medical, pastoral, assessment remarks, inquiry text), all encrypted under the
D-096 envelope, audited on read, export-excluded by default. `inquiries.read`
and `inquiries.manage` are added to the catalogue and explicitly excluded from
the Content Editor bundle. **The reviewer's recommended fold of pastoral into
`students.medical.*` is rejected with reasoning** (see §3). The most valuable
part is the cheapest: a purpose-and-retention line at the capture point, because
the real risk in a free-text field is what staff type into it.

### F-116 — Audit tamper-evidence rested on intent and one database role
**Severity: high.** (Reviewer B-13, partly overtaken.) "Append-only. Never
updated, never deleted by application code" is a statement about intent. Two of
the reviewer's three sub-claims were already answered by a later pass — the
template's `AuditEvent` **is** a hash chain (`05-technical.md` §5, D-126) — but
two gaps remained and both belong to the actor the trail exists to catch. One
database role serves the whole application, so a compromised administrator
exports the member base and deletes the four rows recording it, undetectably in
practice because nobody runs a verification pass. Alternatively they lower audit
retention to one day — audit retention is an organisation-configurable policy
under D-065 — and the maintenance job destroys the evidence legitimately.
**Response.** D-149: verification surfaced where a human sees it
(`audit:verify` plus a diagnostics line); an `INSERT`-only database role on
`AuditEvent`, which only means anything because D-116 already makes the
application role a non-superuser; and a retention floor enforced by the settings
classification (D-150). The related retention *mismatch* — audit at 24 months
against exam results at 10 years, so the record of who recorded a diploma
outcome dies eight years before the outcome — is a hand-off to `01-…` §5 and
`07-…` §1.2 (§4 below).

### F-117 — MFA verification was unthrottled, and the MFA mandate may have been a checkbox
**Severity: high.** (Reviewer B-16.) Rate limiting covered login, password reset,
export and public forms. It did **not** cover MFA/TOTP verification — a 6-digit
code without throttling is brute-forceable, and MFA is the stated compensating
control for the highest-privilege accounts in the product (R-13, FM-7) — nor
setup-token submission, recovery-token entry at restore, or the signed backup
link. Compounding it, `13-…` §3.2 puts "password policy, session timeouts, rate
limits" in a live-editable Security settings category without saying which
entries are load-bearing. If "MFA mandatory for administrators" is one of them,
the mandate is a checkbox that `organization.settings.manage` or
`splashtrack settings:reset` can clear; if it is not, that was stated nowhere.
**Response.** The §4 controls table now names all four endpoints and requires
**lockout with an audited failure event**, not merely rate limiting — an
attacker who is only slowed down still gets there overnight. D-150 classifies
every setting `free`/`bounded`/`invariant`, puts the MFA mandate in `invariant`
with no override flag, and gives `bounded` entries hard floors that
`settings:reset` also respects.

### F-118 — Four admin-controlled server-side fetch surfaces, no SSRF consideration anywhere
**Severity: high.** (Reviewer B-17.) OIDC discovery URL, SMTP test-send to an
arbitrary host:port, backup destination endpoint, version check. The words SSRF
and egress appear nowhere in fifteen chapters. A user with
`organization.settings.manage` points discovery at
`http://169.254.169.254/latest/meta-data/iam/…` and reads the error, or at
`http://10.0.0.5:9200/` — and the SMTP test turns the settings page into an
internal port scanner from inside the operator's network. The instance is
typically the only thing the school has exposed.
**Response.** D-142. The clause that matters most is the last one: never return
the response body, status or a distinguishing error to the client. An error
message that differs between "connection refused" and "timed out" is a scanner
regardless of what else is blocked.

### F-119 — Nothing handled a child reaching the age of digital consent
**Severity: medium.** (Reviewer C-2.) Guardian authority is recorded with
validity dates and nothing re-evaluates it when the subject comes of age. A swim
school's eight-year-olds become sixteen-year-olds inside the retention window;
parental authority to consent lapses by operation of law, not by a `validTo`
someone remembered to set, so the `ON_BEHALF_OF` record stays apparently valid
indefinitely.
**Response.** D-151 — derived from `Person.dateOfBirth`, which the model already
holds, against a configurable age-of-consent setting, evaluated at read time
like every other validity in the chapter. This is the cheapest control in §5 and
the most predictable consent failure in the domain.

### F-120 — Consent and lawful-basis registration were one table, so withdrawal and objection were conflated
**Severity: medium.** (Reviewer C-3.) `Consent.legalBasis` ranges over four
values with a `withdrawnAt` field, so the model permits
`legalBasis = CONTRACT` with a populated `withdrawnAt` — the exact combination
§5.4 spends its length arguing must not exist. The retention logic and UI would
either treat withdrawal of a contractual basis as consent withdrawal or ignore
it, and neither is detectable. Also missing: withdrawal had no stated
*consequence* anywhere. F-04 says photos are deleted "on erasure", while
withdrawal of photo consent is the far more common event.
**Response.** D-152: a schema constraint rather than a UI rule; objection as its
own event; and a declared withdrawal cascade per purpose. **The reviewer's
proposed third table is rejected** — see §3.

### F-121 — The Article 15 export could silently omit health data and disclosed third parties
**Severity: medium — extends F-88, which staged this for chapter 02.**
(Reviewer C-4.) Medical data is included only when the *requester* holds
`students.medical.read`, but the entitled party in an Article 15 request is the
**data subject**: a member administrator with `privacy.export` produces an
export that looks complete, is delivered as the organisation's Article 15
response, and is silently missing the health data. The mechanism converts a
permission boundary into a compliance failure with no signal. It also discloses
guardian details, instructor names on sign-offs, staff-authored notes and audit
actor ids — other people's personal data — with no preview and no redaction,
while the erasure flow next door mandates a preview. And Article 15's
requirements to state recipients, retention periods and the source of the data
were unaddressed.
**Response.** D-153. All three of the missing Article 15 elements are derivable
from data the design already holds, so the annex is **generated** rather than
typed and cannot drift from the `RetentionPolicy` table it describes.

### F-122 — Erasure versus the audit trail was unresolved on a compliance-critical path
**Severity: high.** (Reviewer B-12.) D-014 requires a registry containing every
table referencing `Person`, with a test asserting completeness. `AuditEvent`
records an actor person id and a target id — it references `Person` — and is
simultaneously declared append-only, never updated, never deleted. These cannot
both hold: either erasure nullifies the ids, destroying the accountability
record D-026 and the product thesis depend on while mutating an append-only
table, or `AuditEvent` is silently exempted from the registry whose completeness
test is the entire mechanism preventing forgotten tables. **The test as
described would fail on a correct implementation**, which is how this would have
been discovered.
**Response.** D-154 — two entry kinds in the registry, `erase` and
`exempt(ground, until)`, with the ground named in the registry file and
enumerated in the erasure report to the data subject. This generalises a shape
the design had already accepted as a one-off for `Charge`/`Payment` (D-092).

### F-123 — `ANONYMISE` was prescribed where genuine anonymisation is not achievable
**Severity: medium — and already half-corrected.** (Reviewer B-19.) §5.6 argues
correctly and at length that pseudonymisation is not anonymisation; the
retention table two chapters earlier then set attendance to `ANONYMISE` "to
aggregate" at 24 months, while student profiles, group memberships and session
records are retained for 24 months or longer. Strip `studentProfileId`, keep
`sessionId` and timestamps: a group holds twelve children, `GroupMembership` is
time-bounded and retained, session dates are known. Re-identification is a join
and a counting argument, and the school would then tell a parent their child's
attendance was anonymised.
**Response.** The attendance row was already corrected to `DELETE` by the domain
pass, on the same reasoning, as D-111/F-48 — the two passes reached it
independently, which is a useful signal about the argument. What was still
missing was the **rule**, so the next data class is not decided by intuition:
D-155 gives `ANONYMISE` one mechanical definition and restricts classes that
cannot meet it to `DELETE` or `REVIEW`.

### F-124 — `SELF` was an implicit universal grant, which D-030 forbids
**Severity: medium.** (Reviewer C-7.) The scope table granted `SELF` to "every
authenticated person, **implicitly**", and never said which permissions the
implicit grant carries. If `SELF` is evaluated as a scope match without an
explicit `RoleAssignment`, then `requirePermission('students.medical.read',
{student: self})` may pass for any authenticated person holding no grant at
all — deny-by-default (§1.1 rule 2) defeated by an implicit rule in the same
document.
**Response.** D-146: a seeded role assignment with a closed enumerated
permission set, subject to §2.6 like every other grant and visible in the admin
UI. The reviewer's related point about `RELATED` is **already resolved** — OD-5
removed it from the enum entirely on 2026-09-01 (D-122), which is the reviewer's
own recommendation, reached before the review landed.

### F-125 — The diagnostics page had no permission and ranks instances by exploitability
**Severity: medium.** (Reviewer C-6.) `13-…` §8 shows version, migration state,
DB connectivity, storage writability, backup age, effective config with
provenance — and *"whether a newer release with a security advisory exists"*. No
permission is named and no catalogue entry existed. An attacker scanning for
SplashTrack instances would get a machine-readable answer to "is this one
exploitable?" plus its backup posture. F-17 already names unpatched instances as
the biggest residual risk; this page ranks them.
**Response.** D-156. **A note on the reviewer's framing:** the chapter never
says the page is unauthenticated — the reviewer assumed the natural
implementation of "a diagnostics page for support". The assumption is fair and
the defect is real, but it is a *missing statement*, not a stated mistake, and
the fix is the same either way. The "safe to paste into a public issue" property
is good and is kept; pasteability and authentication are independent.

### F-126 — "No DPA is needed between us" is a legal conclusion in a document that promises not to give one
**Severity: low.** (Reviewer C-16.) D-064 is the best-reasoned GDPR passage in
the set and gets the controller/processor position right, including that a
hosting provider or a consultant operating the instance *may* be a processor.
Its own trade-off paragraph says the design "states the roles and points to the
questions; it does not answer them for anyone" — and then `10-findings.md` F-05
states flatly "**No DPA is needed** between us", and D-064's bullet said a DPA
does not arise. Both are conclusions about the reader's obligations.
**Response.** `02-…` §5.1 restates it as fact — *the project receives no
personal data from your installation and performs no processing on your behalf;
whether any agreement is required between you and any party is your assessment
to make with your own advisor.* The F-05 sentence itself is a hand-off (§4).

### F-127 — `SHARED_DEVICE` remained normative in chapter 02 after v1 cut it
**Severity: medium.** (Reviewer B-15, and a live inconsistency.) D-009 was
**opt-in by the party it restricts**: "a session *may be marked*
`SHARED_DEVICE`" never said by whom, and the behaviour an instructor meets first
— a shortened idle timeout on a wet tablet with a queue of children — is the one
they turn off. If it is a device cookie, whoever holds the tablet clears it; if
it is a network heuristic, that was never stated. It was cited as *the*
mitigation for two separate High risks and for FM-13, so the strongest control
in the poolside threat model was a self-declaration. `00-overview.md` §3.5.1
already moved it out of v1 on exactly this reasoning; chapter 02 still specified
it as an active decision, and §1.3 and §4 stated two different rules for
photograph suppression. Separately, D-009's "suppress PII beyond first name +
photo" is backwards: for a child a photograph is far more identifying than a
surname.
**Response.** D-143 supersedes D-009 and records what v1 actually ships — three
of the four behaviours obtained from the Instructor role holding no export, bulk
or admin permission, plus a role-based idle timeout, with nothing to un-mark.
The photograph rule is now stated **once**, in §4: first name and surname
initial on shared surfaces, photograph revealed per student on explicit tap,
that reveal audited. One tap is affordable poolside; a face book of every child
in the building for anyone holding the tablet is not.

---

### F-128 — The retention table stated no lawful basis
**Severity: medium.** The prose introducing the table promised to answer "on what
lawful basis it is held" for each data class. The table had no such column, so
the one question an organisation must answer in order to defend or change a
default was the question the defaults did not state.
**Response.** D-097 adds a `lawfulBasis` column with proposed bases, and prints
*unresolved* where the basis genuinely is — most visibly on exam results and
awards, where §5.2 already says the ground must be identified per organisation
rather than assumed.

### F-129 — F-08's resolution contradicts D-059 in the sentence that resolves it
**Severity: medium.** (Raised as **M-11**.) F-08's response reads "model the gap
with `leftAt`" — exactly the status column D-059 forbids, and for exactly the
reason D-059 gives: a flag silently destroys the answer to "when were they a
member?". F-08 is stale text written before D-059 existed.
**Response.** D-059 wins. The domain chapter now implies nothing otherwise — no
`leftAt` appears anywhere in `01-domain-model.md`. **The F-08 text itself is in
`10-findings.md` and was not edited by this agent** — see §3 below.

### F-130 — Break-glass CLI events had no actor and notified nobody
**Severity: high.** `07-operations.md` §1.2 requires every audit event to record
an actor person id and an actor session or credential. A CLI invocation has
neither, and the chapter listed break-glass invocation as auditable "even when
no application session exists to attribute them to" — naming the gap without
closing it. Someone with brief host access (a contractor, an ex-sysadmin whose
key was never removed, anyone in the `docker` group) runs `admin:grant-admin`
and holds a standing Instance Administrator account, traced only by one row, in
a UI nobody opens, attributed to nobody.
**Response.** CLI events carry a `system:cli` actor with host user, container
id, timestamp and subcommand; every invocation notifies all `ORGANIZATION`-scoped
administrators and raises a banner a *different* administrator must dismiss;
`admin:grant-admin` issues a 24-hour grant rather than a permanent one
(`07-…` §1.2, `13-…` §7).

### F-131 — "The version check sends nothing" was not exact
**Severity: low — on the list because the design's credibility rests on claims
like this being exact.** D-034 said the only outbound call "sends nothing but
the version it is checking… no identifiers, no counters". Every HTTPS request
discloses a source IP and a User-Agent to infrastructure someone logs, and for a
school instance it also reveals that this organisation runs SplashTrack, at this
address, at this version.
**Response.** State the disclosure plainly, fetch the **complete** advisories
file rather than querying per version so the request reveals nothing about the
running version, keep the default on (F-17 justifies it), and name the
`update.check.enabled = false` opt-out in the same paragraph
(`03-deployment-model.md` §2.1).

### F-132 — ISR caching was declared safe because tenancy was removed
**Severity: medium.** `03-…` §5.4 declared the cache-key hazard "gone" with
tenancy. It is reduced, not gone: any public page rendering session-dependent
chrome — a "logged in as…" nav — caches one visitor's view for every other
visitor, single-tenant or not.
**Response.** Public pages are rendered with **no session read at all**, which
is also what makes D-017's structural claim true at the rendering layer rather
than only at the data layer (`03-deployment-model.md` §5.4).

### F-133 — Audit retention outlived nothing it evidences
**Severity: high.** Audit events were retained 24 months; exam results and
awards up to 10 years. The record of *who* recorded a diploma outcome would be
destroyed eight years before the outcome, in a design that justifies append-only
results with "a parent disputes a diploma decision".
**Response.** The audit row in `01-domain-model.md` §5 now states that audit
retention must be at least as long as the longest-retained class whose changes
it evidences, with a 12-month floor (D-149/D-150) and the shipped default
flagged for reconciliation rather than silently left at 24 months. If
reconciliation is rejected on volume grounds, the consequence is stated in the
privacy screen as a limit on what the organisation can reconstruct.

### F-134 — No DPIA material existed for processing that plainly triggers Article 35
**Severity: high.** Large-scale processing of special-category data concerning
children, with new technology, meets the Article 35 criteria several times over.
The word DPIA appeared nowhere in fifteen chapters. F-27 is right that the
project cannot give legal advice — but a **template** is not advice: it is a
list of the processing operations the software actually performs, which only the
project can enumerate accurately, and which every controller would otherwise
reconstruct by reading the source.
**Response.** `docs/privacy/dpia-template.md` and `docs/privacy/privacy-notice-skeleton.md`:
data classes and where they live, purposes and lawful bases, retention defaults
and the backup horizon (D-104), recipients, security measures, and the residual
risks the design already names (F-07, F-17, F-23). Necessity, proportionality
and risk acceptance are left blank for the controller.

### F-135 — The Recovery Kit did not recover, and the restore reported success anyway
**Severity: critical.** D-112 (`SECRET_KEY` is the root of every application
key), D-114 (the token is the root of the backup envelope) and D-040 ("two
artefacts, neither useful alone") compose so that a restore onto a fresh host —
the case the Kit exists for — *succeeds* under a newly generated `SECRET_KEY`
while every value in the D-148 protected class is permanently undecryptable,
every stored settings secret is dead, and every TOTP enrolment fails against an
instance where MFA is mandatory and not clearable. Row counts matched; the
schema verified; the wizard said "done". No chapter told the operator that
`SECRET_KEY` was part of the Kit — `13-…` §5.3 came closest and then sold the
separation as a feature. Two secondary defects surfaced with it: the
wrapped-master-key record lived only in the database being restored, so §4.2's
sequence could not run on a fresh host at all; and D-105's TOTP assertion was
stated against the recovery token, which is not the root the TOTP key derives
from, so the CI job either passed vacuously or asserted something production
does not do.
**Response.** D-166. The archive header carries a token-wrapped key record
(master key, `SECRET_KEY`, plus a cleartext key fingerprint), so the Kit is
genuinely two artefacts; the restore compares fingerprints before writing
anything and stops with a `secret:recover` path on a mismatch; and success is
reported only after a decryptability proof — one row per encrypted column, every
settings secret, every enrolled TOTP, the audit chain. D-113 is amended (wrapped,
never plaintext) rather than overridden, and D-105's assertion is restated as
"restore under a freshly generated `SECRET_KEY` and assert the documented
outcome".

### F-136 — The encryption AAD bound to names the design had already scheduled to rename
**Severity: critical (blocker).** D-096 bound the envelope's AAD to
`(table, column, primary key, keyId)`. D-159 renames schema identifiers to
English *"without exception"* and corrects chapters *"when the module is
written"*; D-100 renames `PlatformBootstrap`; D-056 merges `PlatformSettings`,
which holds encrypted settings-registry secrets. A rename changes the AAD, so
every existing ciphertext in that column fails to authenticate —
indistinguishably, by design, from tampering. Neither guard reaches it:
`key:rotate` is keyed by `keyId`, which a rename does not change, and R-20 runs
migrations unattended at container start *after* the pre-migration backup, so
the backup holds ciphertext bound to the old names and the running instance can
read neither. The failure surfaces as a corruption-shaped error on a medical
note.
**Response.** D-167. The AAD binds `(columnId, primary key, keyId)`, where
`columnId` is a permanent identifier in a committed encrypted-column registry
and the model/field names are ordinary mutable fields of the registry entry; the
registry is bidirectionally test-enforced in the shape D-135 already adopts for
`person-reference-sync.test.ts`. The primary key stays in the AAD because it is
what stops ciphertext moving between rows, so one narrow rule remains: a
migration changing a row's primary key, splitting a table or moving an encrypted
value must decrypt and re-encrypt inside the same migration
(`05-technical.md` §5 rule 6).

### F-137 — The audit chain's #2-ranked mechanism was unowned, and retention as specified broke the chain on its first run
**Severity: critical (blocker).** `06-delivery.md` §5 ranks *"audit chain-aware
rotation and checkpointing"* second in the whole product by cost of doing it
late. The word `checkpoint` appeared in the design set exactly twice — that
ranking row, and an example branch name on the same page. No decision, no
section, no finding, and the Phases list below the ranking assigned it to no
phase while assigning every other item to one. The pieces that *were* specified
contradicted each other: `01-domain-model.md` §5 gives the audit row
`onExpiry: DELETE`, D-149 part 1 requires a chain-status line a human sees, and
verification walks from genesis
(`WebAppTemplate/src/modules/audit/application/audit-service.ts:107`), so the
first legitimate retention run — month 12 to 24 of the first instance — leaves
`audit:verify` reporting a permanent discontinuity. A tamper detector that is
red on schedule from month twelve is worse than none, and it is the sole
evidence base for D-128's Article 33 assessment. Two further costs sat in the
same inherited file: `readAuditChain()` materialises the whole of what
`07-operations.md` §2 calls the fastest-growing table, and
`AUDIT_GENESIS_HASH = "genesis:webapp-template:audit:v1"` would ship as the
tamper-evidence root of a product that is not the template.
**Response.** D-168, in `02-security-privacy.md` §3.2.1: prefix-only pruning, a
signed `AuditCheckpoint` written in the same transaction as the deletion it
accounts for, a chunked segment walk reporting "intact across N pruned
segments", the genesis constant decided now as
`genesis:splashtrack:audit:v1`, and a **computed** retention floor that settles
F-133's three-document hand-off. Phase 1 in `06-delivery.md` §5. The limits are
stated rather than implied: the checkpoint MAC defeats an attacker with database
write access, not one with host access and `SECRET_KEY`.

### F-138 — v1 committed to a hand-written export engine whose only guard had been cut, while the alternative was still fully specified
**Severity: critical (blocker).** D-095 chose a logical export over `pg_dump`
and justified the risk with one sentence: *"it must be kept in step with the
schema — which is exactly what the restore matrix (§4.3.1) tests on every pull
request anyway."* That matrix is D-047, which `00-overview.md` §3.5.1 and
`06-delivery.md` §2.1 move out of v1. The justification was removed after the
decision was made and the decision was not revisited. At the same time
`14-…` §4.2.1 specified the `pg_dump` restore path in full behind an *"if v1
nonetheless"* — so two mechanisms differing by weeks of work and by which threat
model applies were both specified to implementation depth, and Phase 1 carried
them as a single bullet.
**Response.** D-169. The logical export is the only mechanism, decided on format
permanence rather than on threat model: the archive format is written into every
backup from the first one, and D-048/D-049 oblige every later version to keep
reading it, so shipping dumps now means owning a dump reader forever in the
version where untrusted archives actually arrive. The dump path is reduced to
the terms under which it could return. The removed guard is replaced by a
round-trip test inside the existing integration-test job, asserting row counts,
exact primary-key preservation (the D-167 AAD binds the primary key), encrypted
columns decrypting, and the audit chain verifying.
