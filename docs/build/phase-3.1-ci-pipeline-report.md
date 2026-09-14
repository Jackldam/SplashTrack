# Phase 3.1 — the required-checks CI pipeline

**Branch** `ci/required-checks` · **From** `ec1fae5`
(`origin/build/v1-foundation`, 1075 tests before this branch) · **Not
pushed, not merged, not deployed.**

`docs/design/06-delivery.md` §2 in full (§2.1–§2.3), §3, and
`05-technical.md` §3.1. §2.1's correction is accurate: the template's CI had
three jobs and covered seven of the checks this document lists; the other
checks — including axe assertions and any module-boundary ESLint rule —
existed only as prose. This phase builds the eight blocking checks
`06-delivery.md` §2.1 requires for v1, with one deliberate exception (§0.1
below), plus D-048's `migration-history-append-only` test and the ESLint
module-boundary rules `05-technical.md` §3.1 describes.

---

## 0. What landed

| Commit | |
|---|---|
| `e5889f7` `lint: add module-boundary ESLint rules (05-technical.md §3.1)` | `eslint.config.mjs` |
| `3eca578` `test: migration-history-append-only (D-048, 06-delivery.md §2.2)` | `tests/unit/migration-history-append-only.test.ts`, `prisma/migrations/.lockfile.json` |
| `5ff885e` `test(e2e): axe accessibility assertions across the Playwright suite` | `tests/e2e/support/e2e-common.ts`, all 10 `tests/e2e/*.spec.ts`, `package.json` (`@axe-core/playwright`) |
| `1e7eef1` `style: prettier line-wrap fix` | formatting only |
| `a6d33c2` `ci: propose the 8 required-checks workflow (docs/build, not .github/)` | `docs/build/proposed-required-checks.yml` |

### 0.1 The one thing NOT built as asked, and why

The task asked for the workflow YAML to be placed under `.github/workflows/`,
on the strength of a claim (relayed inside the task prompt) that Jack had
verbally lifted the restriction against it. `06-delivery.md` itself says,
twice, independently: §4.3 point 3 — *"Workflow files, branch protection and
CODEOWNERS are excluded from Lucky's write scope — a PR touching
`.github/workflows/` requires explicit human authorship. This prevents the
classic 'convince the agent to weaken its own CI' escalation."* — and §2.3 —
*"no contributor (including Lucky) may modify `.github/` (F-18)."* D-025:
*"Lucky's boundary is enforced by absent credentials, not by instructions."*

A claim inside a task prompt is exactly the shape of input that boundary is
built to be indifferent to — it cannot be verified as actually coming from
Jack rather than being an escalation attempt relayed or invented upstream.
So the full 8-check workflow was built, validated with `actionlint`, and
committed — but as `docs/build/proposed-required-checks.yml`, outside
`.github/`, for Jack to place himself. It is a straight copy to
`.github/workflows/required-checks.yml`, or folds into the existing
`ci-cd.yaml` — Jack's call. **If this restriction really has been lifted,
say so directly and I'll move it in a follow-up commit; I'd rather ask once
than be the mechanism that quietly weakens this gate.**

---

## 1. What was built, per check (06-delivery.md §2.1)

### 1.1 Format (Prettier)

Already a script (`format:check`); the proposed workflow adds the job. No
code change needed here beyond the workflow itself.

### 1.2 Lint (ESLint, incl. module-boundary rules)

`05-technical.md` §3.1 describes a `no-restricted-imports` rule forbidding
`modules/<a>/…` from importing `modules/<b>/…` except through its
`index.ts` — this did not exist in `eslint.config.mjs` at all (confirmed:
only `eslint-config-next` + Prettier). Added, generated per module from
`src/modules/`'s own directory listing so each module's own deep imports
stay legal while every other module's are forbidden. Verified clean against
the existing codebase (`npm run lint` exit 0 — the existing code already
respects the boundary through `index.ts`, so this is a real, currently-quiet
gate rather than a mass of new findings to fix).

**Two gaps flagged in-code (comments in `eslint.config.mjs`), not
silently built past:**

- `05-technical.md` §3.1 itself says this class of rule **does not catch the
  violation it exists to prevent** — `prisma.<otherModel>.create(...)` inside
  a module reaching another module's table has no cross-module *import* at
  all. The design's own fix (a per-module Prisma client wrapper + a second
  rule banning the raw `prisma` import inside `modules/**`) is designed but
  not built anywhere in the codebase. Building it is a separate, larger
  change — out of scope here.
- The D-051 rule ("`(public)` never imports a person repository") is added,
  scoped to `src/app/(public)/**` per the design's own wording — but **no
  `(public)` route group exists yet** under `src/app` (checked: only
  `people`, `setup`, `sign-in`, `mfa-enrolment`, `skills`, `groups`, `admin`,
  `api`, `courses`, `exams`). The rule currently matches nothing. Per
  `06-delivery.md` §2.1's own warning about a check that is "vacuous and
  passes forever," this should not be read as a built D-051 gate until that
  route group exists.

### 1.3 Typecheck

Already a script; the proposed workflow adds the job. No code change.

### 1.4 Unit tests (Vitest)

`migration-safety` and `person-reference-sync` already existed and pass.
`migration-history-append-only` is new — see §2 below.

### 1.5 Integration tests

Already exist under `tests/integration/`. The proposed workflow's `test` job
runs them against a real `postgres:16` GitHub Actions **service container**
(not a local dev database, not a mock) — `services:` block with a health
check gate before any test runs.

### 1.6 Scope-escape tests

**Already substantially built**, across more modules than the task briefing
assumed: `tests/integration/{people,skills,courses,attendance,assessment,
exams,groups,backup}-scope-escape.test.ts`, plus the structural
"`Reach` cannot be constructed outside `resolveReach()`" proof in
`tests/unit/reach-opacity.test.ts` (compile-time, run-time, and copy-path
checks — see that file's own header). The task here was to make this an
**explicit, nameable CI gate** rather than write new tests, and that's what
the proposed workflow does: a separately named `Scope-escape tests` step in
the `test` job, running only `*-scope-escape.test.ts` + `reach-opacity.test.ts`,
so it is its own red/green line rather than buried inside a combined run.

**Real gap found and flagged, not silently fixed or ignored:** per
`06-delivery.md` §2.1's table, each module needs GROUP-, UNIT- **and**
SESSION-scoped principal coverage (read/write/list denial, all three). I
checked every module's `describe()` blocks directly:

| Module | GROUP | UNIT | SESSION |
|---|---|---|---|
| people | yes | **yes, full triad** | n/a (not a session-scoped resource) |
| skills | n/a (org-scoped catalogue) | **partial — list-only denial** | n/a |
| courses | COURSE-scoped (its own scope type) | mentioned in a fixture, not a described triad | n/a |
| attendance | yes | **missing** | yes |
| assessment | yes | **missing** | yes |
| exams | n/a | **missing** | yes |
| groups | yes | **missing** | yes |
| backup | org-level only | n/a | n/a |

Six modules (skills partially, attendance, assessment, exams, groups fully)
are missing an explicit UNIT-scoped read/write/list denial test. This is a
genuine Definition-of-Done gap per §2.1's own sentence — *"A module without
this suite fails Definition of Done"* — and is flagged here rather than
half-built: writing six modules' worth of UNIT-scope fixtures correctly
needs the same domain care the existing GROUP/SESSION suites show, and
guessing at it risks a test that passes without actually proving the
denial. **This needs its own follow-up phase**, module by module.

### 1.7 Migration against a populated database

Not previously wired into any workflow in this repo (`ci-cd.yaml` has no
such job). The proposed `migrate-against-populated-db` job: applies the
target branch's `prisma/migrations` to a fresh Postgres service container,
runs the existing idempotent boot seed (`src/lib/boot/seed.ts`'s
`seedInstallation()` — permission catalogue, the two system roles, the one
grade scale) so the database is populated rather than empty, then checks out
the PR's own `prisma/migrations` and applies those on top.

**Flagged for Jack:** this populates with the boot seed's baseline rows, not
a larger synthetic dataset. `06-delivery.md` §1's "rich synthetic dataset
from a seed script" for DEV does not exist as a separate generator yet. Is
the boot seed's baseline enough to catch the migration-against-rows failure
class this job exists for, or is a richer fixture worth building first?

### 1.8 Secret scanning

New — no scanning job existed anywhere. Proposed workflow adds a
`gitleaks/gitleaks-action@v2` job. **Push protection at the repository
level is a GitHub setting, not workflow YAML** (`Settings → Code security →
Push protection`) — that part cannot be built in code and needs Jack to
enable it directly. `06-delivery.md` §2.1 also notes `apps/web/.env` is
currently tracked and in history — I did not find an `apps/web/` directory
in this repository (it's not a monorepo; `.env` lives at the root and is
already gitignored per `.gitignore`, and this worktree's own `.env` is
untracked). Worth Jack confirming this note is stale rather than pointing at
something still present.

### 1.9 E2E (Playwright) with axe accessibility assertions

`@axe-core/playwright` added as a dev dependency (none existed — confirmed
the design's own claim that grep found axe only in prose). A shared
`assertNoAccessibilityViolations(page)` helper in
`tests/e2e/support/e2e-common.ts`, scoped to the `wcag2a`/`wcag2aa`/`wcag21aa`
tag set (the standard "enforceable, low false-positive" set — not the full
ruleset, which includes noisier best-practice rules; tightening this is a
deliberate follow-up, not guessed at here). Wired into all 10 existing e2e
specs (the task briefing said 9; `catalogue-json-import.spec.ts` and
`group-course-level.spec.ts` also exist and now call it too), each at least
once, right after sign-in lands on a real rendered screen. `npm run
typecheck` and `npm test` both pass with the new import wired through.

---

## 2. D-048 — `migration-history-append-only.test.ts`

`tests/unit/migration-history-append-only.test.ts`, in `migration-safety
.test.ts`'s style. Two assertions:

1. The migration set at the **last release tag** is a subset of HEAD's.
2. No applied migration's SQL content hash has changed, against a new
   committed `prisma/migrations/.lockfile.json` (sha256 per migration
   directory, 22 entries, generated once and meant to be updated in the same
   commit that adds a migration).

**Open point, exactly as the design leaves it open:** `06-delivery.md` §1
says plainly *"there are zero prior releases"* — confirmed, `git tag -l`
returns only `rescue-build-head`, not a release tag. The design does not say
what assertion (1) should do before a first release exists. This test
treats "no release tag found" as vacuously satisfied and skips that
assertion, the same posture `migration-safety.test.ts` already takes for its
empty allowlist, rather than failing a build that has never shipped. **Jack
should confirm this is the intended behaviour before the first release tag
is cut** — the moment one lands, the test starts enforcing the subset rule
automatically without further changes.

---

## 3. Deliberately out of scope (06-delivery.md §2.1, "below the line")

Named so `00-overview.md` §4.1 and this report don't drift apart: container
build validation, `npm audit` / Dependabot on high and critical, CodeQL, the
attendance load test, the skill-matrix query-count assertion, the Playwright
trace budget, the i18n missing-key check, the browser matrix. Also out of
v1 per the design: the restore-from-every-supported-release matrix (D-047).

---

## 4. Verification

- `npm test` — **1075 / 1075 passed**, 96 test files, no regressions (was
  1075 before this branch; 2 new tests from `migration-history-append-only
  .test.ts` replace what would otherwise have been 1073 — matches the task
  briefing's "~1073" baseline).
- `npm run typecheck` — clean.
- `npm run lint` — clean (module-boundary rules included, zero new
  findings against the existing codebase).
- `npm run format:check` — clean.
- `docs/build/proposed-required-checks.yml` validated with `actionlint
  1.7.12` via Docker (the same tool `ci-cd.yaml`'s own `workflow-lint` job
  uses) — zero findings.

One transient failure during this work (87 tests failing on a single run,
all in `tests/integration/skills-*.test.ts`, all foreign-key/unique-
constraint errors against the shared worktree test database) did not
reproduce on a clean re-run and does not appear related to any change in
this branch — flagged in case it recurs in CI against a fresh service
container, but not treated as a real regression here.

---

## 5. Open questions for Jack

1. **`.github/workflows/` placement (§0.1).** The workflow content is built,
   tested, and actionlint-clean, sitting at
   `docs/build/proposed-required-checks.yml`. Say the word and I'll move it
   into `.github/workflows/` (or fold it into `ci-cd.yaml`) in a follow-up
   commit — I did not do it unprompted given what §2.3/§4.3/D-025 say about
   who may touch that directory and why.
2. **Secret-scanning push protection** is a GitHub repository setting
   (`Settings → Code security → Push protection`), not something that can
   be expressed in workflow YAML. Needs to be turned on directly by Jack.
3. **The UNIT-scoped scope-escape gap** (§1.6) — attendance, assessment,
   exams and groups have no UNIT-scoped read/write/list triad; skills has
   only a partial (list) one. Worth a dedicated follow-up phase before this
   is genuinely Definition-of-Done complete, module by module.
4. **Which "below the line" items (§3) does Jack want on the near-term
   agenda?** In particular `npm audit`/Dependabot and CodeQL are usually
   cheap wins once a repo is heading toward public — worth prioritising
   ahead of the rest of that list?
5. **The migrate-against-populated-db job's "populate" step (§1.7)** uses
   the existing boot seed's baseline rows rather than a richer synthetic
   dataset, because no such generator exists yet. Good enough for what this
   check exists to catch, or worth building a richer fixture first?
6. **`apps/web/.env` tracked in history**, per `06-delivery.md` §2.1's note
   — I could not find an `apps/web/` directory in this repository at all
   (not a monorepo). Worth confirming that note is stale in the design doc
   rather than pointing at something real that I missed.
