# 10 — Findings: Gaps, Inconsistencies, Security Risks, Scalability Problems

The brief explicitly asks for these. Each finding states what is missing or
wrong, why it matters, and what this design does about it.

## Missing requirements

### F-01 — `Person` is cross-organisation, which is a tenant-isolation hole
**Severity: high.** D-004 makes `Person` span organisations so that PII exists
once. The consequence is that `Person` cannot use the automatic org-scoping
extension that protects every other table. Any code path that fetches a Person
by id, without proving the caller may reach that person, is a cross-tenant
read.
**Response.** A mandatory `assertPersonReachable(personId, organizationId)`
guard that verifies the person has a membership or an org-scoped profile in
that organisation. Every Person fetch goes through a repository that calls it;
a lint rule forbids direct `prisma.person.findUnique` outside that repository;
isolation tests attempt the attack explicitly.

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
tension.
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
| Cross-tenant read via `Person` | High | F-01 guard, repository funnel, lint rule, isolation tests |
| Public page leaks person data | High | D-017 — no code path exists |
| Public cache key omits tenant | High | Tenant in cache key, asserted by test (FM-6) |
| Stored XSS via CMS content | High | Closed token set (D-016); server-side sanitisation on save *and* render; no arbitrary HTML/JS |
| Shared tablet left unlocked | High | `SHARED_DEVICE` mode (D-009) |
| Health data in a backup leak | High | Column encryption (D-013) + encrypted backups |
| Org admin bulk-exports and leaves | Medium | Step-up, rate limit, high-severity audit event visible to the org |
| Platform support browsing tenant PII | Medium | D-011 |
| Prompt injection via GitHub issue text | Medium | D-025; human-reviewed PR is the only output channel |
| Raw SQL bypassing org scoping | Medium | Lint flag on `$queryRaw`/`$executeRaw`, explicit reviewer sign-off |
| Third-party font/CDN leaking visitor IPs | Low-medium | Self-hosted curated fonts only |
| User enumeration on public forms | Low-medium | Uniform responses, rate limits, writes go to `Inquiry` not `Person` |

## Scalability problems

Covered in full in `07-operations.md` §4. The two that will bite first:

1. **Derived progress state.** The group skill matrix (30 students × 40 skills)
   computed from an append-only log is the first query that will be measurably
   slow. The response — a materialised summary refreshed on write — is designed
   but deliberately not built (D-005).
2. **Audit and attendance table growth.** Both grow monotonically and are the
   two fastest-growing tables. Partitioning plus retention rotation is the
   answer; the retention policy doubles as a scalability control.

Neither justifies added complexity today. Knowing the answer is the deliverable
at this stage; building it would be exactly the premature complexity the brief
warns against.
