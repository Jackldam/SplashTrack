# 05 — High-level Technical Architecture

## 1. Architecture overview

```text
  ONE INSTANCE = ONE ORGANISATION (see 03-deployment-model.md)

                     ┌──────────────────────────────┐
  Browser / tablet ──▶│ Reverse proxy (TLS)          │
  Phone            ──▶│  rate limit · security hdrs  │
                     └──────────────┬───────────────┘
                                    │
                     ┌──────────────▼───────────────┐
                     │ Next.js (App Router, Node)   │
                     │  middleware: session + scope  │
                     │   ├ (public)  catalogue + form │
                     │   └ (portal)  portal + admin  │
                     │  modules/ (domain services)   │
                     │  lib/ auth · security · db    │
                     └───┬──────────────┬───────────┘
                         │              │
              ┌──────────▼───┐   ┌──────▼────────┐
              │ PostgreSQL   │   │ Mounted volume│
              │ (single DB)  │   │ (assets)      │
              └──────────────┘   └───────────────┘
                         │
                   ┌─────▼──────┐
                   │ SMTP relay │
                   └────────────┘
```

One deployable application. Stateless processes — no in-process session store,
no in-process cache holding personal data — so horizontal scaling is a
configuration change (P-08).

**Object storage is out of v1, and this diagram previously implied otherwise.**
The template's `blob-storage.ts` supports only `"local"` and throws on anything
else; there is no S3 client in `package.json`. Assets live on a mounted
filesystem path and are captured inside the encrypted backup archive
(`07-operations.md` §2, `14-…` §3.1). Scoping S3 out is not just honesty about
the code: a scheduled push to a bucket would be an exfiltration channel holding
children's data with none of D-042's controls, plus a set of long-lived
credentials in the settings store. Less code, fewer secrets, one fewer thing to
get wrong.

## 2. Technology stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere | Team stack; one language across app, tests, tooling |
| Framework | Next.js App Router on Node | Inherited; Server Components + Route Handlers give one codebase for site, portal and API |
| Database | PostgreSQL, one per instance | Inherited (ADR-002). Relational domain, strong constraints, mature |
| ORM | Prisma, single ORM | Inherited (ADR-005). Migrations, typed client |
| Auth | Better Auth (+ passkeys, MFA, Entra) | Inherited (ADR-003). Identity/sessions only |
| Styling | Bootstrap + CSS custom properties | Inherited; token-driven theming (D-019) |
| i18n | next-intl, cookie-based locale | Inherited (ADR-006). NL default |
| Validation | Zod | **To be added.** This row previously read "already present in both repos". It is in neither — no `zod` in `package.json`, no imports, no `src/lib/validation/`. Cheap, but load-bearing: the settings design and every module's `validation/` folder assume it. Add it in repo hygiene, before any module |
| Logging | pino, structured, PII-free | Inherited |
| Testing | Vitest (unit/integration) + Playwright (E2E) | Inherited, already wired in CI |
| Packaging | Docker, Docker Compose | Inherited. Kubernetes explicitly out of scope until needed |
| Rich text | TipTap, sanitised server-side | Inherited |

**Decision D-020 — No message broker, no cache server, no search engine in v1.**
**Reason.** Postgres does queuing (the `maintenance` job table), caching
(Next's own cache) and search (trigram/full-text) adequately at the stated
scale. Each additional service is another thing to secure, back up, monitor and
pay for.
**Trade-off.** Some operations that would be async are synchronous. Revisit
when a measured problem exists, and record it as an ADR.

## 3. Repository structure

**Decision D-021 (revised) — Single repository, single application, **flat
root**.**

**What the earlier version got wrong.** D-021 read: *"`apps/web` layout
retained … the existing SplashTrack repo already uses `apps/web` and the extra
nesting costs nothing."* The first clause is true of the **prototype**; the
second is false of the **template**, which is what we are actually building
from. The template is **flat-root**: `src/`, with `@/*` mapped to `./src/*`.

Adopting `apps/web` therefore does not cost nothing. It means moving the whole
tree and rewriting `tsconfig.json`, **both** vitest project globs,
`playwright.config.ts`, `prisma.config.ts`, the Dockerfile and two compose
files — before a single line of domain code exists, to buy room for a second
artefact nobody has asked for.

**Reason.** One deployable, one version, one CI pipeline. The flat root is what
the foundation already is, and every path in it already works.
**Trade-off.** If a worker or a docs site is ever added, the move happens then,
with a reason. **If the `apps/web` layout is adopted anyway, it must be the
literal first commit** — done once, cleanly, before anything depends on the
paths. Doing it halfway through is the expensive version.

The layout below is stated at the flat root. The `apps/web/` prefix appears in
this design set only where it names the **prototype**'s location on `main`
(`00-overview.md` §2.2).

```text
SplashTrack/
  src/
    app/
      (public)/              course catalogue + inquiry form (R-12, reduced)
      (portal)/              authenticated portal
        admin/               administration
    modules/
      identity/  access-control/  organization/  audit/  consent/
      profile-fields/  users/  email-templates/  notifications/  maintenance/
      people/  students/  groups/  courses/  skills/
      sessions/  attendance/  assessment/  exams/  planning/  fees/
        ├ application/       services — the business logic
        ├ domain/            types, invariants
        ├ infrastructure/    repositories + the module's Prisma client (§3.1)
        ├ ui/                module-owned components
        ├ validation/        Zod schemas
        ├ permissions/       permission definitions
        └ tests/
    components/              layout · forms · navigation · feedback
    lib/                     auth · api · crypto · database · errors · logging · security · validation
  prisma/
    schema.prisma
    migrations/
  tests/
    unit/                    incl. migration-safety, migration-history-append-only
    integration/
    e2e/
  messages/                  nl.json · en.json
  docs/
    design/                  this design set
    decisions/               ADRs
    architecture.md          authoritative living spec
    security.md  privacy.md  database.md  ci-cd.md
  infra/
    docker/
    environments/
      dev/  prd/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    pull_request_template.md
  AGENTS.md                  instructions for Lucky
  CLAUDE.md                  ditto, Claude Code entry point
```

Three things are absent from this tree that earlier drafts had: `app/api/v1/`
and `openapi/` (P-01 is out of v1, §4), `pages/` and `api-credentials/` as
active modules (the CMS is reduced and the API surface is unbuilt), and
`environments/uat/` (§3.5.1 of `00-overview.md`). `assessment/` and `fees/` are
new (R-30, R-32).

### 3.1 Module isolation is enforced, not just documented

An ESLint `no-restricted-imports` rule forbids importing
`modules/<a>/…` from `modules/<b>/…` except through a module's published
`index.ts`. This turns the dependency rule (`01-domain-model.md` §1.2) from a
convention into a build failure.

**That rule does not catch the violation it was written to prevent, and this is
worth being blunt about.** The boundary this design cares most about is
ownership of a *table* — D-057 exists because "one table, two owners" would have
been the first boundary to erode. But `no-restricted-imports` catches
cross-module **imports**, and the actual violation looks like this:

```ts
// inside modules/planning/… — imports nothing from modules/sessions/
await prisma.scheduledSession.create({ data: … })
```

No cross-module import, no lint error, boundary gone. The rule is checking the
wrong noun.

**Fix — a per-module Prisma client wrapper.** Each module's
`infrastructure/` exports a client narrowed to the models that module owns, and
a second lint rule forbids importing the root `prisma` client anywhere under
`modules/`. `planning` then physically cannot reach `scheduledSession`; it calls
`sessions`' published service, which is what D-057 says. A blunt-instrument
alternative — a rule banning `prisma.<model>` identifiers outside their owning
module — is worse but still better than nothing, and can ship first.

## 4. API architecture

**There is no public API surface in v1.** `/api/v1`, the generated OpenAPI
document and the Swagger UI are out of scope (`00-overview.md` §3.5.1). This
section previously conceded that the v1 surface was "health/ready, organisations
(read), and one worked example" — which is not an API, and shipping the
versioning, the document and the browsable UI around it is scaffolding for
integrations nobody has requested.

What is kept is the **discipline**, which is the whole of P-01's preparation and
costs nothing:

- Route handlers stay thin: authenticate → validate → authorize → service →
  standardized response. The portal (Server Actions/Components) and any future
  API call **the same services**, so they cannot diverge in behaviour or
  security. This is the property that makes adding the API later additive.
- `/api/health` and `/api/ready` ship (they are operational endpoints, not a
  product API).
- `error.code` is a stable machine-readable field from the first handler.
- Scoped `ApiCredential`s are inherited from the template and stay in place,
  unused. When an integration exists, it authenticates with one — never with a
  user's session token.

## 5. Data access rules

1. Single-resource reads and all writes go through
   `requirePermission(perm, resourceRef)`; list queries take a `Reach` object
   from `resolveReach()` as a **required** repository argument (D-030, D-031).
2. `$queryRaw` / `$executeRaw` bypass reach filtering; they require an explicit
   reviewer sign-off and are flagged by a lint rule.
3. Repositories live in `modules/<m>/infrastructure/`; no module queries another
   module's tables.
4. Migrations are forward-only, reviewed, and tested against a **populated**
   database in CI (the template already does this — it is one of its best
   features and must be kept).
5. Every migration that touches personal data states its retention and erasure
   impact in the PR description.
6. **Every migration that touches an encrypted column states which case it is.**
   The D-096 envelope's AAD binds `(columnId, primary key, keyId)`. A rename is
   safe by construction — `columnId` is a stable registry identifier, never the
   physical name (D-167) — but a migration that **changes a row's primary key,
   splits a table, or moves an encrypted value into another row must decrypt
   with the old `(columnId, pk)` and re-encrypt with the new one inside the same
   migration**. Getting this wrong is silent, unrecoverable data loss that
   reports itself as corruption. The rule is stated once, in
   `13-configuration-and-setup.md` §5.1.1.
7. **One audit event per aggregate write, not per row.** The template's
   `AuditEvent` is a tamper-evident hash chain whose appends serialize on a
   **Postgres advisory lock**. The domain model requires one transaction per
   group registration; at 30 students that is 30 attendance events and, naively,
   30 chained audit rows taken one at a time against a lock contended by every
   other audit writer in the instance. So: **write one audit event for the group
   registration**, or batch the chain append. This must be decided before the
   load test is written — the p95 target in `00-overview.md` §4.1 was set
   without knowing the lock exists.

### 5.1 Two template capabilities to adopt, not re-invent

The design describes both of these as things to build. They already exist,
tested, and adopting them is free:

| Capability | What it already does | What the design said |
|---|---|---|
| `tests/unit/migration-safety.test.ts` | Blocks the unsafe `ADD COLUMN … NOT NULL` without a default | Nothing. This is exactly the class of migration that strands a self-hoster mid-upgrade, and it is already gated |
| `person-reference-classification.ts` + `person-reference-sync.test.ts` | **Is** D-014's *"registry with a test asserting every `Person`-referencing table appears in it"* — already built, and checked **bidirectionally** | Described it as something to create |

The second one has a consequence worth stating as a rule rather than a
surprise: **the build goes red the moment a domain model adds a `Person`
reference without a registry entry.** That is the desired forcing function, and
it belongs in the Definition of Done (`06-delivery.md` §4.4) so it is not
discovered in CI by whoever happens to add the column.
