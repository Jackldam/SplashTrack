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

---

## To confirm with the domain expert

These are my translations and I have not verified them against how the club
actually speaks. Ask before they reach a migration:

- Is there a Dutch term for the person who performs an aftest, distinct from
  "instructeur"? If the club has a word for it, the role should carry it.
