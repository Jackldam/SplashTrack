All chapters read and cross-checked. Here is the review.

---

# Design review — domain realism & ruthless simplification

**Verdict up front: the design is over-scoped by roughly a factor of two, and it is being written for a customer who does not exist. Stop designing. The single highest-value action available is not chapter 15 — it is one afternoon standing at a poolside during Tuesday-evening lessons.**

The engineering judgement in these documents is genuinely good. D-061 (attendance supersede), D-055 (boot state machine), D-046 (restore-then-migrate), D-004/D-053 (Person/Membership/StudentProfile) are correct decisions that would be expensive to retrofit. That is not the problem. The problem is that ~4000 lines of specification, 66 decisions and three full architecture revisions have been produced while **OD-2 — "who is the first customer, and are they a swim school?" — is still open and marked "cost of delay: high"**. The design has been refined multi-tenant → single-tenant → open-source self-hosted without a user ever seeing it. That is rework at the cheap end, fine — but it is now the *only* thing happening.

---

## A. Does this match how a swim school actually works?

### A1. The poolside flow: right instincts, three real failures

`04-ux.md` §4.1 is the best page in the set. Default-to-present, tap-for-absent, one transaction, `clientEventId` — that is how it should work, and the 30-second target is the right kind of constraint. But:

**(a) The 30 seconds are not where the time goes.** Marking 12 kids present is two taps. The time goes on: waking a shared tablet, logging in as *this* instructor, finding tonight's session, and matching faces to names. The design measures the cheap part. `SHARED_DEVICE` (D-009) makes the expensive part worse.

**(b) `SHARED_DEVICE` requires step-up re-authentication to leave the attendance context** (`02-security-privacy.md` §1.3(d)). Step-up means MFA. On a shared tablet. With wet hands. An instructor who taps the wrong nav item is now doing TOTP entry on a pool deck. This control will be disabled by the first customer within a week, or instructors will share one login — which is exactly the outcome D-052 correctly refuses for examiners.

**(c) Passkeys are called "the best answer to wet hands, shared tablet"** (`02-security-privacy.md` §1.2). A passkey is bound to a device *and* a user. On one shared tablet, every instructor needs their own passkey registered on that tablet — workable, but it is the opposite of the frictionless story being told. And `13-…` §4 notes that changing `APP_URL` invalidates every passkey; the first time a school moves from `http://nas.local:3000` to `https://zwemles.example.nl`, every instructor is locked out of the tablet mid-season.

**(d) Offline is "prepared, not built" (P-02), and there is no paper fallback specified.** Pools are RF-hostile: wet, tiled, frequently semi-basement. FM-1's answer is "work retained on screen" — but the screen is a shared tablet with a 15–30 minute idle timeout (OD-6). Lock the tablet, lose the lesson. **If offline is not built, the design owes a "print tonight's class lists" button, and it does not have one.** That is a half-day of work and it is the actual disaster-recovery plan for the flagship workflow.

**(e) The skill matrix undo boundary will bite.** §4.2: "tap again to undo (within the session)". After Save, correcting a mis-tap needs `skills.revoke` — a permissioned action with a mandatory reason, which a `GROUP`-scoped instructor may not hold. A fat-fingered ACHIEVED on a 30×40 grid with wet hands then requires an administrator. Realistic frequency: weekly.

### A2. Domain concepts: what is right

Time-bounded `GroupMembership`, `MembershipPeriod` + `StudentLifecycleEvent` for leave-and-return (D-059), Course≠Group (§2.3), external examiners with no membership (D-052), append-only exam results with 0..N corrections (D-062), guardian authority as *evidence* not proof (D-063), and the observation that most data subjects are children with no membership (D-066). All of these are correct and several are things most products in this space get wrong. Keep every one.

### A3. What a swim school does weekly that this design has **no answer for at all**

This is the most important section of the review. Ordered by weekly frequency:

| # | Missing | Reality | Design status |
|---|---|---|---|
| **1** | **Inhaalles / make-up lesson** | A child misses a lesson and attends a different group's session that week. This happens *every week, for several children.* | **No representation.** `AttendanceEvent` is bound to a session whose students come from `GroupMembership`. A visiting child is not in the group. `GROUP`-scoped reach means the receiving instructor cannot even see them. This is the #1 gap. |
| **2** | **Afmelden — parents reporting absence** | Every school runs an absence channel (form, WhatsApp, phone). It feeds directly into what the instructor sees. | **No inbound channel exists.** Guardian portal deferred (P-04), notifications deferred (P-06). The instructor marks EXCUSED based on… nothing the system knows. |
| **3** | **Telling parents anything** | "Les vervalt donderdag", "Sanne mag afzwemmen op 14 maart", "we gaan naar groep B3". | **The product can record but cannot communicate.** No portal, no bulk email, no SMS. This is the largest functional hole for the customer, and it is invisible in the design because it was filed under "deferred" (P-06). |
| **4** | **Cancelling a lesson** | Pool closed for maintenance; instructor ill at 16:00 for a 17:00 lesson. | `ScheduledSession.status` exists as an unspecified field. No cancel workflow, no notification, no reschedule, no substitute assignment. |
| **5** | **Instructor substitution** | A colleague covers tonight's group. | A substitute holds no `GROUP` grant for that group and therefore **cannot register attendance**. Nobody at a poolside waits for an admin to re-scope a role. The security model breaks the operational model at its most common exception. |
| **6** | **Waiting list / intake** | Dutch swim schools have months-long waiting lists. It is the front door and the revenue pipeline. | **Explicitly deferred** (`00-overview.md` §3.3) — while `EXAM_SESSION` gets a first-class scope type. That is a scope inversion. |
| **7** | **Proefles / trial lesson** | A child comes once to see if they like it. | No lightweight attendee. Requires the full §4.5 flow: search Person → create Person → StudentProfile → Enrolment → guardian → consent → group. Six steps for someone who may never return. |
| **8** | **Season generation with holidays** | Lessons follow school holidays and pool closures. Creating a season means ~40 sessions per group with exceptions. | `planning` has **no recurrence primitive, no holiday calendar, no bulk generation**. Someone is creating sessions by hand. |
| **9** | **Doorstroom — moving up a level** | Weekly management activity: who is ready, is there a spot in the target group, move them, tell the parent. | `GroupMembership` supports the *data*. There is no readiness report, no capacity check (`Group.capacity` is a nullable field nothing enforces), no move workflow, no notification. |
| **10** | **Payment / who has paid** | Monthly incasso; lessons stop on arrears. | Deferred (OD-4), and `Enrolment` is proudly forbidden a payment-state field (P-03). **Consequence: the school keeps its existing system, and now does dual data entry.** That is the single most common reason vertical SaaS gets abandoned. |
| **11** | **Zwem-ABC as an external normative catalogue** | The A/B/C bekwaamheidseisen are set by the Nationale Raad Zwemveiligheid, revised periodically, and are *not* the school's to author. Diploma numbers come from ordered NRZ stock. | `Skill` is described as "**Defined by this organisation**" with a seeded default catalogue (`01-…` §3.3). `SkillRequirement` has **no version and no validity dates**. When NRZ revises the eisen mid-season, children partway through must be assessed under the old set — and the model cannot express that. `Certificate { number }` implies the org mints numbers. **This is a cheap fix now (catalogue version + effective-from/to on requirements) and a migration through live progress data later.** |
| **12** | **Families / households** | Schools think in families: one parent, three children, one contact, one invoice. | Only `PersonRelationship(GUARDIAN_OF)`. No household, no sibling view, no "enrol a second child" shortcut. |
| **13** | **Print anything** | The WiFi fallback, and the diploma day roster. | Nothing printable is specified anywhere. |

Items 1–5 are all the same shape: **the design models the steady state and has no model for exceptions — and a swim school's week is mostly exceptions.**

### A4. Where the design solves a problem swim schools do not have

- **The public website / CMS (R-12, `03-…` §5).** The secondary thesis — "an organisation should be able to run its entire public web presence on SplashTrack" — is a second product. The school already has a WordPress site and will not migrate it to a block editor with seven block types and no page builder. What they actually need from `(public)` is a course catalogue page and an interest form. **This is the biggest single cut available.**
- **The IdP registry (R-15, D-035).** A generic OAuth/OIDC provider registry with encrypted secrets, claim mapping, JIT rules, test-connection gating and lockout mitigations — for an organisation whose IT is a volunteer with a Synology. Nobody at a swim school runs Keycloak. OD-8's reasoning ("an organisation running its own server very often already runs its own Entra") describes a mid-size enterprise, not the stated audience (`13-…` §1: "a swim school with limited IT capacity").
- **The `OrganizationUnit` *tree* with descendant-walking `UNIT` scope.** A swim school has one pool, or three pools in a flat list. A hierarchy with recursive reach resolution is built for a federation. It is also the highest-risk code path in the application (D-031, FM-3) — cutting scope types makes the security *better*, not worse.
- **`EXAM_SESSION` as a first-class scope type (D-054).** Defensible in theory. In practice, at most Dutch swim schools the examiner works from a paper list and the coordinator enters results afterwards. A time-bounded `COURSE` grant covers the login case at 20% of the cost.
- **Column-level encryption for medical notes (D-013) + OD-7 key management + D-049 legacy decryptors.** The stated threat is "a dump or backup leak". In a single-host Docker Compose deployment, whoever gets the dump gets the `.env` next to it — `SECRET_KEY` lives on the same box. The control that actually works here is the **encrypted backup** (D-040), because the backup is the artefact that travels. Column encryption buys little and drags OD-7, a rotation command, and restore coupling behind it.
- **The restore-from-every-supported-release CI matrix (D-047).** At v1.0 there are zero supported prior releases. This builds infrastructure for a version history that does not exist yet.
- **UAT as a separate environment (D-022/D-023) with tag-only deploys and required reviewers (D-024).** Jack is the author, the reviewer and the acceptor. UAT is a ceremony performed by one person for one person.
- **WCAG contrast validation at save time "with the nearest passing shade offered."** Nobody asked for a colour suggester.
- **Requirements that exist because they sound professional:** R-21 diagnostics (actually keep — it's cheap and genuinely useful for self-hosting support), R-28's full 15-check blocking CI, the `/api/v1` + OpenAPI + Swagger surface that `05-…` §4 admits will contain "health/ready, organisations (read), and one worked example", the retention **policy engine** (D-065) as opposed to a retention *policy*, and "no aggregate figure across organisations is a quantity this system has" (`00-…` §4.2) — a sentence defending against a requirement nobody made.

---

## B. What should be cut from v1

### B1. Effort estimate of v1 as specified

One engineer plus an AI assistant, at the Definition of Done the design itself sets (`06-…` §4.4: data model → service → API → UI → tests → docs, plus per-module scope-escape tests, plus every PR reviewed by the same person who wrote it):

| Area | Weeks | Notes |
|---|---|---|
| Template extraction + incremental tenant removal (D-056) | 3.5 | The design admits: scoping extension, tenant columns, composite FKs, PlatformSettings merge, platform roles, permission namespace — each test-covered |
| Scope model: 7 scope types, coverage rules, `resolveReach`, required-arg repos, lint rules, test harness | 3 | |
| Settings registry (generated UI, live-apply, rebuild-scoped path, audit, secrets, export/import) | 3 | |
| Setup wizard + 5-state boot machine + test matrix | 2 | |
| Backup/restore (archive format, manifest, recovery token, wizard restore, scheduler, S3, signed links, step-up) | 3.5 | |
| Migration/upgrade (pre-migration backup, refuse-newer, `minimumRestorableVersion`, restore matrix + fixtures, update check) | 2.5 | |
| IdP registry (D-035) | 2.5 | |
| Retention/erasure engine (D-065/D-066) + registry + dry-run | 3 | |
| Consent + guardian authority + profile-field consent texts | 1.5 | |
| Column encryption + envelope + rotation | 1 | |
| Audit trail as a product surface (D-026) | 1 | |
| Diagnostics + break-glass CLI | 1 | |
| **Platform subtotal** | **27.5** | |
| 9 domain modules (people 1.5, students 2.5, groups 1.5, courses 1.5, skills 3, sessions 1, attendance 2.5, exams 3, planning 3) | **19.5** | Full vertical slice each |
| Branding + CMS + public site + inquiry forms | 4 | |
| Design system, wireframes, i18n NL+EN, WCAG remediation | 3.5 | |
| CI build-out (15 blocking checks, load test, query-count assertions) | 2 | |
| Release engineering (signing, SBOM, provenance, advisories, licence, install/upgrade docs) | 2.5 | |
| DEV/UAT environments + deploy automation | 1 | |
| **Total** | **60** | |

Add 20–30% for integration, debugging and rework that never appears in a task list on a greenfield with a new authorization model: **60–75 engineer-weeks ≈ 14–18 months full-time.** If this is evenings and weekends at ~15 h/week, it is **three to four years**. There is no customer at the end of it, and the first customer's actual weekly workflow (§A3) is not in the build.

Sanity check: Vaultwarden, Paperless-ngx and Mealie each took years and none of them carries a nine-module regulated domain on top of the self-hosting product.

### B2. Specific cuts, with what breaks and what does not

| Cut | Saves | What breaks | What does **not** break |
|---|---|---|---|
| **R-12 / D-017 CMS + public website** → keep only a public course-catalogue page + interest form + branding | ~3 w | The "one system for signup" story | Nothing operational. D-051's structural rule survives as "`(public)` may not import person repositories" — a lint rule, not a subsystem |
| **R-15 / D-035 IdP registry** → local accounts + MFA + passkeys only | ~2.5 w | Schools with Entra must use local logins | Everything. Add it when a customer asks; the registry is additive, not structural |
| **D-054 `EXAM_SESSION` scope + D-052 examiner accounts** → keep `ExamAssessor` as an attribution record (a name on the result); coordinator enters results | ~1.5 w | External examiners cannot log in | Attribution is preserved — the point of D-052. This *is* the real workflow |
| **`UNIT` tree + `COURSE` + `RELATED` scopes** → ship `ORGANIZATION | GROUP | SELF` | ~1.5 w | Multi-location delegation | The reach mechanism, its required-argument discipline and its tests are unchanged; adding scope types later is an enum member plus a coverage rule |
| **D-065/D-066 retention *engine*** → hardcoded retention constants in one file + one scheduled job + the erasure transaction | ~2.5 w | Per-org configurable policies with dry-run reports | GDPR compliance. The law requires you to *have* and *act on* a retention policy, not to ship a configurable engine. F-27's honesty (defaults are proposals) becomes a documentation statement |
| **D-047 restore matrix CI + seeded per-release fixtures** | ~1.5 w | Nothing at v1.0 — there are no prior releases | Keep **D-048** (never squash) — it is a policy and costs zero, and it is what makes D-047 addable at v1.3 |
| **D-013 column encryption + OD-7 apparatus** → volume encryption + encrypted backups (D-040) | ~1 w | Protection against a DB-dump-without-host-access attacker | The realistic control. **Keep D-010** (medical notes behind their own permission) — that is the control that actually matters day to day. Keep the `v1:` envelope *format* (~1 day); retrofitting it is genuinely hard (D-049's reasoning is correct) |
| **UAT environment (D-022/D-023 second env)** | ~1 w | A formal acceptance stage | DEV + tagged release is enough for one person. Reinstate when there is a customer to accept for |
| **`/api/v1` + OpenAPI + Swagger** | ~0.5 w | Nothing — `05-…` §4 concedes it is health/ready plus one example | P-01 survives as "services are the shared layer", which is free |
| **Settings *registry*** → a settings page for the ~15 settings that matter | ~2 w | Auto-generated admin UI and docs table | D-036/D-038's real requirement (config in DB, no restart) is satisfied by a plain settings table |
| **`SHARED_DEVICE` PII-suppression + step-up-to-leave** → short idle timeout + instructor role holds no export/admin permission | ~1 w | Nuanced context-based least privilege | The actual threat (tablet on a bench) is covered by the timeout, which is the part instructors will tolerate |

**Total cut: ~18–19 weeks.** Plus the things that must be *added* (§A3), which is the honest part of this recommendation.

### B3. The v1 I would actually build

**Tier 1 — pilot, ~12–14 engineer-weeks.** Runs *alongside* the school's existing admin. Jack hosts the single instance himself; no self-hosting product at all.
- Template extraction (tenant strip), local auth + MFA, `ORGANIZATION|GROUP|SELF` scoping with reach + scope-escape tests
- people · students · groups · courses/levels · sessions (with recurrence + holiday exceptions) · attendance · skills matrix
- CSV/Excel import of their current pupil list — **this is what makes a pilot possible at all**
- Print class lists (the WiFi fallback)
- Group email from a template

This puts the flagship thesis in front of real instructors in **three months instead of fifteen**, and every subsequent decision is informed by what they say instead of by chapter 15.

**Tier 2 — shippable self-hosted v1.0, ~30–35 engineer-weeks total**, adding to Tier 1:
- Exams-lite: candidates, results (append-only, supersede), diploma record. No scoped examiner accounts, no PDF generation.
- **Waiting list / intake pipeline** (inquiry → waitlist → placement) — ~1.5 w, and it is the school's front door
- **Absence self-report**: a signed per-session token link emailed to guardians, no login, writes an EXCUSED event — ~0.5 w, and it is the highest-leverage domain feature in this entire review
- **Make-up lesson**: allow an attendance event for a student not in the session's group, with the visiting instructor's reach extended to session-attendees rather than group-members — ~1 w, and it removes the #1 domain gap
- Setup wizard + boot state machine + encrypted backup/restore + pre-migration backup (keep nearly in full — cheap and load-bearing)
- Simple settings page, diagnostics, break-glass CLI
- Erasure transaction + registry test + export + audit view + hardcoded retention job
- Public course catalogue + interest form + branding tokens
- CI: format/lint/typecheck/unit/integration/E2E/populated-migration/container-build/npm-audit/secret-scanning
- Image, compose file, install docs, licence

**Risk this creates, stated plainly:** no SSO (schools with Entra use local accounts); no configurable retention (the org inherits our defaults, which F-27 correctly says is a compliance weakness — mitigated by documenting them as *the software's* defaults and requiring confirmation at setup); no multi-location delegation; medical notes protected by permission and encrypted backups but not by column encryption; the restore-from-any-version promise is *designed for* (D-046, D-048) but not *machine-verified* until v1.3. Each of these is additive later. None of them requires a schema migration through live data.

### B4. What must **not** be cut — the honest other direction

Cutting any of these costs more later than it saves now:

1. **`Person` / `Membership` / `StudentProfile` separation** (D-004, D-053). Retrofitting is a migration through every table.
2. **Append-only attendance with `clientEventId` and `supersedesEventId`** (D-005, D-061). One indexed column. It is the offline path, the dispute record and the safeguarding record.
3. **Time-bounded `GroupMembership`, `MembershipPeriod`, `StudentLifecycleEvent`** (D-059). Retrofitting history onto a status flag is a data-loss event.
4. **Scope-checked reads with reach as a required repository argument, and scope-escape tests** (D-030, D-031, D-032) — with three scope types, not seven. This is the boundary protecting a child's records. It does not go in "later".
5. **Medical/pastoral notes behind their own permission pair** (D-010).
6. **Erasure as one transaction with a registry and a test asserting every `Person`-referencing table is registered** (D-014). This is the cheapest compliance insurance in the document set.
7. **The boot state machine, restore-then-migrate order, and automatic pre-migration backup** (D-055, D-046, D-044). Days of work; the difference between a five-minute rollback and a lost swim school.
8. **Encrypted backup + recovery token** (D-040). The unencrypted dump on a NAS is the realistic breach in this product.
9. **`D-051` as an import rule**: `(public)` never touches person tables. Free.
10. **`D-048`: never squash migrations within a major.** A policy. Costs nothing.
11. **The `v1:` encryption envelope prefix** (D-049 format only). One day. Genuinely hard to retrofit.
12. **The inherited migration-against-populated-database CI job.** Already exists; the design is right that it is one of the template's best features.
13. **Catalogue versioning on `Skill`/`SkillRequirement`** — *not currently in the design*, and it belongs in this list. Add effective-from/to and a catalogue version now; it is three columns today and a migration through live progress data once NRZ revises the eisen.

---

## C. Document hygiene — evidence that the set has outgrown one maintainer

Not the main event, but these are all in *active, normative* chapters and several would become code:

- `01-…` §2.3 (line 237) still says `ScheduledSession` is "one table, two module owners — `planning` writes it, `attendance` reads it", **directly contradicting D-057** in the same file (§1.2), which gives it its own module.
- The attendance table is called **`AttendanceRecord`** at `01-…:209`, `01-…:237`, `01-…:376` and `01-…:449`, and **`AttendanceEvent`** at `01-…:377`. Two names, one table, including inside the aggregate-boundary table.
- `PersonRelationship` appears **twice** in §3.1 with different field sets (line 295 has `evidence?`; line 331 has `authority`) — the second row is stranded inside D-060's prose block.
- `02-…:32` makes MFA mandatory for **`platform.super_admin`**, and `07-…:57` alerts on its use — a role `00-…` §5.1 and `02-…` §2.4 both state does not exist.
- `03-…:70` requires "**All configuration via environment variables**… No configuration file editing" — the exact opposite of D-036/D-037.
- `07-…` FM-6 is "**Fleet** version skew / migration fails mid-rollout → Waves, bounded skew" — a failure mode `03-…` §1.1 deleted.
- `02-…:476` still describes erasure per **D-007**, superseded by D-065 twenty lines below it; `04-…:176` and `08-…:189` also still cite D-007.
- `00-…:211` says the prototype import path is **R-20**; the requirements table says R-20 is migrations/upgrades and the import path is **R-29**.
- `02-…` §3 item 3: "These replace the old scope-escape suite is non-optional for Definition of Done" — unparseable. `02-…` §2.3 repeats "one place to get list filtering right" twice in one sentence.
- `01-…` §3 preamble: "`id`, `id`, `createdAt`, `updatedAt` are implied".

Ten defects in the normative set, several of which are contradictions rather than typos. This is the ordinary consequence of 4000 lines maintained by one person across three architecture revisions, and it is a signal that the document set is now large enough to generate its own maintenance load — before any code exists to keep in sync with it.

---

## Recommendation in one paragraph

Freeze the design at chapter 14. Go and watch two evenings of lessons at one real swim school, and specifically watch what happens when a child turns up in the wrong group, when a parent phones in sick, and when the WiFi drops. Close OD-2 with a name. Then build Tier 1 in twelve weeks with the thirteen load-bearing decisions intact and the eleven cuts above taken, ship it to that one school running on Jack's own hardware, and let their first month decide what chapter 15 says. The self-hosting product — IdP registry, settings registry, retention engine, restore matrix, CMS — is a real product and probably a good one, but it is the *second* product, and building it first means the swim school never sees anything at all.