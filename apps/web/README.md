# SplashTrack Web

Actieve Next.js-app voor SplashTrack.

## Scripts
- `npm run dev --workspace @splashtrack/web`
- `npm run build --workspace @splashtrack/web`
- `npm run lint --workspace @splashtrack/web`
- `npm run typecheck --workspace @splashtrack/web`
- `npm run test --workspace @splashtrack/web`
- `npm run check --workspace @splashtrack/web`
- `npm run e2e --workspace @splashtrack/web`
- `npm run e2e:ui --workspace @splashtrack/web`
- `npm run prisma:seed --workspace @splashtrack/web`

## Environment
Kopieer `.env.example` naar `.env.local` voor lokaal gebruik.

Vereist voor de huidige auth foundation:
- `BETTER_AUTH_SECRET` met minimaal 32 tekens
- `DATABASE_URL` en optioneel `DIRECT_URL` voor Prisma
- `APP_BASE_URL` die overeenkomt met de primaire URL van de web-app
- `AUTH_TRUSTED_ORIGINS` optioneel als comma-separated lijst met extra browser-origins voor Better Auth. `APP_BASE_URL`, `http://localhost:3000` en `http://127.0.0.1:3000` worden altijd vertrouwd. Voor Jack/mobile dev staat lokaal: `https://splashtrack.jack.ldam.nl,http://10.2.1.13:3000`.

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
- `GET /dashboard/students/[id]` levert detailweergave per student inclusief lifecycle- en auditcontext
- `GET /dashboard/students/new` en `GET /dashboard/students/[id]/edit` bieden guarded create/update flows voor OWNER/ADMIN
- `POST` server actions vanaf studentdetail ondersteunen deactiveren/heractiveren met audit logging
- hard delete voor studenten is in fase 1 expliciet uitgeschakeld; deactiveren/heractiveren is het ondersteunde lifecycle-pad
- student uniqueness gebruikt een genormaliseerde identity key per organization: naam + geboortedatum wanneer bekend, anders naam-only fallback; deze guard blijft ook gelden voor inactieve records
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

## Mobile/dev auth smoke

Voor de huidige Jack/mobile testomgeving gebruikt `apps/web/.env`:
- `APP_BASE_URL=http://10.2.1.13:3000`
- `AUTH_TRUSTED_ORIGINS=https://splashtrack.jack.ldam.nl,http://10.2.1.13:3000`

Na `npm run prisma:seed --workspace @splashtrack/web` kan de owner-login met `demo.owner@splashtrack.local` / `DemoOwner123!` via beide origins worden getest.

## Tests
- `npm run test --workspace @splashtrack/web` draait kleine foundation-tests op Node's ingebouwde test-runner.
- Tests focussen op seed-, RBAC-, organization-admin- en student-directory basislogica.
- `npm run e2e --workspace @splashtrack/web` draait Playwright browser-tests. De suite start de Next dev-server op `http://127.0.0.1:3100`, seedt de demo-accounts en gebruikt standaard een geïsoleerd vertaalbestand onder `apps/web/e2e/.tmp/custom-translations.json`.
- De GUI-regressiesuite dekt publieke home/login/language UI, dashboardnavigatie, student CRUD/lifecycle, groepsbeheer inclusief inschrijven/uitschrijven, organization user admin en member RBAC. Testdata gebruikt de `E2E GUI`/`@e2e.splashtrack.local` markers en wordt rond de suite opgeruimd.
- Voor CI/lokaal eerste gebruik: `npx playwright install --with-deps chromium` (of zonder `--with-deps` wanneer OS-packages al aanwezig zijn).
- Volledige lokale QA-volgorde: `npm run lint --workspace @splashtrack/web && npm run typecheck --workspace @splashtrack/web && npm run test --workspace @splashtrack/web && npm run build --workspace @splashtrack/web && npm run e2e --workspace @splashtrack/web`.
- `npm run check --workspace @splashtrack/web` bundelt lint, typecheck, tests en build; Playwright e2e draait apart zodat browser/OS-dependencies expliciet blijven.
