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
- `GET /login` is een minimale loginpagina voor de foundation

Let op: deze batch levert bewust geen RBAC, adminfeatures of business-specifieke autorisatie op.
