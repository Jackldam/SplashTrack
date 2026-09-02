# Staging — security & privacy pass on chapter 02

Prepared by the *adversarial security & GDPR* pass, 2026-09-02, against
`docs/design/review/agent-reports/report-security.md` (34 findings: A-1…A-5
critical, B-1…B-20 high, C-1…C-18 medium, D-1…D-8 low).

**Files this agent edited:** `docs/design/02-security-privacy.md` and this file.
**Nothing else was touched.** Everything belonging to another chapter is a
hand-off block in §4 below, with target file, target section, proposed text and
the finding id.

---

## 0. Numbers allocated — read this first

**Decisions D-139 … D-156** (18, contiguous). **Findings F-109 … F-127** (19,
contiguous). Nothing below D-139 or F-109 is claimed.

**Correction to the brief.** The brief said the registers run to **D-138 and
F-99** and to allocate findings from F-100 upward. D-138 is right; **F-99 is
not**. `10-findings.md` currently defines findings up to **F-108**
(`### F-108 — zod is not present in either repository`, merged from
`staging/platform.md` in commit 38f3f9e). Allocating from F-100 would have
collided with F-100…F-108 — the same class of collision the D-090–D-098 repair
commit (773c811) fixed. **This pass therefore starts at F-109.** Verify with:

```bash
grep -o 'F-[0-9]\{2,3\}' docs/design/10-findings.md | sort -u -t- -k2 -n | tail -3
```

---

## 1. Decision register rows to add to `09-decision-register.md`

| ID | Decision | Reason | Trade-off accepted | Where |
|---|---|---|---|---|
| D-139 | A granter may grant only permissions they themselves hold, only at or below their own scope, and only for a validity window inside their own. Enforced in the grant service, applied identically to `Role` editing and to `AccessGroup` assignment | Role assignment is the highest-privilege operation in the product and had **no permission and no invariant** — `roles.assign` was cited as high-risk in `07-…` §1.3 and existed nowhere. A `UNIT`-scoped Location Manager could assign themselves an `ORGANIZATION`-scoped administrator role, or an access group carrying `students.medical.read`, and hold every medical note in the school. Step-up is no obstacle: it is their own password and their own second factor | An administrator delegating something they do not hold must first be granted it themselves, visibly. Bootstrap (setup wizard, break-glass CLI) sits outside the grant service and is host-access-proven | `02-security-privacy.md` §2.6 |
| D-140 | Identity-provider administration is its own high-risk permission; external identities link on `(issuer, sub)` only, never on an email claim; JIT provisioning creates nothing and the JIT-role field is deleted; changing issuer/token/userinfo endpoints clears the stored client secret; `ORGANIZATION`-scoped accounts are opt-in per account for external authentication | D-035 as written was an account-takeover primitive: anyone with `organization.settings.manage` adds a Keycloak tenant they control, maps `email` onto the administrator's account, passes the mandatory test connection against their own IdP, and signs in as instance administrator — MFA on the local account never touched. Second path: edit only the token endpoint of an existing provider and the app posts the stored client secret to the attacker. "The secret is never returned to any client" hides a secret from reads while allowing a redirect of where it is *sent* | Linking on `(issuer, sub)` means an IdP migration requires re-linking accounts rather than matching on email. Correct friction: an email address is an identifier the organisation does not control | `02-…` §1.2.1 |
| D-141 | The recovery path from an authentication misconfiguration is the break-glass CLI, stated plainly in the documentation. The enforceable invariant is: at least one **local** `ORGANIZATION`-scoped account with a **verified** MFA factor exists at all times, checked at the database and re-evaluated on every authentication-settings change, role revocation and account disable | "Local admin cannot be disabled while it is the only working method" was one of two *mandatory mitigations* justifying runtime-configurable IdPs, and cannot work: configure any second provider and local login is no longer "the only" one; and "working" is not decidable — a provider that passed a test at 14:00 fails at 14:05 on a certificate, a tenant policy or a group membership the application cannot observe. A point-in-time assertion was sold as a continuous invariant | The honest statement ("misconfiguring SSO can lock you out; recovery needs host access") is less reassuring than the deleted claim, and is the one an operator can act on | `02-…` §1.2.1 |
| D-142 | Every outbound request to an administrator-configured destination goes through one shared client: RFC1918/loopback/link-local/IPv6-equivalents denied by default behind an explicit audited "allow private networks" setting, resolve-then-pin against DNS rebinding, no redirects, hard timeouts, response size cap, and **no response body, status or distinguishing error returned to the client** | Four admin-controlled server-side fetch surfaces exist — OIDC discovery, SMTP test-send, backup destination endpoint, version check — and the words SSRF and egress appear nowhere in fifteen chapters. The settings page is otherwise an internal port scanner from inside the operator's network, and on a cloud host a path to `169.254.169.254` | A self-hoster with an internal Keycloak or SMTP relay must find and enable one setting, and the error will not say why. The setting's help text does; the alternative is a scanner enabled by default | `02-…` §1.2.2 |
| D-143 | Device mode is a property of an administrator-enrolled device or of the role, never of the session holder. v1 builds none of it: its effect comes from the Instructor role holding no export, bulk or administration permission at any scope, plus a short role-based idle timeout | D-009 was **opt-in by the party it restricts** — "a session *may be marked* `SHARED_DEVICE`" never said by whom — and the behaviour an instructor meets first, the shortened timeout on a wet tablet, is the one they disable. It was cited as *the* mitigation for two High risks and FM-13, so the strongest control in the poolside threat model was a self-declaration. `00-overview.md` §3.5.1 already cut it from v1; chapter 02 still specified it as active | An instructor who legitimately needs an export must ask an administrator. Since the poolside export is the exfiltration path the control exists to close, that is the intended outcome | `02-…` §1.3 |
| D-144 | `RoleAssignment` carries `validFrom`, `validUntil?` and `grantedByPersonId`; `validUntil` is schema-mandatory for `SESSION` scope; expiry is evaluated inside `requirePermission` and `resolveReach`, never by a cleanup job | Two decisions already depended on expiry that the tuple could not express: D-052 requires "a mandatory expiry after which it lapses", §2.4 lists the external examiner as "always with an expiry". As specified, the examiner who assessed one Saturday in March keeps `exams.assess` and `exams.results.record` on that session forever — and because results are append-only (D-062), an amendment years later becomes the effective result | Two more columns on the tuple every guard reads, and an end date must be chosen for grants that feel permanent. Instructor and administrator grants may leave it null; the bounded-window scopes cannot | `02-…` §2.1 |
| D-145 | Coverage is per **relation**, not per entity, and every membership-derived coverage is evaluated live: `GROUP` requires an active `GroupMembership` **and** an active `InstructorAssignment` at query time, and returns identity basics plus *that group's* progress and attendance only. A student's profile is governed by their **home** unit; a group's unit governs that group's records only | "The students in it *for the period of their membership*" is ambiguous exactly where it matters, and in a union-of-grants model over an append-only membership table (D-059 keeps those rows for life) the natural implementation means every instructor who ever taught a child keeps read access to their complete record permanently. Separately, a child registered at Zuidbad attending a summer course at Noordbad was fully reachable by both Location Managers, because a union always takes the broader answer | Coverage becomes a per-relation matrix rather than one sentence, and the student-detail screen renders partially for a `GROUP`-scoped instructor. Both were inevitable the first time anyone asked why an instructor could read a diploma history | `02-…` §2.2 |
| D-146 | `SELF` is an explicit seeded role assignment with a closed, enumerated permission set — own person, own student profile, own progress, own attendance, own awards, own consents. Never medical, never notes, never anything about another person | `SELF` was granted "to every authenticated person, **implicitly**". An implicit scope match means `requirePermission('students.medical.read', {student: self})` can pass for an authenticated person holding no grant at all — deny-by-default defeated by a rule in the same document | Account creation seeds a role assignment. Adding to the `SELF` set becomes a reviewed security change, like adding to the high-risk set | `02-…` §2.2 |
| D-147 | `Reach` is an opaque branded discriminated union with one variant per scope type plus `NONE` and `UNION`, constructible only by `resolveReach`; `all: boolean` is removed in favour of an `ORGANIZATION` variant only an organisation-scoped grant can produce | The old shape `{units, groups, all}` represented two of six scope types. A `COURSE`-scoped internal examiner or a `SESSION`-scoped aftest assessor resolved to empty reach, so the candidate list they are standing there to assess is blank — and the fix at 17:00 on an exam Saturday is `{all: true}`, on the path D-031 calls the highest-risk in the application. D-031's claim that a required argument "turns a silent over-fetch into a type error" enforced *presence*, not provenance: the literal was writable anywhere | A genuinely new scope type becomes a compile error in every repository at once. That is the point: the alternative is a repository silently ignoring a variant it does not know | `02-…` §2.3 |
| D-148 | One **protected free-text class** — medical remarks, pastoral/safeguarding notes, assessment remarks and `Inquiry` free text — all encrypted under the D-096 envelope, audited on **read**, excluded from exports by default and never logged, regardless of which permission pair gates each one. Two pairs are kept, not folded into one. Every field in the class carries a non-dismissable purpose/retention line at the capture point | D-010 says medical/pastoral notes have "their own permission **pair**", singular; the catalogue defines **two**, and §5.3 named only medical remarks as special category. Pastoral notes fell in the gap: gated by an ordinary-looking `students.notes.*` a Location Manager hands out without thought, plausibly unencrypted, unaudited, in every export and every backup. *"Moeder zit in de opvang"* is more sensitive than an allergy | Folding pastoral into `students.medical.*` (the reviewer's recommendation) would mean the instructor who must know about a child's epilepsy also reads the note about the family — a *reduction* in least privilege. Protection now tracks the data, not the permission pair, and the pairs stay separate | `02-…` §2.5 |
| D-149 | Audit integrity has three parts: chain verification exposed via `audit:verify` and the diagnostics page; a separate database role with `INSERT`-only grant on `AuditEvent` and `UPDATE`/`DELETE` revoked; and a hard retention floor the settings layer refuses to cross, with any lowering audited at high severity | "Append-only, never deleted by application code" is a statement about intent. The template's hash chain makes tampering *detectable* — nobody was checking — and one database role served everything, so a compromised administrator exports the member base and deletes the four rows recording it, or lowers audit retention to one day and lets the maintenance job do it legitimately. The three Article 33 questions (D-128) are all answered from this trail | A second connection with different grants; an operator on a managed database creates two roles rather than one. The documentation already owes exact statements for D-116 | `02-…` §3.2 |
| D-150 | Every setting is classified `free`, `bounded` or `invariant` in its own schema. `bounded` carries hard floors/ceilings that `settings:reset` also respects (session idle ≤ 8 h, audit retention ≥ 12 months, rate limits ≥ a minimum, backup retention ≤ the shortest special-category retention). `invariant` is not editable at all and has no override flag — the MFA mandate, reach filtering, audit append-only, the `SELF` permission set | `13-…` §3.2 puts "password policy, session timeouts, rate limits" in a live-editable Security category and never said which are load-bearing. If "MFA mandatory for the high-risk set" is one of them, the mandate is a checkbox the account it protects can clear; if it is not, that was stated nowhere. R-13 calls MFA "not optional" and nothing enforced that | An operator with a legitimate reason to exceed a bound changes code, not a setting. A real cost for a self-hosted product, and correct for a list this short | `02-…` §4.1 |
| D-151 | Guardian authority expires at the age of digital consent, derived from `Person.dateOfBirth` against a configurable setting (NL: 16) and evaluated at read time. Affected consents are marked **requiring re-consent** and surface in the privacy queue | A swim school's eight-year-olds become sixteen inside the retention window. Parental authority lapses by operation of law, not by a `validTo` someone remembered to set, so the `ON_BEHALF_OF` record stays apparently valid indefinitely. It is a computed condition over one column and a date — the cheapest control in the section and the most predictable consent failure in this domain | The organisation acquires a re-consent queue it did not have on paper. It had the obligation on paper; it could not see it | `02-…` §5.4 |
| D-152 | `withdrawnAt`/`withdrawnByPersonId` are valid only where `legalBasis = CONSENT`, enforced as a schema constraint. Objection under Art. 21 is a separate `ProcessingObjection` event. Every consent purpose declares its **withdrawal cascade** where the purpose is defined | The model permitted `legalBasis = CONTRACT` with a populated `withdrawnAt` — the exact thing §5.4 spends its length arguing must not happen — and the retention logic would either treat it as consent withdrawal or ignore it, undetectably. And withdrawal had no stated consequence anywhere: F-04 deletes photos "on erasure", while withdrawal of photo consent is the far more common event | The reviewer's third table (a separate `ProcessingBasis` register) is **not adopted**: `01-domain-model.md` §5's `lawfulBasis` column (D-110) already is that register, and D-134 forbids a second home for one fact | `02-…` §5.4 |
| D-153 | The Article 15 export **refuses** rather than omits when any in-scope class is unreadable by the requester; redacts third parties by default, per relation; reuses the erasure preview showing "about the subject" and "about other people" separately; and ships a generated annex of recipients, retention periods and source | Medical data was omitted unless the *requester* held `students.medical.read`, but the entitled party is the **data subject** — so a member administrator produced an export that looked complete, was delivered as the organisation's Article 15 response, and silently lacked the health data. The export also disclosed guardian details, instructor names and audit actor ids with no preview, while erasure next door mandates one. Art. 15's recipients/retention/source requirements were unaddressed and are all derivable from the `RetentionPolicy` table | A member administrator can no longer fulfil a subject access request alone. Not a regression — they could not fulfil one correctly before; now they find out | `02-…` §5.5 |
| D-154 | `AuditEvent` is an **enumerated, justified exemption** in the D-014 erasure registry, not an absence from it. The registry gains two entry kinds — `erase` and `exempt(ground, until)` — and the completeness test asserts every `Person`-referencing table has one of them | D-014 requires every table referencing `Person` in the registry with a completeness test; `AuditEvent` references `Person` and is simultaneously append-only and never deleted. Both cannot hold: either erasure mutates the append-only accountability record, or the table is silently exempted from the mechanism that exists to prevent forgotten tables — and **the test as described would fail on a correct implementation**. The ground is Art. 5(2) accountability, supported by Art. 17(3)(e) where a dispute exists | The erasure report gets longer and less satisfying: the subject is told what was kept and why. That is the requirement | `02-…` §5.5 |
| D-155 | `ANONYMISE` means destroying the row-level record and retaining only a **pre-computed aggregate** at a granularity that cannot be reduced to an individual — no identifier, no foreign key, no timestamp finer than the window, small counts suppressed. A class that cannot meet this may only be `DELETE` or `REVIEW` | §5.6 argues at length that pseudonymisation is not anonymisation, and the retention table two chapters away then prescribed `ANONYMISE` for attendance: strip `studentProfileId`, keep `sessionId` and timestamps, against twelve-child groups with retained time-bounded memberships and known session dates. Re-identification is a join and a counting argument. The design re-created the error it had just refuted and would have told a parent their child's attendance was anonymised | Some classes lose the option that sounded like a compromise. Attendance already moved to `DELETE` (D-111) on this reasoning, independently | `02-…` §5.6 |
| D-156 | `diagnostics.read` exists, is `ORGANIZATION`-scoped, and the diagnostics page is authenticated always. Its "safe to paste into a public issue" property (no secrets, no PII) is kept — pasteability and authentication are independent properties | The page names no permission and the catalogue had no key. It reports version, migration state, backup posture and *whether a newer release with a security advisory exists* — a machine-readable answer to "is this instance exploitable?" for anyone scanning for instances, and F-17 already names unpatched instances as the biggest residual risk. Whether it is reachable unauthenticated was never stated either way, which is the actual defect | One more permission to grant before a volunteer can produce the artefact a support issue asks for | `02-…` §2.5 |

---

## 2. Findings to add to `10-findings.md`

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

## 3. Findings rejected, partly rejected, or already resolved

Surfaced rather than silently accepted, per the brief.

### 3.1 Rejected in part — the reasoning, not the finding

| Finding | What is rejected | Why |
|---|---|---|
| **B-6** (F-112) | The claim that `{units, groups, all: false}` is "a **default-open** shape" | `all: false` is default-*closed*. A forgotten or defaulted field denies rather than over-returns, which is the correct direction. The two real defects — the object represents two of six scope types, and `Reach` is forgeable at any call site — are independently sufficient, and D-147 fixes both. Adopting the "default-open" framing would have justified the change for a reason that is not true, and the next reader would have believed it |
| **B-9** (F-115) | The recommended fix: "fold pastoral into `students.medical.*` (recommended — one pair, as D-010 actually says)" | This *reduces* least privilege. The instructor who must know a child has epilepsy would then also read the note about the family's situation — different needs, different holders. The actual defect is that protection tracked the *permission pair* rather than the *data*, so D-148 attaches encryption, read auditing and export exclusion to a data class spanning both pairs, and keeps the pairs separate. The reviewer's alternative ("or make `students.notes.*` equally encrypted, equally audited") is what was adopted |
| **B-18** | "Block completion of the setup wizard until each data class's basis is either confirmed or explicitly deferred" | A volunteer configuring a swim school on a Sunday evening clicks through thirteen legal questions to reach what they came for. The design would then hold *recorded confirmations* worth less than the honest blanks it started with — the false comfort D-063 and D-065 exist to prevent. Adopted instead: `unresolved` printed where it is unresolved (already D-110), plus a countable, persistent warning on diagnostics and the privacy screen. **The rest of B-18 is accepted and recorded in §5.6**, including the honest statement that v1's `REVIEW` is "we do not delete this automatically", not a queue — because the policy engine is out of v1 (D-120/R-25) and shipping a queue nobody opens would be worse than saying so |
| **C-3** (F-120) | The proposed split into three registers (`ProcessingBasis` + `Consent` + objection) | The processing-basis register already exists: `01-domain-model.md` §5's `lawfulBasis` column (D-110), which feeds `RetentionPolicy.lawfulBasis`. A second home for one fact is exactly what D-134 forbids, and this design set has already produced one real bug that way. Adopted: the schema constraint (`withdrawnAt` only where `legalBasis = CONSENT`), objection as its own event, and the withdrawal cascades — which is the part that was genuinely missing |
| **B-14** | Nothing — but the reviewer's own remedy for question three is not achievable | Accepted in full and **already implemented** by the crosscut pass (D-128, `07-…` §1.4, R-37). Worth recording that the third question — *whose data was in the backup that leaked?* — is answered honestly rather than solved: the manifest holds row counts, not data subjects, so a leaked archive is treated as covering **every** subject in the instance at that timestamp. That is the right answer; a per-archive subject manifest would be a second copy of the member list, in the artefact most likely to leak |

### 3.2 Already resolved before this pass — verified, not re-fixed

| Finding | Where it was resolved | Verified by |
|---|---|---|
| **A-3** restore is arbitrary SQL execution | D-095 (structured logical export), D-116 (non-superuser role), F-97 | `09-…` D-095/D-116; `14-…` §3.1, §4.2.1 |
| **A-4** setup mode keyed on one deletable row | D-099 (`TAMPERED` state, zero `UserAccount`/`Person`/`RoleAssignment`), D-098 six boot predicates | `13-…` §6.2; `09-…` D-098/D-099 |
| **A-5** setup token printed to logs | D-101 (`$DATA_DIR/setup-token` 0600, path only, single use, ≤60 min, rate-limited with lockout) | `13-…` §6.3, §8 |
| **B-1** S3 backup as an unguarded exfiltration channel | D-103 (S3 out of v1; destination change equal in severity to a download) | `14-…` §3.2; `07-…` §1.2 |
| **B-2** one key forever, non-revocable | D-112 (`SECRET_KEY_FILE`, HKDF), D-114 (two-level envelope, Argon2id), D-115 (entropy floor, re-display audited and notified) | `13-…` §3.1.1; `14-…` §2 |
| **B-3** key written to the volume the backup captures | D-112 + D-113 (explicit exclusion, CI asserts no fixture contains it) | `03-…` §1.2 table; `14-…` §3.1 |
| **B-4** no key id, no AAD | D-096 (`v1:<keyId>:<nonce>:<ct>`, AAD over table/column/pk/keyId), D-097 (decryptor registry + golden vectors), D-105 (restore matrix decrypts to known plaintext) | `09-…` D-096/D-097 |
| **B-11** "hard-deleted" versus backup retention | D-104 (pre-migration cap, backup horizon) and the §5.3 qualifier | `02-…` §5.3; `01-…` §5 |
| **B-14** no breach-response capability | D-128, R-37 | `07-…` §1.4 |
| **B-19** attendance `ANONYMISE` | D-111 (delete, never strip) — the *rule* was still missing, hence D-155 | `01-…` §5.3 |
| **B-20** chapter 03 mandates env-var configuration | F-102; the six "non-negotiable properties" rewritten as targets with honest status | `03-…` §1.2 |
| **C-1** `PersonRelationship` defined twice | F-71 — merged to one row, `evidence` non-optional where `authority = true` | `01-…` §3.1 |
| **C-9** GCM over a streamed archive | D-102 (framed AEAD, sequence-bound chunks, manifest authenticated before parsing) | `14-…` §3.1 |
| **C-10** recovery-token entropy | D-115 (≥128 bits, Crockford base32 with check character, restore endpoint rate-limited) | `14-…` §2.2 |
| **C-11** public/person separation not enforced | The lint rule now exists as a blocking check: `(public)` may not import a person repository | `06-…` §2.1 |
| **C-12** MFA bound to a role name that does not exist | D-130 in `07-…` §1.3; **the chapter-02 half was still open and is fixed by this pass** (§1.2) | `07-…` §1.3; `02-…` §1.2 |
| **C-13** CI gate named for a deleted concept | Renamed to scope-escape tests with per-module minimum content | `06-…` §2.1 |
| **C-14** chapter 01 §2.3 contradicts D-057 | F-73 — both passages rewritten to "owned by `sessions`" | `01-…` §2.3, §3.4 |
| **C-7 (part)** `RELATED` implemented but unreachable | D-122 removed it from the enum entirely — the reviewer's own recommendation | `02-…` §2.1 |
| **D-1** `AttendanceRecord` vs `AttendanceEvent` | F-72 — all occurrences renamed | `01-…` |
| **D-2** F-08 contradicts D-059 | F-74 — and note that `10-…` F-08's own text is listed as an open hand-off in `staging/domain.md` §3, so verify it before closing | `10-…` F-08 |
| **D-3** stale D-007 references | Corrected in `02-…` §5.5 and `04-…` §4.6 | both |
| **D-5** `EXAM_SESSION` missing from the trust-boundary diagram | Moot: D-068 replaced `EXAM_SESSION` with `SESSION`, which **is** in the diagram | `02-…` §6 |
| **D-6** broken normative sentence in §3 item 3 | Fixed by this pass | `02-…` §3 |

---

## 4. Hand-offs — changes this pass could not make

**No edits were made to any of these files.** Ordered by how badly the document
set is left inconsistent if skipped.

### 4.1 `07-operations.md` §1.2 — break-glass CLI has no actor and notifies nobody (reviewer C-5)

§1.2 requires every audit event to record "actor person id, actor
session/credential". A CLI invocation has neither, and the chapter already lists
break-glass invocation as auditable "even when no application session exists to
attribute them to" — which names the gap without closing it. Someone with brief
host access (a contractor, an ex-sysadmin whose key was never removed, anyone in
the `docker` group) runs `admin:grant-admin --email attacker@…` and holds a
standing Instance Administrator account; the only trace is one row, in a UI
nobody opens, attributed to nobody. `admin:reset-mfa` is the same story against
an existing account.

**Proposed text, to follow the "Each event records:" paragraph:**

> **CLI-originated events carry a `system:cli` actor**, not a null one: host
> user, container id, invocation timestamp and the exact subcommand. A null
> actor is indistinguishable from a bug in the audit writer, and the events that
> most need attribution are the ones with no session.
>
> Every break-glass invocation additionally **notifies every
> `ORGANIZATION`-scoped administrator by the delivery channel of §1.4**, and
> raises a persistent dashboard banner that must be dismissed by a *different*
> administrator than the one who ran it. The command is a legitimate recovery
> path and an equally legitimate attack; the difference is only ever visible to
> a second person.

**Also proposed, for `13-configuration-and-setup.md` §7:** `admin:grant-admin`
issues a **time-limited** grant (24 hours) rather than a permanent one — the use
case is recovery, not provisioning. The recovered administrator makes their own
standing grant through the normal path, where D-139's invariants apply.

### 4.2 `01-domain-model.md` §5 and `07-operations.md` §1.2 — audit retention outlives nothing it evidences (F-116)

Audit events are retained 24 months; exam results and awards up to 10 years. The
record of *who* recorded a diploma outcome is destroyed eight years before the
outcome, in a design that justifies append-only results with "a parent disputes
a diploma decision".

**Proposed:** add to the audit-events row of `01-…` §5 — *"retained at least as
long as the longest-retained data class whose changes it evidences; the floor is
12 months (D-149/D-150) and the shipped default should be reconciled with the
7–10 year classes above rather than left at 24 months"*. If the reconciliation
is rejected on volume grounds, state the consequence in the privacy screen as a
limit on what the organisation can reconstruct, rather than leaving it implicit.

### 4.3 `13-configuration-and-setup.md` §3.2 / §4 — settings classification (D-150)

D-150 is stated in `02-…` §4.1 because it is a security rule. Its
**implementation** belongs to the settings registry: every setting's Zod schema
carries `class: 'free' | 'bounded' | 'invariant'`; `settings:reset` refuses
invariants and clamps to bounds rather than restoring an unbounded default; the
UI renders an invariant as a stated fact, not a disabled control that invites a
support question. The chapter already claims the registry "is the single source
of truth for validation" — this is where that claim earns its keep.

### 4.4 `13-configuration-and-setup.md` §8 — diagnostics permission (D-156)

Add to the section: *"The page requires `diagnostics.read` at `ORGANIZATION`
scope and is never served unauthenticated. Its 'safe to paste' property is
about content — no secrets, no personal data — and is independent of who may
open it."*

### 4.5 `10-findings.md` F-05 — "No DPA is needed between us" (F-126)

Replace that sentence with the formulation now in `02-…` §5.1: *"The project
receives no personal data from your installation and performs no processing on
your behalf. Whether any agreement is required between you and any party is your
assessment to make with your own advisor."* This is the one sentence spoiling
what is otherwise the strongest GDPR passage in the set.

### 4.6 `03-deployment-model.md` §2.1 — the version check does not "send nothing" (reviewer C-17)

D-034 says the only outbound call "sends nothing but the version it is
checking… no identifiers, no counters, no server-side logging we control". Every
HTTPS request sends a source IP and a User-Agent to infrastructure someone logs;
"no logging *we* control" is accurate and concedes the point. For a school
instance the request also reveals that this organisation runs SplashTrack, at
this address, at this version.

**Proposed:** *"The request necessarily discloses your server's IP address and
the version string to `<host>`. It is disabled with
`update.check.enabled = false`."* And prefer fetching a **complete** advisories
file over querying per version, so the request reveals nothing about which
version is running. Keep the default **on** — F-17 justifies that — and state
the trade honestly. Low impact; it is on the list only because the design's
credibility rests on claims like this being exact.

### 4.7 `03-deployment-model.md` §1.3 — "walks" contradicts D-121

§1.3 reads: *"`OrganizationUnit` provides the internal hierarchy that the scoped
authorization model (`02-security-privacy.md` §2) **walks**."* `UNIT` is flat in
v1 and no scope type walks a tree (D-121). One word; it appears in the sentence
that points an implementer at the scope model.

### 4.8 `07-operations.md` FM-6 — a failure mode for a fleet that does not exist (reviewer D-4)

FM-6 prescribes "waves, bounded skew, halt-on-failure" for fleet rollout. The
fleet model is deleted (`03-…` §1.1) and F-14 is closed. The equivalent row in
`02-…` §6.2 was removed by this pass; FM-6 sits in a table an implementer reads
as a to-do list.

### 4.9 New file `docs/privacy/dpia-template.md` (reviewer C-18)

Large-scale processing of special-category data concerning children with new
technology meets the Article 35 criteria several times over, and the word DPIA
appears nowhere in the design. F-27 is right to refuse legal advice — but a
**template** is not advice. It is a document listing the processing operations
the software actually performs, which only the project can enumerate accurately.

**Proposed content, all of it factual and already written down elsewhere:** data
classes and where they live (`01-…` §5), purposes and lawful bases (same table),
retention defaults and the backup horizon (D-104), recipients (none by default;
the deployment's own processors), security measures (this chapter), and the
residual risks the design already names — F-07 backups, F-17 unpatched
instances, F-23 export. Leave necessity, proportionality and risk acceptance
blank for the controller. A privacy-notice skeleton alongside it, on the same
principle. Out of this pass's write scope; it is the highest-leverage compliance
artefact available and it is cheap.

### 4.10 `08-open-decisions.md` — OD-7 is answered and should be closed

OD-7 ("encryption key management for special-category columns") still lists
"Cloud KMS (best, ties to OD-3)" as the leading option and says the question
blocks the students module. It has been answered by three later decisions:
D-112 (`SECRET_KEY_FILE` as the single root, everything else HKDF-derived),
D-114 (two-level envelope, Argon2id over the printed recovery token, per-archive
data keys) and D-096 (`v1:<keyId>:<nonce>:<ct>` with AAD). Cloud KMS is not
needed and contradicts the self-hosted premise of D-064. `02-…` §4 now says so;
OD-7 should be closed against those three rather than left open.

### 4.11 `03-deployment-model.md` §5.4 — ISR and session-dependent content (reviewer D-8)

§5.4 declares the cache-key hazard "gone" with tenancy. It is reduced, not gone:
any public page rendering session-dependent chrome (a "logged in as…" nav) under
ISR caches one visitor's view for everyone. One line: **public pages are
rendered with no session read at all**, which is also what makes D-017's
structural claim true at the rendering layer rather than only at the data layer.

---

## 5. What this pass deliberately did not do

- **No edits to `09-decision-register.md` or `10-findings.md`.** D-139…D-156 and
  F-109…F-127 are staged here for the consolidator, per the brief and per the
  D-090–D-098 collision that needed commit 773c811 to repair.
- **No edits to any chapter other than `02-security-privacy.md`.** Eleven items
  that belong elsewhere are in §4 with proposed text.
- **No re-fixing of resolved findings.** §3.2 lists what was verified as already
  landed, with the file and section checked in each case.
- **No new v1 scope.** Where a fix would have added build work to a v1 that
  D-120 has already re-cut, it is recorded as a **precondition** for the feature
  it guards (D-140 for the IdP registry) or as a rule rather than a mechanism
  (D-155 for `ANONYMISE`, D-150's classification). Two exceptions are genuinely
  new v1 work and are small: the grant invariants of D-139 — which cannot be
  retrofitted, since every grant written before them is unverified — and the
  `Reach` shape of D-147, which D-138 already places in the "scope model" slot
  of the build order for exactly this reason.
