# 06 — Environments, CI/CD, GitHub Workflow & Lucky

## 1. DEV / PROD model

**UAT as a separate environment is out of v1** (`00-overview.md` §3.5.1). One
person is author, reviewer and acceptor; a third environment between him and
himself buys a handover that does not happen. The decision is retained on paper
and the environment is added the day a second acceptor exists.

| | DEV | PROD (per instance) |
|---|---|---|
| URL | `dev.splashtrack.sysadminheaven.com` | The organisation's own |
| Purpose | Lucky develops, tests, breaks things | **The school's live instance**, plus our own demo/reference copy. Other self-hosters run copies we never touch |
| Data | **Synthetic only** — seeded, never real | Real personal data |
| Deploys on | Every merge to `main` | Tagged release, **manual approval** — and the same tag publishes the public image |
| Lucky access | Full lifecycle | **None** |
| Jack access | Full | Full |
| Config | **Bootstrap environment variables only; every runtime setting is database-backed** (D-036, D-037 — stated once in `13-…` §3.1) | Same |
| Reset | Anytime, scripted | Never |

The Config row previously read *"env vars per environment"*, which contradicts
the entire configuration architecture in the table an implementer uses to set
the environments up.

**Decision D-022 (revised) — The same container image is promoted DEV → every
production instance.**
**Reason.** An image built once and promoted is the only way to know that what
was accepted is what runs. Rebuilding per environment means testing something
you never ship.
**Trade-off.** All environment *and per-deployment* differences must be
expressible as runtime configuration and secrets — no build-time flags, and no
per-deployment branches or images, ever. This is a hard discipline constraint on
every future feature, and it is what makes an instance we cannot see
supportable.

**Note on existing behaviour.** `deploy-uat.yml` in the template runs
`docker compose build` **on the target host** — it builds at deploy time rather
than promoting an image, which is the direct inversion of this decision. That
workflow is **replaced**, not extended. With UAT out of v1 it is deleted
outright, and the release workflow publishes the image the tag built.

**Decision D-023 (kept as policy) — no environment below production ever
receives a copy of production data.** The environment is gone; the rule is not,
because it costs nothing and it is the most common way GDPR compliance is lost
in practice. DEV gets a rich synthetic dataset from a seed script.

```text
  merge to main
        │
        ▼
   build image  ──▶ ghcr.io/jackldam/splashtrack:<sha>
        │
        ├──▶ deploy DEV        (automatic)
        │
        └──▶ tag v1.2.0 ──────▶ promote the same image + release notes
                                    ghcr.io/…/splashtrack:1.2.0
                                    signed · SBOM · provenance
                                    + restore fixture as a release asset
                                    → deploy to PROD on manual approval
                                    → self-hosters upgrade on their own schedule
```

**The restore fixture ships from v1.0 even though the restore matrix does not.**
D-047's matrix is out of v1 — there are zero prior releases, so it would be
green while protecting nothing. But **fixture generation must ship with v1.0 or
v1.0 is permanently untestable as a restore source.** The release workflow's
final step boots the just-built image against a scratch Postgres, seeds a
deterministic fixture, backs it up under a **fixed public test key** (no
credential ever goes into a fixture, F-19), and uploads it as a GitHub Release
asset — not a git commit. Adding the matrix at v1.3 is then a job that reads the
Releases API, and D-048 (never squash) is what keeps the migrations those
fixtures need.

## 2. CI/CD strategy

### 2.1 Required checks (block merge)

**First, a correction.** This section previously opened *"The template's CI
already implements most of this."* It does not. `.github/workflows/ci.yml` has
**three jobs** — `verify` (format, lint, typecheck, seed smoke, Vitest, build),
`e2e` (Playwright) and `migrate-populated`. There is **no container build, no
`npm audit` gate, no CodeQL, no secret-scanning job, and no axe assertion
anywhere in `tests/`** — grep finds axe only in prose. Of the fifteen checks
this table used to require, seven existed. Everything else was a plan described
in the present tense.

**v1 ships eight blocking checks** (`00-overview.md` §3.5.1). The rest are
listed below the line with the honest status, so nobody reads a plan as a gate.

| Check | Blocking in v1 | Notes |
|---|---|---|
| Format (Prettier) | Yes | Inherited |
| Lint (ESLint, incl. module-boundary rules) | Yes | Inherited. Extended: the second rule that stops a module reaching another module's Prisma models (`05-technical.md` §3.1), and the D-051 rule that `(public)` never imports a person repository |
| Typecheck | Yes | Inherited |
| Unit tests (Vitest) | Yes | Inherited. **Includes** `migration-safety` (inherited), `migration-history-append-only` (new, §2.2), `person-reference-sync` (inherited) |
| Integration tests | Yes | Inherited. Against a real Postgres service container |
| **Scope-escape tests** | Yes | **New, and the most important gate in this table.** See below |
| **Migration against populated DB** | Yes | Inherited: applies base migrations, populates rows, then applies the PR's migrations. Catches destructive migrations before they reach data |
| Secret scanning | Yes | **New.** Plus push protection at the repository level — and note that `apps/web/.env` is currently **tracked** and in history, which must be resolved before the repository is public, not after |
| E2E (Playwright) | Yes | Inherited. Axe accessibility assertions are a **required addition** — they do not exist |

Below the line — required additions, not currently gated by anything, and named
here so `00-overview.md` §4.1 and this table cannot drift apart again:
container build validation, `npm audit` / Dependabot on high and critical,
CodeQL, the attendance load test, the skill-matrix query-count assertion, the
Playwright trace budget, the i18n missing-key check, and the browser matrix.

**Out of v1:** the restore-from-every-supported-release matrix (D-047). Zero
prior releases exist; the fixture that makes it possible ships anyway (§1).

#### The scope-escape gate — named for the concept that exists

This check was previously called **"Organisation isolation tests"**. That is the
name of the *old tenancy suite* — the one D-032 exists to replace. It is not a
stale label: a team building the gate from this chapter writes cross-organisation
isolation tests, which in a single-organisation instance are **vacuous and pass
forever**, and never writes the suite that is the primary internal control. The
findings chapter calls scope escape the highest-severity internal risk in the
product, so the gate backing it must not be satisfiable by a trivial assertion.

Renamed, and its minimum content specified so "a module has scope-escape tests"
means something. **Per module**, all of the following:

| Case | Assertion |
|---|---|
| A `GROUP`-scoped principal | attempting **read**, **write** and **list** outside their group is denied on all three |
| A `UNIT`-scoped principal | the same three, outside their unit — and `UNIT` is **flat** in v1, so a child unit is outside it |
| A `SESSION`-scoped principal | the same three, outside the session they are assigned to **and outside its time window** |
| Reach construction | a `Reach` **cannot be constructed outside `resolveReach()`** — asserted structurally, not by convention |

The **list** case is the one that must never be dropped. Read and write are
usually guarded explicitly; a list query silently returning too much is the
exact failure mode tenancy filtering had, one level down (F-15), and it is what
`Reach`-as-a-required-repository-argument (D-031) exists to make impossible.

A module without this suite fails Definition of Done.

**Decision D-024 — Deployment is impossible from a branch; only from a tag on
`main` through an environment with required reviewers.**
**Reason.** The brief demands it. GitHub Environments with protection rules
enforce it at the platform level rather than by convention.
**Trade-off.** Hotfixes take one extra step (branch → PR → merge → tag).
Accepted; a hotfix path that bypasses tests is how outages get worse.

### 2.2 D-048 is enforced by nothing — the test that fixes that

D-048 says migration chains are never squashed within a major version. It is
kept in v1 precisely because it is free and because it is what makes D-047
addable later. But as written it is a sentence in a document, and squashing
*feels like tidying* — it is the kind of rule that gets broken by someone being
helpful on a Friday, and the damage is invisible until a self-hoster's old
backup will not restore.

Ship **`tests/unit/migration-history-append-only.test.ts`**, in the style the
template already uses for `migration-safety`:

1. Assert the set of migration names at the **last release tag** is a **subset**
   of the set at `HEAD` — nothing may disappear.
2. Assert **no applied migration's SQL content hash has changed**, against a
   committed `prisma/migrations/.lockfile.json`.

Squashing or editing an applied migration is then a red build rather than a
discovery two years later. Adding a migration updates the lockfile in the same
commit, so the diff shows exactly what was added — which is also a useful review
artefact in its own right.

### 2.3 Secrets and cloud access

- Deploy credentials live in **GitHub Environments** for our own dev/demo
  instances only. We hold no credentials to any customer deployment (D-012
  final).
- The **release workflow** — which signs and publishes the public image — is the
  most security-critical automation in the repository. It runs only from a tag
  on `main`, and no contributor (including Lucky) may modify `.github/` (F-18).
- Prefer **OIDC federation** over long-lived cloud keys.
- PROD secrets are never readable by CI jobs triggered from a fork or from a
  pull request — only from a tag build on `main`.
- No secret is ever in the repository, in an image layer, or in a log line.

## 3. GitHub workflow

### 3.1 Traceability rule

**Every change traces to an issue.** Branch names carry the issue number, PRs
link it with a closing keyword, and the PR template requires a "change reason".
A PR with no linked issue does not merge.

```text
main            protected · no direct pushes · linear history
  └ feat/123-attendance-registration
  └ fix/145-session-timeout
  └ chore/150-dependency-bump
  └ docs/151-adr-audit-chain-checkpointing
```

### 3.2 Issues

Templates for: **bug report**, **feature request**, **security finding**
(private reporting enabled), **ADR proposal**, **chore**.

Labels: `type:*` (bug/feature/chore/docs/security), `module:*` (attendance,
skills, exams, …), `priority:*`, `env:*` (dev/prod), `needs:decision`,
`blocked`, `good-first-slice`.

Milestones track vertical slices, not layers — "Attendance registration
end-to-end", never "Attendance backend".

### 3.3 Pull requests

Required in the PR body: linked issue; what changed and why; security impact; **upgrade impact for self-hosters** (breaking change? migration duration? operator action needed?);
**privacy impact** (does this touch personal data? retention? erasure?);
migration impact; test evidence; screenshots for UI changes.

Reviews: at least one human approval — **Jack's** — on every PR. Lucky may
open and update PRs; Lucky may never approve or merge one.

### 3.4 Releases

Semantic versioning. `-rc.N` tags publish a release candidate image and deploy
nowhere; clean tags publish the public image and deploy to PROD after approval. Release notes generated from linked issues, so the changelog is
a by-product of the traceability rule rather than extra work.

## 4. Lucky — AI development agent permissions and boundaries

### 4.1 The governing principle

**Lucky has no identity inside the SplashTrack application.** Lucky is not a
user, not a role, not a service account in the product. Lucky is a developer
with access to a development environment and a GitHub account — nothing more.
This removes an entire category of risk: there is no permission to escalate,
because there is no principal.

### 4.2 What Lucky may do

| Environment | Lucky's capability |
|---|---|
| **Local / DEV** | Full lifecycle: edit code, create branches, write and run tests, build containers, run migrations, deploy to DEV, read DEV logs, analyse failures, work issues, open PRs, update docs |
| **GitHub** | Create branches, push, open/update PRs, comment, triage issues, apply labels. **Cannot** approve PRs, merge, push to `main`, change branch protection, edit workflow permissions, or manage secrets |
| **PROD / any deployed instance** | **Nothing, and nothing exists to have.** No deployment — the school's, ours, or a self-hoster's — is reachable by anyone here (D-012 final) |
| **Secrets** | None. DEV uses generated throwaway values; PROD secrets live in GitHub Environments Lucky cannot read |
| **Real personal data** | Never. DEV contains synthetic data only (D-023) |

### 4.3 Prompt injection and untrusted input

Lucky reads GitHub issues, which are attacker-influenceable when the repository
is public or accepts outside reports. The mitigations are structural rather
than behavioural:

1. Lucky's only output channel is a **pull request that a human reviews**.
2. Lucky holds no secrets and no production path, so a successful injection
   cannot exfiltrate or destroy anything of value.
3. Workflow files, branch protection and CODEOWNERS are **excluded from
   Lucky's write scope** — a PR touching `.github/workflows/` requires explicit
   human authorship. This prevents the classic "convince the agent to weaken
   its own CI" escalation.
4. Content from issues is treated as data, never as instructions that expand
   Lucky's own permissions.

**Decision D-025 — Lucky's boundary is enforced by absent credentials, not by
instructions.**
**Reason.** An instruction telling an agent not to touch production is a
suggestion; a missing credential is a wall. Every boundary above is a fact
about what Lucky *has*, not a rule Lucky is asked to follow.
**Trade-off.** Lucky cannot help diagnose a production incident directly and
must work from exported, sanitised evidence. Correct trade for a system holding
data about children.

### 4.4 Definition of Done for a Lucky-authored slice

A slice is done when: data model → service → UI → tests → docs are all present;
**scope-escape tests exist** for the module (§2.1 — the old wording said
"isolation tests", which is the deleted concept); every new `Person` reference
has a `person-reference-classification.ts` entry, so the inherited sync test
stays green; the privacy questionnaire in the PR template is answered; CI is
green; and Jack has approved. Backend without UI is not a slice. Partial
functionality is never presented as complete.

## 5. Build order

Sequencing matters more than usual here because three of the highest-value
mechanisms are the ones that are most expensive to retrofit. Ranked by **cost of
doing it late**:

| # | Item | Why this rank |
|---|---|---|
| 1 | **Encryption envelope and key derivation** | Every encrypted byte written before the envelope exists has to be found and re-wrapped, and the key split decides whether a restore preserves MFA enrolments. Nothing that stores a secret may be written first |
| 2 | **Audit chain-aware rotation and checkpointing** | The chain is append-only at the database level. Deciding rotation after two years of events means retroactively rewriting a tamper-evidence claim |
| 3 | **The scope model** | It changes the signature of the guard **every module calls**. Any domain module built first has to be rewritten — and worse, its scope-escape tests were written against the wrong question |
| 4 | **Append-only event models** with `clientEventId` / `supersedes*Id` | Converting a mutable column into an event log after data exists means inventing the history you destroyed |
| 5 | **Settings** | Every feature that reads configuration before the settings page exists reads it another way, and must be ported |
| 6 | **Consent extension** | Same retrofit-hostility as (4): a consent captured under the current shape has no recoverable actor, and consent on behalf of a minor is the majority case |
| 7 | **Restore-fixture generation** | Must ship *with* v1.0 or v1.0 is permanently untestable as a restore source (§1) |
| 8 | **Erasure registry entries** | Cheap individually, but the inherited sync test fails the build the moment a domain model adds a `Person` reference — so it belongs in the DoD, not in a surprise |

**Phases.**

- **Phase 0 — repository hygiene (days).** Resolve the tracked `.env` and its
  history, and rotate what it contains, before the repository is public. Confirm
  the layout (flat root, `05-technical.md` §3). Add Zod. Write the glossary
  (OD-10 — cheap, and it blocks every schema name after it).
- **Phase 1 — foundation, no domain code.** Crypto envelope and golden vectors →
  boot state machine including the **`FAILED`** state → settings → production
  Dockerfile → backup, restore and the recovery token → the eight CI checks,
  including image **promotion** rather than a build on the target host.
- **Phase 2 — removals and reshaping.** D-056's removals, incrementally, tests
  green at each step — including the platform-super-admin branch inside
  `requirePermission`, which is real code and not just prose → the scope model,
  `coversResource()`, reach as a required repository argument, and the
  scope-escape **test harness** so every later module inherits it → consent
  extension → setup wizard on top of all of it.
- **Phase 3 — domain modules, in DAG order.**
  `people → students → groups → courses → skills → sessions → attendance →
  assessment → exams → planning → fees`.
  **Attendance is the flagship and it sits on five modules. Resist starting
  there.** The instinct to build the demo first is exactly what produces a
  flagship screen resting on stubs.
- **Phase 4 — surfaces.** Course catalogue and inquiry form, branding,
  diagnostics, print fallbacks, the waiting list and the breach-response tools.
