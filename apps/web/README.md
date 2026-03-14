# SplashTrack Web

Nieuwe Next.js-app voor SplashTrack, opgezet naast de bestaande ASP.NET legacy-app.

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

Vereist voor batch 3 auth-foundation:
- `BETTER_AUTH_SECRET` met minimaal 32 tekens
- `DATABASE_URL` en optioneel `DIRECT_URL` voor Prisma
- `APP_BASE_URL` die overeenkomt met de URL van de web-app

## Health
- `GET /api/health`

## Auth foundation
- `GET/POST /api/auth/[...all]` via Better Auth route handler
- `src/lib/auth.ts` bevat de Better Auth basisconfig op Prisma
- `src/lib/auth-session.ts` levert server helpers voor session/current-user
- `src/lib/authz.ts` bevat de minimale server-side RBAC skeleton (rollen, capabilities, auth-context en guards)
- `GET /login` ondersteunt redirect naar protected routes
- `GET /dashboard` is een protected shell voor ingelogde users met actieve membership
- `GET /forbidden` handelt insufficient access netjes af

## Seed foundation
- Prisma seed is idempotent en maakt/actualiseert `demo-org` plus drie basisaccounts: owner, admin en member.
- De seed koppelt elke demo-user aan de demo-organization met de juiste membership-role.
- Voor Better Auth email/password wordt ook een credential-account met wachtwoordhash aangemaakt, zodat lokaal inloggen testbaar is.
- Demo accounts:
  - `demo.owner@splashtrack.local` / `DemoOwner123!`
  - `demo.admin@splashtrack.local` / `DemoAdmin123!`
  - `demo.member@splashtrack.local` / `DemoMember123!`
- Alleen bedoeld voor lokale/dev/demo-omgevingen.

## Minimale testbasis
- `npm run test --workspace @splashtrack/web` draait kleine foundation-tests op Node's ingebouwde test-runner.
- Tests focussen bewust op seed- en RBAC-basislogica, niet op businessfeatures of uitgebreide E2E-flows.
- `npm run check --workspace @splashtrack/web` bundelt lint, typecheck, tests en build.

Let op: deze batch levert bewust alleen een kleine technische RBAC- en seed-basis op. Geen adminfeatures, geen businessflows en geen uitgebreide policy engine.
