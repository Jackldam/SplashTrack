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

### F-02 — Consent for minors was not specified
**Severity: high.** The brief mentions consent but not that the overwhelming
majority of data subjects are children who cannot legally consent. A consent
record that only names the subject is useless for a minor.
**Response.** `PersonRelationship` (guardian ↔ child) is built in v1, and every
consent record references both the consenting person and the subject person.
Retrofitting this would require rewriting every existing consent row.

### F-03 — External examiners were not modelled
**Severity: medium.** Swim diplomas are frequently assessed by an examiner who
appears for one afternoon and is not a member of the organisation. A model
where assessment requires org membership either blocks the real workflow or
forces over-granting.
**Response.** `ExamAssessor` references a `Person` directly with a time-bounded,
narrowly-scoped role — assessment rights without organisational membership.

### F-04 — Photographs of minors were not called out
**Severity: high.** "Afbeeldingen" appears in the branding list, but the real
risk is class-list photos of children: personal data, biometric-adjacent, and
the field most likely to be added casually.
**Response.** Consent-gated; EXIF stripped; served through an authorising
route, never a public bucket path; suppressed in `SHARED_DEVICE` sessions for
non-assigned groups; deleted on erasure.

### F-05 — No Data Processing Agreement is mentioned
**Severity: medium (legal, not technical).** Each organisation is the
controller and SplashTrack the processor. That relationship legally requires a
DPA. Code cannot supply one, but the product must not contradict it — and
onboarding an organisation without one is a compliance gap.
**Response.** Flagged as a launch prerequisite. The organisation lifecycle
(`PENDING → ACTIVE`) is the natural place to require it before activation.

### F-06 — Retention and erasure conflict was unresolved
**Severity: high.** Exam results are retained ~10 years; a data subject may
demand erasure. Both cannot be satisfied literally.
**Response.** D-007 — erasure severs identity and pseudonymises the retained
record. This must be disclosed in each organisation's privacy notice, which is
a process obligation SplashTrack cannot solve in code.

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
| **Fleet-wide credential or image compromise** | High | Per-instance secrets, no shared control plane (D-029), signed images, protected environments |
| Stored XSS via CMS content | High | Closed token set (D-016); server-side sanitisation on save *and* render; no arbitrary HTML/JS |
| Shared tablet left unlocked | High | `SHARED_DEVICE` mode (D-009) |
| Health data in a backup leak | High | Column encryption (D-013) + encrypted backups |
| Org admin bulk-exports and leaves | Medium | Step-up, rate limit, high-severity audit event visible to the org |
| Operator with fleet deploy rights | Medium-high | F-14 — per-instance credentials, required reviewers, audited deploys |
| Prompt injection via GitHub issue text | Medium | D-025; human-reviewed PR is the only output channel |
| Raw SQL bypassing reach filtering | Medium | Lint flag on `$queryRaw`/`$executeRaw`, explicit reviewer sign-off |
| Third-party font/CDN leaking visitor IPs | Low-medium | Self-hosted curated fonts only |
| User enumeration on public forms | Low-medium | Uniform responses, rate limits, writes go to `Inquiry` not `Person` |

### F-13 — Fleet operations are now the dominant risk and were not in the brief
**Severity: high (operational).** Single-tenancy converts a data-isolation
problem into an operations problem. 100 customers means 100 databases, 100
backup schedules, 100 migration targets and 100 TLS certificates. Done
manually this fails at roughly the fifth customer.
**Response.** Scripted provisioning (D-028), a machine-readable fleet manifest,
waved rollouts with halt-on-failure, bounded version skew, per-instance
monitoring and rotating restore drills. **This work must exist before the
second customer, not after.**

### F-14 — The fleet operator is the new most-dangerous principal
**Severity: medium-high.** With no platform super administrator inside the
application, the concentrated power moved to whoever can deploy. That principal
can reach every customer's instance.
**Response.** Per-instance deploy credentials in separate GitHub Environments
with required reviewers; no single credential that opens the whole fleet; every
deploy audited; no standing database access — access is provisioned per
incident and revoked after.

### F-15 — Scope filtering has the same failure mode tenancy did
**Severity: high.** A missed `where` on a list query silently returns more than
it should. This is the identical bug class as a missed tenant predicate, simply
scoped to units and groups instead of organisations. Deleting the tenancy tests
without replacing them would be a regression in assurance, not a simplification.
**Response.** D-031 (reach as a required repository argument) and D-032
(mandatory scope-escape tests per module).

### F-16 — Per-customer cost floor was not considered
**Severity: medium (commercial).** A dedicated database, storage bucket,
certificate and monitoring per organisation sets a hard marginal cost per
customer that shared hosting would not have. This constrains pricing and makes
very small organisations potentially unprofitable.
**Response.** Flagged for Jack as a commercial decision, not a technical one —
see OD-11. Technically mitigable by co-locating several small instances on
shared infrastructure while keeping databases and processes separate.

## Scalability problems

Covered in full in `07-operations.md` §4. Single-tenancy changes which risks
matter: per-instance data volume becomes small, and **fleet size becomes the
scaling axis**.

1. **Fleet size.** 100 organisations means 100 deployments to upgrade, back up
   and monitor. This is now the dominant scaling concern (F-13).
2. **Derived progress state.** The group skill matrix (30 students × 40 skills)
   computed from an append-only log is still the first query that will be
   measurably slow, even in a small instance. The materialised summary is
   designed but deliberately not built (D-005).
3. **Audit and attendance table growth.** Still the two fastest-growing tables,
   but per organisation rather than globally — which pushes the problem out by
   roughly the number of customers. Partitioning plus retention rotation
   remains the answer.

Neither justifies added complexity today. Knowing the answer is the deliverable
at this stage; building it would be exactly the premature complexity the brief
warns against.
