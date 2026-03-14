# SplashTrack

SplashTrack bevat op dit moment twee sporen naast elkaar:

- `SplashTrackWebApp/` — bestaande legacy ASP.NET Core MVC-app
- `apps/web/` — nieuwe Next.js + TypeScript foundation voor de toekomstige frontend

Deze branch bevat de foundation-batches voor de nieuwe web-stack. Er zijn bewust geen businessfeatures of inhoudelijke legacy-wijzigingen meegenomen; alleen de nieuwe web/auth-basis en repo-root ondersteuning daaromheen.

## Nieuwe web foundation

### Structuur
- `package.json` — root npm workspace voor de web-app
- `apps/web/` — Next.js app router project
- `apps/web/src/app/` — layout, homepage, error/not-found, `api/health`, login, dashboard en organization shell
- `apps/web/src/lib/` — basis `env`, `logger`, `utils`, Prisma client wrapper, auth-context helpers en kleine organization admin-querylaag met server-side membership mutations
- `apps/web/prisma/schema.prisma` — Prisma foundation met alleen `User`, `Organization`, `OrganizationMember` en `AuditLog`
- `apps/web/prisma/seed.ts` — idempotente demo seed voor auth/org foundation
- `apps/web/.env.example` — voorbeeldvariabelen inclusief `DATABASE_URL` en `DIRECT_URL`
- `apps/web/Dockerfile` — container build voor de web-app
- `docker-compose.yml` — web + postgres voor lokale infra

### Web scripts
Vanaf repository-root:
- `npm install`
- `npm run dev:web`
- `npm run build:web`
- `npm run lint:web`
- `npm run typecheck:web`
- `npm run prisma:generate --workspace @splashtrack/web`
- `npm run prisma:validate --workspace @splashtrack/web`
- `npm run prisma:seed --workspace @splashtrack/web`

## Docker
- `docker compose up --build`
- Web app: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`
- Postgres: `localhost:5432`

## Legacy app
De bestaande .NET oplossing en app blijven intact:
- `SplashTrack.sln`
- `SplashTrackWebApp/`

## Oorspronkelijke projectrichting
- Track student progress and attendance
- Manage instructors and lesson schedules
- Create and manage swim groups and levels
- Generate reports and analytics
- Customizable branding
- Certificate printing
- Certificate requirements & competencies
