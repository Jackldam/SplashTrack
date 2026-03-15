# SplashTrack architecture

## Current scope

SplashTrack is currently a single Next.js application in `apps/web`.

The repo contains:
- a root npm workspace
- one active web app: `apps/web`
- Docker and local infra support for the web app plus Postgres

## App stack

`apps/web` uses:
- Next.js App Router
- React 19
- TypeScript
- Prisma
- Better Auth
- server-side RBAC helpers around organization membership

## High-level structure

- `apps/web/src/app/` — routes, layouts and route handlers
- `apps/web/src/lib/` — server helpers, auth, RBAC, Prisma access, student read-model logic and guarded server actions
- `apps/web/prisma/schema.prisma` — data model
- `apps/web/prisma/seed.ts` — local/demo seed data

## Current functional slices

### 1. Platform foundation
- app shell
- global layout and error boundaries
- health endpoint
- environment/config helpers
- logger/utilities

### 2. Authentication
- Better Auth route handler at `/api/auth/[...all]`
- login flow
- session helpers for server-side access

### 3. Authorization and organization context
- auth context builder
- capability-based guards
- single-organization membership model
- protected dashboard routes
- organization admin shell with guarded membership actions and audit logging

### 4. Student management foundation
- first student overview for the active organization
- summary metrics and level spread
- server-side student directory filtering/search within the active organization
- student detail page
- guarded create/update flows for OWNER/ADMIN with audit logging
- guarded deactivate/reactivate lifecycle action via `isActive`
- explicit phase-1 delete policy: no hard delete, only deactivate/reactivate archival semantics
- student uniqueness is enforced per organization through a normalized identity key (name + date of birth when available, otherwise name-only fallback), and the duplicate guard also applies to inactive records
- no attendance, enrollment or group assignment flows yet

## Architectural boundaries

- Prefer server-side reads and authorization checks first
- Keep auth and RBAC decisions centralized in `src/lib/auth*` and `src/lib/authz*`
- Keep Prisma access in focused lib modules instead of scattering queries through pages
- Build new business slices incrementally on top of the existing organization-aware auth foundation
- Avoid introducing parallel architectures or extra frameworks unless there is a clear need

## Development workflow

From repo root:
- `npm run dev:web`
- `npm run lint:web`
- `npm run typecheck:web`
- `npm run test:web`
- `npm run check:web`

## Immediate next direction

The current codebase is ready for the next business slice on top of the authenticated dashboard, most likely:
- richer student management
- groups/levels management
- attendance tracking
- instructor scheduling
