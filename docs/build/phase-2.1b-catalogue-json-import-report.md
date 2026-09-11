# Phase 2.1b — D-188's JSON authoring surface

**Branch** `feat/skills-catalogue-json-import` · **From** `7860c88` (996
tests) · **To** 1015 tests · **Not pushed, not merged, not deployed.**

D-188's second surface over the assessment catalogue: an administrator can
export the current `AwardType`/`GradeScale`/`GradeValue`/`CriterionSet`/
`Criterion` catalogue as one JSON document, edit it, and upload it back to
create or update award types, criterion sets and criteria in bulk — the same
model, the same validation, the same audit trail the form editor already
uses. This closes the open item phase 2.1's own report recorded at §1.2:
*"D-188's JSON authoring surface is not built — the form editor only."*

No new tables. This is a new interface over the tables phase 2.1 built.

---

## 0. What landed

| Commit | |
|---|---|
| `feat(skills): D-188 catalogue JSON domain/service layer` | Threads an optional `DatabaseClient` through `createAwardType`, `updateAwardType`, `createCriterionSet`, `updateCriterionSet`, `publishCriterionSet`, `createCriterion`, `updateCriterion` so a caller can compose several catalogue writes into one all-or-nothing transaction without nesting `prisma.$transaction` calls. Adds `catalogue-json-service.ts` — `exportCatalogue`/`importCatalogue`/`parseCatalogueDocument`. |
| `feat(skills): catalogue JSON export/import UI and route handler` | `/api/skills/catalogue` (`GET` exports, `POST` imports); an export link and an upload panel on `/skills`; a per-award-type export link on `/skills/[awardTypeId]`; NL/EN strings under `skills.json.*`. |
| `test(skills): catalogue JSON structural parsing, round-trip, all-or-nothing` | Unit coverage for `parseCatalogueDocument`'s shape checks; integration coverage for `exportCatalogue`/`importCatalogue` against a real database. |
| `test(e2e): first Playwright spec — group course-level assignment` | Cherry-picked from `e2e-spec-only` (see §5) — the scratch-database/MFA-enrolment harness this phase's own browser test reuses. |
| `test(e2e): D-188 catalogue JSON export/import, real browser` | The mandatory real-browser verification: export, edit, re-import, and the deliberate-refusal path. |

### 0.1 What changed and what did not

Reused, unchanged in shape: every guard (`skills.read`/`skills.manage_catalogue`
at `{ organization: true }`), every validation rule (`requiredText`,
`requiredEnum`, `assertCanPublish`, `assertSequenceIsFree`, D-081's versioning),
every audit event. `createAwardType` and friends gained one new, optional,
trailing parameter (`client: DatabaseClient = prisma`) and nothing else about
their signature or behaviour changed for an existing caller — the seven
call sites in `src/app/skills/actions.ts` are untouched, and
`tests/integration/skills-services.test.ts`/`skills-constraints.test.ts`/
`skills-scope-escape.test.ts` (phase 2.1's own suites) pass unmodified against
the refactored files.

New: `catalogue-json-service.ts` (`exportCatalogue`, `importCatalogue`,
`parseCatalogueDocument`, `CatalogueImportError`), five new repository reads
(`findAwardTypeByCode`, `findCriterionSetByVersion`, `findCriterionByCode`,
`findGradeValueByCodes`, `gradeValueCodesById`), the route handler, the panel,
two new criteria/strings, and the tests.

---

## 1. The JSON document's shape, and why

D-188 names the requirement — *"an administrator uploads it to create or
update award types, their skills and the requirement thresholds in bulk, and
can export the current catalogue back out in the same shape"* — but does not
specify a document shape. **This is the one open design choice in D-188's
text, and here is the shape chosen and why:**

```json
{
  "catalogueVersion": 1,
  "awardTypes": [
    {
      "code": "A",
      "name": "Zwemdiploma A",
      "kind": "DIPLOMA",
      "issuingBody": "NRZ",
      "criterionSets": [
        {
          "version": 1,
          "source": "NRZ",
          "status": "ACTIVE",
          "passFloor": { "gradeScale": "NRZ-5", "grade": "VOLDOENDE" },
          "criteria": [
            {
              "code": "A1",
              "name": "Borstcrawl 25 meter",
              "standard": "Zoals in het diploma-boekje.",
              "sequence": 1,
              "minimumGrade": null
            }
          ]
        }
      ]
    }
  ]
}
```

Nested (award types → criterion sets → criteria) rather than a flat table of
rows, because that is how a person reads and edits a catalogue — one diploma,
its versions, their requirements — and D-188's own motivation (Jack: *"vooral
om snel makkelijk meerdere diploma's en bijbehorende vaardigheden en eisen te
kunnen uploaden"*) is explicitly about authoring several diplomas' worth of
structure at once, which a flat table would make harder to read and edit by
hand, not easier.

**Every entity is identified by its own stable, human-typed key — never an
internal `id`.** An `AwardType` by `code`; a `CriterionSet` by
`(awardTypeId, version)` — already the schema's own unique index; a
`Criterion` by `(criterionSetId, code)` — likewise. This is not a stylistic
preference; it is what makes round-tripping meaningful across installations.
`AwardType.id`/`CriterionSet.id`/`Criterion.id` are `cuid()`s: opaque,
generated per-row, and different on every installation. D-188's own text
gives the JSON's first use case as *"the initial load"* — authoring a
catalogue before an installation has any data of its own to reference by id.
A document keyed by internal id could not do that at all; a document keyed by
the identifiers a person already types (a diploma's code, a version number, a
criterion's own short code) can.

**A `GradeValue` reference — a criterion's `minimumGrade`, a set's
`passFloor` — is written as `{ "gradeScale": "<scale code>", "grade": "<value
code>" }`, never `GradeValue.id`.** Same reasoning, and it costs nothing extra
to satisfy: D-160 already seeds exactly one grade scale identically on every
installation, so its codes (`NRZ-5`, `ONVOLDOENDE`..`ZEER_GOED`, whatever an
installation's own scale is named) are the portable key the ids never were.

**Status can be `"DRAFT"`, `"ACTIVE"`, or `"RETIRED"`.** The first two map
directly onto what the form can do (leave a set open, or publish it); the
third exists purely for round-tripping an `AwardType`'s history — a
`RETIRED` version is never *created* as retired (there is no such action in
the domain: `CriterionSetError`'s own vocabulary has no "retire", only
`publishCriterionSet`'s side effect of retiring whatever was `ACTIVE`
before). `importCatalogue` reproduces a `RETIRED` entry by publishing it in
version order like any other — the next version's publish retires it as a
side effect, exactly as the form would have. See §2 for what happens when a
document's declared status does not match what the sequence of publishes
actually produces.

**What is deliberately NOT in the document:** `id`s of any kind, `createdAt`/
`updatedAt`, `effectiveFrom`/`effectiveTo` (stamped by `publishCriterionSet`
from the clock, never authored), and the audit trail. None of these can be
authored — they are either generated or observed — so a document is exactly
the part of the catalogue a person could have typed by hand into the form.

---

## 2. What "update in bulk" means, given D-081's versioning — the rules `importCatalogue` follows

D-081 (*"an ACTIVE set is never edited"*) and D-164 (*"the catalogue ships
empty and administrator-authored"*) already constrain what a bulk write may
do; `importCatalogue` does not relax either for the JSON surface's sake.
Per `AwardType`, matched by `code`:

- **Missing** → created via `createAwardType`, verbatim.
- **Present, `kind` matches** → `updateAwardType` (name/issuingBody only,
  same as the form — `code`/`kind` are immutable in both surfaces, see phase
  2.1 §1.4).
- **Present, `kind` disagrees** → refused outright. `AwardType.kind` decides
  which pass rule (D-080) a criterion set is authored against; silently
  reconciling a disagreement here would be exactly the "quietly accepting a
  document describing a different reality" D-188's all-or-nothing guarantee
  exists to prevent.

Per `CriterionSet`, matched by `(awardTypeId, version)`, processed in
ascending version order:

- **Missing** → a new `DRAFT`, via `createCriterionSet` — which always
  allocates the next free version itself (`nextVersion`, MAX+1). The document's
  own `version` number is verified against what got allocated; a gap (the
  document claims version 3 when this installation's next free version is 2)
  is refused, naming both numbers, rather than silently accepting whichever
  the service picked. This is what makes reconstructing a whole
  `DRAFT → ACTIVE → RETIRED` history through re-publishing (see §1) safe: the
  document must describe every version in the chain, not skip one.
- **Present, still `DRAFT`** → reconciled: each criterion matched by `code`,
  created if missing, corrected (`updateCriterion`) if present — exactly the
  "add + correct before publishing" path the form already allows. **Nothing
  is ever deleted this way** (see the flag below).
- **Present, `ACTIVE`/`RETIRED`** → D-081's "never edited" case. The document
  is verified to agree with what already exists (status, source, pass floor,
  every criterion field) and refused, naming the exact mismatch, if it does
  not. A document that merely re-describes the current state (an ordinary
  export, re-imported unchanged) is accepted as a no-op.

**Everything above runs inside one `prisma.$transaction`.** The three
service files' write functions (`createAwardType` etc.) each grew one
optional, trailing `client: DatabaseClient = prisma` parameter — the
`person-repository.ts` pattern already in the codebase — so `importCatalogue`
can pass its own transaction client through every one of them instead of
each opening its own. A refusal anywhere — `parseCatalogueDocument`'s shape
check, an `ApiError` from `requiredText` three award types and forty
criteria into the document, a `CriterionSetError`, a D-081 mismatch — aborts
the whole transaction. `tests/integration/skills-catalogue-json.test.ts`'s
"all or nothing" suite queries the database directly after a refusal to
confirm this, not just the thrown error.

**Every refusal names exactly where in the document it happened** —
`awardTypes[1] (A2).criterionSets[0] (version=1).criteria[2] (A2-4): Must not
be empty.` — via a small `via()` wrapper in `catalogue-json-service.ts` that
catches whatever the underlying service throws (`ApiError`,
`CriterionError`, `CriterionSetError`) and rethrows it as a
`CatalogueImportError` carrying the path. "Validation failed" on a
forty-criterion document names nobody; this does.

---

## 3. Flagged for Jack — open design choices, not silently resolved

1. **The document shape itself (§1)** is the one D-188 leaves entirely open.
   Described and justified above; there is no prior art in this repository to
   match against.
2. **No delete through the document.** A criterion or criterion set present
   in the database but absent from an uploaded document is left alone, never
   removed — on exactly the reasoning `criterion-service.ts` already gives
   for having no `deleteCriterion` at all (D-081: a mistake is corrected by
   editing, never removed, even pre-publish). A "the document is now
   authoritative, delete anything it does not mention" mode was considered
   and rejected: nothing in D-188's text asks for it, and a person who
   forgets one line while trimming a large document would silently lose a
   criterion rather than merely fail to add one. If a delete-through-JSON
   mode is wanted later, it needs its own decision — this is not a
   placeholder for one.
3. **A `RETIRED` status in the document is reproduced by publishing, not by
   a direct write** (§1, §2) — there is no other way to reach `RETIRED` in
   the domain. This means a document describing an `AwardType`'s FULL
   history (every version from 1 to the current `ACTIVE` one) round-trips
   correctly; a document that starts mid-history (only the last two versions
   of an `AwardType` that really has five) would allocate versions 1 and 2,
   not 4 and 5, and refuse on the mismatch. Exporting always produces the
   full history, so this only bites a HAND-EDITED document that
   deliberately narrows the version range — flagged as a real, if narrow,
   limitation rather than a bug.
4. **Immutable-set verification is field-by-field equality, not a diff
   report.** A document that disagrees with an already-`ACTIVE`/`RETIRED`
   version is refused with one message per mismatched item, not a full diff
   of what disagrees where. Given D-081 refuses the write outright either
   way, this was judged sufficient — the administrator's fix is the same
   either way (start a new version) — but a future iteration could enumerate
   every field that disagrees, not just the first one `via()` reaches.

---

## 4. Tests

New: `tests/unit/catalogue-json-document.test.ts` (structural parsing —
shape errors named by exact path) and
`tests/integration/skills-catalogue-json.test.ts` (12 tests: guard checks,
export serialisation with grade codes rather than ids, a full
export → wipe → re-import round trip compared by content, all-or-nothing
rollback verified by querying the database after a refusal, reconciling an
open `DRAFT`, and refusing to silently rewrite an already-published
version). Both pass, and pass together with phase 2.1's own three suites
(`skills-services.test.ts`, `skills-constraints.test.ts`,
`skills-scope-escape.test.ts`) and the message-catalog parity test —
**8 files, 85 tests, all green** — run repeatedly to confirm this is not
incidental.

`npm run typecheck`: clean. `npm run lint`: clean. `npm run format:check`:
clean on every file this phase touched.

### 4.1 The full suite, in this environment — a pre-existing condition, not a regression

Running the entire suite in one `npx vitest run` (or `npm test`) invocation in
this sandbox is unreliable **independent of this phase's changes**:

- A single full run was killed outright by the OOM killer (`exit 137`) —
  `free -h` shows headroom at the host level, so the limit is a container/
  cgroup one this phase has no way to raise.
- Repeated full runs that did complete produced wildly different failure
  counts (19, 41, 59, 82 failing tests) across identical invocations, always
  in files this phase never touches — `recurrence-correction.test.ts`,
  `audit-checkpoint.test.ts`, `lane-assignment.test.ts`,
  `exams-services.test.ts`, `attendance-*`, none of them `skills`.
- **Confirmed pre-existing, not introduced by this branch**: checked out
  `7860c88` (this branch's own base, in a separate disposable worktree,
  before any of this phase's code existed) and ran `audit-checkpoint.test.ts`
  alone, freshly, against the same test database — 9 of its tests failed
  there too.
- Isolating batches of ~12 integration files at a time (rather than all 86
  files together) reduces but does not eliminate the flakiness, which points
  at shared-database/connection pressure across a long sequential run rather
  than a specific broken test.

**What this phase's own tests were verified against, repeatedly and
reliably**: the 8-file, 85-test `skills`-only batch above, `typecheck`,
`lint`, `format:check`, and (§5) a real browser. None of this phase's new or
modified files appear in the unrelated-suite failure lists across any of the
repeated full-suite attempts. Flagged for Jack rather than silently
"fixed" by, say, reducing test isolation or skipping suites — the fix (more
memory, or per-file database isolation as `vitest.config.ts`'s own comment on
`fileParallelism: false` already anticipates wanting) is an environment or
test-infrastructure change outside this phase's scope.

---

## 5. Browser verification

`tests/e2e/catalogue-json-import.spec.ts`, against a real Chromium browser via
Playwright, on `tests/e2e/group-course-level.spec.ts`'s own scratch-database
pattern (a dedicated `splashtrack_scratch_e2e_test` database, truncated before
the run; a fresh administrator created and enrolled in MFA through the actual
enrolment screen, TOTP code computed from the manual key exactly as a person
would type it).

That harness (`group-course-level.spec.ts`, `scripts/reset-scratch-database.ts`,
`.env.e2e`) already existed as a committed pair of commits on a separate,
unmerged branch (`e2e-spec-only`, also present on `origin`) — not yet part of
`build/v1-foundation`. Cherry-picked onto this branch rather than
reconstructed, since the content is identical; **flagged for Jack**: when
`e2e-spec-only` and this branch are both eventually merged, the cherry-picked
commit will show as a duplicate of the original and should be reconciled
(rebase or accept the duplicate — either is safe, since the content is
byte-identical) rather than silently left as two copies of the same commit in
history.

**What the spec actually does, and confirms:**

1. Signs in as a fresh administrator, enrols MFA through the real QR/TOTP
   flow.
2. Creates one award type, one `DRAFT` criterion set, one criterion — through
   the ordinary form, not seeded directly — so the export below is exporting
   real, form-authored data.
3. Clicks "Volledige catalogus exporteren", downloads the file, and parses it.
4. Edits the parsed document **in memory**: corrects the criterion's name,
   adds a second criterion — the bulk-authoring case D-188 exists for, scaled
   down to one change and one addition.
5. Uploads the edited document via the panel's file input and confirms the
   success message ("Geïmporteerd: …") — then navigates to the criterion
   set's own screen (a real page load, not a client-side assertion) and
   confirms both the corrected name and the new criterion are there, read
   back from the database.
6. Builds a THIRD document: the same catalogue plus one more criterion with a
   blank name (refused by `requiredText`, three levels deep in the document),
   and also renames the award type to a value the test can grep for.
   Uploads it.
7. Confirms the upload is refused with a visible error ("Import geweigerd —
   …") and, critically, confirms from the browser's own next render that
   **nothing changed**: the award type's name is unaffected, the criterion
   set still holds exactly the two accepted criteria, and the deliberately
   invalid third one does not exist.

Ran twice in direct succession; passed both times (~12s each). One real
finding fixed along the way: the criteria table on a still-`DRAFT` set
renders each criterion as an editable `<input>` (`defaultValue`), not plain
text — a real browser is what caught that `page.getByText(...)` would never
have matched a value the way it matches rendered text, the exact class of
defect `group-course-level.spec.ts`'s own file comment describes finding
originally.

---

## 6. Definition of Done

| Requirement | Status |
|---|---|
| JSON export | `exportCatalogue` — full catalogue or one award type (`?awardTypeId=`), via `/api/skills/catalogue` (`GET`), downloadable |
| JSON import | `importCatalogue` — create-or-update in bulk, through the exact services the form uses, one transaction | 
| All-or-nothing | Verified by database query after refusal, not just the thrown error (`skills-catalogue-json.test.ts`) |
| Round-trip | Verified by content equality after export → wipe → re-import (`skills-catalogue-json.test.ts`), and by a real browser (§5) |
| UI | Export link (list + per-award-type detail) and upload panel on `/skills`, Dutch/English strings, parity-tested |
| Reuse, not a parallel importer | No new validation rule anywhere in `catalogue-json-service.ts` — every field check, every business rule, every audit event is the existing service's own |
| Real browser verification | `tests/e2e/catalogue-json-import.spec.ts` — happy path and refusal path, both against a real Chromium browser, both passing repeatedly |
| CI | `skills`-scoped suite: 8 files / 85 tests, green, repeatedly. `typecheck`/`lint`/`format:check`: clean. Full-suite run: pre-existing environment flakiness, not a regression — §4.1 |
| Jack's approval | Not yet requested — this report is the handoff |

**Open items for review (§3 has the detail):**
1. The document shape (§1) — the one choice D-188 left open, described and
   justified, no prior art to match.
2. No delete through the document — a criterion/criterion-set present in the
   database but absent from an upload is left alone, never removed.
3. A `RETIRED` entry round-trips only when the document describes the FULL
   version history from 1 — a hand-edited document narrowing the range would
   be refused, not silently reinterpreted.
4. Immutable-set mismatches report the first field that disagrees, not a
   full diff.
5. `e2e-spec-only`'s two commits are now duplicated (cherry-picked) onto this
   branch — reconcile when both branches eventually merge (§5).
