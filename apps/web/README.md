# SplashTrack Web

Nieuwe Next.js-app voor SplashTrack, opgezet naast de bestaande ASP.NET legacy-app.

## Scripts
- `npm run dev --workspace @splashtrack/web`
- `npm run build --workspace @splashtrack/web`
- `npm run lint --workspace @splashtrack/web`
- `npm run typecheck --workspace @splashtrack/web`

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

Let op: deze batch levert bewust alleen een kleine technische RBAC-basis op. Geen adminfeatures, geen businessflows en geen uitgebreide policy engine.
