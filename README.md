# SplashTrack

SplashTrack is currently a single active web application:

- `apps/web/` — Next.js + TypeScript frontend/app foundation for the product

This repo currently focuses on the modern web stack foundation. The active implementation work is in `apps/web`.

## Current web foundation

### Structure
- `package.json` — root npm workspace for the web app
- `apps/web/` — Next.js app router project
- `apps/web/src/app/` — layout, homepage, error/not-found, `api/health`, login, dashboard, organization shell, plus student directory/detail/create/edit routes
- `apps/web/src/lib/` — basis `env`, `logger`, `utils`, Prisma client wrapper, auth-context helpers, RBAC helpers, organization admin logic, student read-models, lifecycle helpers and student server actions
- `apps/web/prisma/schema.prisma` — Prisma foundation with `User`, `Organization`, `OrganizationMember`, `AuditLog` and `Student` (including normalized student identity keys for per-organization uniqueness)
- `apps/web/prisma/seed.ts` — idempotente demo seed voor auth/org/student foundation
- `apps/web/.env.example` — voorbeeldvariabelen inclusief `DATABASE_URL` en `DIRECT_URL`
- `apps/web/Dockerfile` — container build voor de web-app
- `docker-compose.yml` — web + postgres voor lokale infra
- `docs/architecture.md` — korte architectuuroverzicht van de huidige app

### Web scripts
Vanaf repository-root:
- `npm install`
- `npm run dev:web`
- `npm run build:web`
- `npm run lint:web`
- `npm run typecheck:web`
- `npm run test:web`
- `npm run check:web`
- `npm run prisma:generate --workspace @splashtrack/web`
- `npm run prisma:validate --workspace @splashtrack/web`
- `npm run prisma:seed --workspace @splashtrack/web`

## Docker
- `docker compose up --build`
- Web app: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`
- Postgres: `localhost:5432`

## Current student-management status
- directory + metrics
- student detail
- guarded create/update flows
- deactivate/reactivate lifecycle flow via `isActive`
- audit logging on student mutations

## Current product direction
- Track student progress and attendance
- Manage instructors and lesson schedules
- Create and manage swim groups and levels
- Generate reports and analytics
- Customizable branding
- Certificate printing
- Certificate requirements & competencies
mpetencies
