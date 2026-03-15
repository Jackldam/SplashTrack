# GitHub Copilot instructions for SplashTrack

SplashTrack is a single modern web app repo.

- `apps/web/` — the active product app built with Next.js App Router, React 19, TypeScript, Prisma and Better Auth

Assume all product work targets `apps/web/` unless the user explicitly says otherwise.

## Repo-specific rules

- Prefer minimal, targeted changes over broad refactors
- Preserve existing naming and structure in the area you touch
- Avoid introducing new dependencies unless they are clearly justified
- Never hardcode secrets, connection strings or environment-specific values
- Do not propose or recreate legacy MVC/.NET codepaths that were removed from this repo

## Working in `apps/web`

Use the existing stack and conventions already present in the repo:

- Next.js App Router
- TypeScript with strict typing
- Path alias `@/*` for `apps/web/src/*`
- Prisma for data access
- Better Auth for authentication
- ESLint is configured; keep code lint-clean and type-safe

When editing the app:

- Prefer server-first patterns consistent with the existing app structure
- Place app routes under `src/app/`
- Place shared utilities and server-side helpers under `src/lib/`
- Reuse existing auth, organization and student-directory helpers before adding new abstractions
- Follow current patterns around RBAC, membership checks and audit logging
- Keep components and handlers focused; avoid overengineering
- Match the existing style of small tests under `src/**/*.test.ts` when adding logic-heavy code

Useful commands from repo root:

- `npm run dev:web`
- `npm run lint:web`
- `npm run typecheck:web`
- `npm run test:web`
- `npm run check:web`

## Output expectations

When generating or editing code:

- Reference concrete files you plan to change
- Prefer complete, compilable snippets over pseudo-code
- Include brief validation steps when useful
- Keep proposals aligned with the current Next.js + Prisma + Better Auth foundation

## What not to do

- Do not scan or edit `node_modules/`
- Do not treat generated build output such as `.next/` as source files
- Do not make speculative architecture changes not implied by the repo
- Do not reintroduce removed legacy stacks unless the user explicitly asks for it
