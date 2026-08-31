# 05 — High-level Technical Architecture

## 1. Architecture overview

```text
  ONE INSTANCE = ONE ORGANISATION (see 03-deployment-model.md)

                     ┌──────────────────────────────┐
  Browser / tablet ──▶│ Reverse proxy (TLS)          │
  API consumer     ──▶│  rate limit · security hdrs  │
                     └──────────────┬───────────────┘
                                    │
                     ┌──────────────▼───────────────┐
                     │ Next.js (App Router, Node)   │
                     │  middleware: session + scope  │
                     │   ├ (public)  public site     │
                     │   ├ (portal)  portal + admin  │
                     │   └ /api/v1   external API    │
                     │  modules/ (domain services)   │
                     │  lib/ auth · security · db    │
                     └───┬──────────────┬───────────┘
                         │              │
              ┌──────────▼───┐   ┌──────▼────────┐
              │ PostgreSQL   │   │ Object storage│
              │ (single DB)  │   │ (assets)      │
              └──────────────┘   └───────────────┘
                         │
                   ┌─────▼──────┐
                   │ SMTP relay │
                   └────────────┘
```

One deployable application. Stateless processes — no in-process session store,
no in-process cache holding tenant data — so horizontal scaling is a
configuration change (P-08).

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
| Validation | Zod | Already present in both repos |
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

**Decision D-021 — Single repository, single application, `apps/web` layout
retained.**
**Reason.** One deployable, one version, one CI pipeline; the existing
SplashTrack repo already uses `apps/web` and the extra nesting costs nothing
while leaving room for a second artefact (a worker, a docs site) later without
restructuring.
**Trade-off.** Slight indirection versus a flat root. Negligible.

```text
SplashTrack/
  apps/
    web/
      src/
        app/
          (public)/            public website per organisation
          (portal)/            authenticated portal
            admin/             org administration
          api/
            v1/                external API (prepared, minimal in v1)
        modules/
          identity/  access-control/  organizations/  audit/  consent/
          pages/  profile-fields/  users/  api-credentials/
          email-templates/  notifications/  maintenance/
          people/  students/  groups/  courses/  skills/
          attendance/  exams/  planning/
            ├ application/     services — the business logic
            ├ domain/          types, invariants
            ├ infrastructure/  repositories
            ├ ui/              module-owned components
            ├ validation/      Zod schemas
            ├ permissions/     permission definitions
            └ tests/
        components/            layout · forms · navigation · feedback
        lib/                   auth · api · database · errors · logging · security · validation
        openapi/
      prisma/
        schema.prisma
        migrations/
      tests/
        integration/
        e2e/
      messages/                nl.json · en.json
  docs/
    design/                    this design set
    decisions/                 ADRs
    architecture.md            authoritative living spec
    security.md  privacy.md  database.md  api.md  ci-cd.md
  infra/
    docker/
    environments/
      dev/  uat/  prd/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    pull_request_template.md
  AGENTS.md                    instructions for Lucky
  CLAUDE.md                    ditto, Claude Code entry point
```

### 3.1 Module isolation is enforced, not just documented

An ESLint `no-restricted-imports` rule forbids importing
`modules/<a>/…` from `modules/<b>/…` except through a module's published
`index.ts`. This turns the dependency rule (`01-domain-model.md` §1.2) from a
convention into a build failure.

## 4. API architecture

- Route handlers stay thin: authenticate → validate → authorize → service →
  standardized response. The portal (Server Actions/Components) and the API
  call **the same services**, so they cannot diverge in behaviour or security.
- `/api/v1/*` is versioned from the first endpoint; responses are not
  localized, and `error.code` is the stable machine-readable contract.
- Machine access uses scoped `ApiCredential`s (inherited, ADR-020) with their
  own role assignments — never a user's session token.
- OpenAPI spec is generated and served; the template already ships the
  Swagger surface.

**v1 API scope is deliberately minimal:** health/ready, organisations (read),
and one worked example. Endpoints are added when an integration actually needs
them (P-01), not speculatively.

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
