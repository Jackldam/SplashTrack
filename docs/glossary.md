# Glossary — Dutch domain terms and their English identifiers

**Why this file exists.** D-159: schema identifiers, column names, API field
names and code are English without exception, while the domain is Dutch and the
UI is Dutch. This file is the translation record. The schema is not.

**Rule.** Before introducing a domain concept in code, add it here. One English
identifier per concept, fixed once. Renaming a schema concept after ten modules
use it is expensive — and, because encrypted columns bind their identity into
the crypto envelope, renaming an encrypted table is worse than expensive.

**Status column.** `fixed` — decided, safe to use. `proposed` — my translation,
not yet confirmed by the domain expert. **Do not build a `proposed` term into a
migration without asking.**

---

## Core domain

| Dutch | English identifier | Status | Meaning, where the English could mislead |
|---|---|---|---|
| leerling | `StudentProfile` | fixed | The pupil *as a learner*. Distinct from `Person` (the human) and `Membership` (the club relationship) — D-053. |
| lid / lidmaatschap | `Membership`, `MembershipPeriod` | fixed | Club membership. A pupil may have lessons without being a member, and a member may never swim. Leave-and-return is a second `MembershipPeriod`, never a mutated row (D-059). |
| ouder / voogd | `PersonRelationship` (guardian) | fixed | Legal authority is *evidence*, not an assumption. Authority lapses at the age of digital consent (D-151). |
| groep | `Group` | fixed | A teaching group. Progress is recorded per individual, never per group. |
| lesuur / les | `ScheduledSession` | fixed | One lesson occurrence at a time and place. Owned by the `sessions` module (D-057). |
| locatie | `OrganizationUnit` | fixed | The club has **one** location today (2026-09-03). `UNIT` is a flat scope with no descendant walk (D-121) — that answer confirms the choice rather than straining it. |
| bad | `Pool` | fixed | A pool within a location. Two of them: one with six 25 m lanes, one with three. A facility — **never** an `OrganizationUnit`, never a scope type (D-175). |
| baan | `Lane` | fixed | A lane in a pool. Also a facility, not a scope: a lane is where a lesson happens, not who may read a child's record (D-175). |
| instructeur / leraar | `Instructor` (role) | fixed | A role, never a membership requirement (D-060). |
| invaller | — | proposed | Substitute instructor. Reach follows session participation, not group membership. |
| aanwezigheid | `AttendanceEvent` | fixed | Append-only. A correction writes a superseding event; the original row is never touched (D-061). |
| lidnummer | `memberNumber` | fixed | The club's own member number, on `Membership`. **One per person, for life, unchanged across a gap** (§3.1) — which is why leaving and returning may not create a second `Membership`. A STRING, not an integer: `0042` and `42` are one integer and two member numbers. |
| leerlingnummer | `studentNumber` | fixed | The pupil number, on `StudentProfile`. A SEPARATE numbering space from `memberNumber` — D-053's "different numbering", so a person who is both carries two. |
| lidmaatschapsperiode | `MembershipPeriod` | fixed | One interval of belonging. Belonging is a set of intervals and never a status flag (D-059); at most one may be open at a time. |
| in- en uitschrijfgeschiedenis | `StudentLifecycleEvent` | fixed | The pupil's append-only history — `JOINED`, `PAUSED`, `LEFT`, `RETURNED`, `TRIAL_ATTENDED`. Current status is DERIVED from it. A group move is **not** here: that is `GroupMove`, owned by `groups` (D-134 gives the fact one home), and moving a child DOWN a level must read as ordinarily there as moving up. |
| pauze | `PAUSED` (lifecycle) | fixed | A pupil taking a break — a broken arm, a term abroad. **Not a departure**: the person is still held under D-066, and treating a pause as an ending would start a retention clock on a child who returns in September. |
| gezag / toestemmingsbevoegdheid | `PersonRelationship.authority` | fixed | That a relationship CLAIMS the right to consent on the subject's behalf. Evidence of a claim, never a legal determination (D-063), and never an authorization scope — `RELATED` was removed from `ScopeType` and must not return (OD-5, D-161). |
| onderbouwing | `PersonRelationship.evidence` | fixed | HOW the authority claim was established. Mandatory wherever authority is claimed, encrypted under the D-096/D-167 envelope, and disclosed only through an audited read. |
| leeftijd digitale toestemming | `ageOfDigitalConsentYears` | fixed | The age at which a person consents for themselves, and therefore at which guardian authority lapses by operation of law (D-151). A `bounded` setting (13–18, default 16 — Art. 8(1)'s own range), evaluated at READ TIME. Nothing marks a row on a birthday. |

## Assessment and awards

| Dutch | English identifier | Status | Meaning, where the English could mislead |
|---|---|---|---|
| **aftesten / aftest** | `Assessment` (kind: `PRE_EXAM`) | fixed | **The four-eyes gate.** A *different* qualified instructor — never the pupil's own — grades every criterion and decides whether the pupil may sit the exam. This is the load-bearing concept of the domain and it has no English equivalent; "pre-exam assessment" is a description, not a translation. |
| afzwemmen | `Exam` / `ExamSession` | fixed | The exam itself, at which the diploma is earned. In practice the formality: the decision was made at the aftest. |
| proefzwemmen | `TrialLesson` | fixed | **A trial lesson for a prospective pupil.** Confirmed 2026-08-31: this is an enrolment concept, *not* a rehearsal before the exam. An earlier draft had it backwards. |
| inhaalles | — (a `ScheduledSession` with a guest) | fixed | **Not its own entity.** An ordinary lesson that a student enrolled elsewhere attends once (D-179). The receiving instructor's reach over that child comes from participation in the session, never from group membership. |
| vaardigheid | `Skill` / `Criterion` | fixed | An assessable requirement. Authored by an administrator in the application, never seeded from source (D-164). |
| diploma | `AwardType` (kind: `DIPLOMA`) | fixed | Zwem-ABC diplomas. |
| certificaat | `AwardType` (kind: `CERTIFICATE`) | fixed | Same machinery, relaxed thresholds — data, not a special case. |
| eisen / eisenpakket | `CriterionSet` | fixed | Versioned. An assessment from 2026 stays readable against the criteria that applied in 2026 (D-160). |
| cijfer / beoordeling | `GradeValue` | fixed | The five-value ordinal scale: *onvoldoende, matig, voldoende, goed, zeer goed*. Pass is "at least *voldoende*" unless the `CriterionSet` sets a lower threshold (D-160). |
| opmerking | `AssessmentRemark` | fixed | Pedagogical, about the pupil — e.g. *"vertoont een schaarslag"*: not itself a fail if stuwing is sufficient, but a thing to work on. Protected free text (D-148). |

## Money

| Dutch | English identifier | Status | Meaning |
|---|---|---|---|
| contributie | `PERIODIC` `Charge` | fixed | Membership contribution. |
| examengeld | `EXAM` `Charge` | fixed | Created by the event of being approved for an exam, never in advance (D-089). |

Tracking only — no invoicing, no iDEAL/Mollie, no direct debit, no VAT (§6.5).

## Organisations and external bodies

| Dutch | English identifier | Status | Meaning |
|---|---|---|---|
| NRZ (Nationale Raad Zwemveiligheid) | — | fixed | Must be told who sits an exam and when; a delegate may attend and must see the candidate list at that moment. **Export/report only — no integration** (D-163). |
| SportLink | — | fixed | External registration, mandatory for competition-swimming and water-polo members only. **Out of v1, no stub column** (OD-19). |
| wachtlijst | `WaitingList`, `WaitingListEntry` | fixed | **One list for the club**, not a queue per group. An entry records the child and the level; placement is a matching decision against groups that have room, never automatic and never strictly first-in-first-out (D-180). |

## Infrastructure terms

Not domain vocabulary, and not Dutch — none of these has a `leerling`-shaped
counterpart at the poolside. They are here because `CLAUDE.md` §3 fixes one
English identifier per concept **in this file, before it is built**, and each of
these is a permanent name later code must not re-spell.

| Concept | English identifier | Status | Meaning, and why the name is permanent |
|---|---|---|---|
| encrypted-column identifier | `columnId` | fixed | The stable logical name of an encrypted column, from the registry in `src/lib/crypto/encrypted-columns.ts`. It is bound into the AAD of every value ever written for that column, so it is assigned once, never renamed and never reused (D-167). The physical model and field are separate, MUTABLE registry fields — that split is the whole decision. |
| encryption envelope | `Sealed`, `seal`, `open` | fixed | The D-096 envelope `v1:<keyId>:<nonce>:<ct>`. `Sealed<C>` is the branded type a protected column carries; `seal` and `open` are the only ways in and out. |
| key generation | `keyId` | fixed | WHICH generation of `SECRET_KEY` a value was written under. Distinct from a **purpose label** (`medical-v1`), which selects the HKDF branch. Rotation increments the key id and never changes a purpose (D-096, D-112). |
| audit checkpoint | `AuditCheckpoint` | fixed | The signed anchor a retention run leaves behind so the audit chain still verifies across the gap that run made (D-168). "Checkpoint" is the design's own word — do not introduce "anchor" or "watermark" as a second spelling for it. |
| pruned segment | `prunedSegments` | fixed | One contiguous, deleted prefix of the audit trail, accounted for by one checkpoint. `audit:verify` reports "intact across N pruned segments": a stated gap, never an unexplained hole. |
| grant | `RoleAssignment` | fixed | A permission **plus a scope plus a window plus a granter** (§2.1, D-144). Never just "a permission", and never "a role a person has" — no normative rule in this product binds to a role name (D-130). The row is the whole tuple; dropping any part of it is what F-113 describes. |
| scope | `ScopeType`, `scopeId` | fixed | The granular axis of a grant: which KIND of resource it reaches, and which one. Six types, closed. Not a hierarchy and not ranked — confinement is resource containment (D-170), so "wider" and "narrower" are not properties a scope type has. |
| reach | `Reach` | fixed | What a principal can see for ONE permission, as an **opaque branded union** produced only by `resolveReach` (D-147). Never "scope" (that is one grant's axis) and never "access" (too vague to grep). `NONE` is a real variant meaning "reaches nothing", distinct from "was never resolved". |
| coverage | `coversResource` | fixed | The predicate *"does this reach cover this resource, right now"*. The design names the function and defines it nowhere; the definition is `src/lib/authorization/covers-resource.ts`. Do not spell it `canAccess`, `isAllowed` or `checkScope` — a second name would become a second coverage rule. |
| scope relation | `ScopeRelations` | fixed | The live domain facts coverage is computed from — an active `InstructorAssignment`, an active `GroupMembership`, a session roster — declared by the authorization layer and supplied by the module owning each table. "Relation" is D-145's own word: *"coverage is per **relation**, not per entity"*. |

---

## To confirm with the domain expert

These are my translations and I have not verified them against how the club
actually speaks. Ask before they reach a migration:

- Is there a Dutch term for the person who performs an aftest, distinct from
  "instructeur"? If the club has a word for it, the role should carry it.
