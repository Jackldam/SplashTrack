# SplashTrack Web

Actieve Next.js-app voor SplashTrack.

## Scripts
- `npm run dev --workspace @splashtrack/web`
- `npm run build --workspace @splashtrack/web`
- `npm run lint --workspace @splashtrack/web`
- `npm run typecheck --workspace @splashtrack/web`
- `npm run test --workspace @splashtrack/web`
- `npm run check --workspace @splashtrack/web`
- `npm run prisma:seed --workspace @splashtrack/web`

## Environment
Kopieer `.env.example` naar `.env.local` voor lokaal gebruik.

Vereist voor de huidige auth foundation:
- `BETTER_AUTH_SECRET` met minimaal 32 tekens
- `DATABASE_URL` en optioneel `DIRECT_URL` voor Prisma
- `APP_BASE_URL` die overeenkomt met de URL van de web-app

## Health
- `GET /api/health`

## Current foundation
- `GET/POST /api/auth/[...all]` via Better Auth route handler
- `src/lib/auth.ts` bevat de Better Auth basisconfig op Prisma
- `src/lib/auth-session.ts` levert server helpers voor session/current-user
- `src/lib/authz.ts` bevat de minimale server-side RBAC skeleton
- `src/lib/organization-admin.ts` bundelt de kleine single-org admin-querylaag
- `src/lib/organization-admin-actions.ts` voert server-side membership mutaties uit met guardrails en audit logging
- `GET /login` ondersteunt redirect naar protected routes
- `GET /dashboard` is een protected shell voor ingelogde users met actieve membership
- `GET /dashboard/organization` is een server-side afgeschermde owner/admin shell
- `GET /dashboard/students` levert de eerste organization-gebonden student directory
- `GET /dashboard/students/[id]` levert een read-only detailweergave per student
- `GET /dashboard/students/new` en `GET /dashboard/students/[id]/edit` bieden guarded create/update flows voor OWNER/ADMIN
- `POST` server actions vanaf studentdetail ondersteunen deactiveren/heractiveren met audit logging
- student uniqueness gebruikt een genormaliseerde identity key per organization: naam + geboortedatum wanneer bekend, anders naam-only fallback
- `GET /forbidden` handelt insufficient access netjes af

## Seed foundation
- Prisma seed is idempotent en maakt/actualiseert `demo-org` plus drie basisaccounts: owner, admin en member.
- De seed koppelt elke demo-user aan de demo-organization met de juiste membership-role.
- Voor Better Auth email/password wordt ook een credential-account met wachtwoordhash aangemaakt, zodat lokaal inloggen testbaar is.
- De seed voegt ook een kleine set demo-studenten toe voor de eerste business read-model slice.
- Demo accounts:
  - `demo.owner@splashtrack.local` / `DemoOwner123!`
  - `demo.admin@splashtrack.local` / `DemoAdmin123!`
  - `demo.member@splashtrack.local` / `DemoMember123!`
- Alleen bedoeld voor lokale/dev/demo-omgevingen.

## Tests
- `npm run test --workspace @splashtrack/web` draait kleine foundation-tests op Node's ingebouwde test-runner.
- Tests focussen op seed-, RBAC-, organization-admin- en student-directory basislogica.
- `npm run check --workspace @splashtrack/web` bundelt lint, typecheck, tests en build.
