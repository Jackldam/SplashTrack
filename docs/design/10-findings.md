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
controller and operator, and we never touch their data. No DPA is needed
between us. The organisation still needs its own privacy notice and, where it
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
**Response.** Reuse the profile and model the gap with `leftAt` / a new
enrolment. History is the product's value; a second profile would fragment it
and duplicate PII.

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
