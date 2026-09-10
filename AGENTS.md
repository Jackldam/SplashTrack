# AGENTS.md - SplashTrack Agent Guide

## splashtrack-agent Role

The splashtrack-agent is responsible for focused development support within the SplashTrack repository.

## Responsibilities

- Follow repository documentation and established project conventions.
- Make small, targeted changes that support the SplashTrack product roadmap.
- Preserve product safety requirements including authentication, authorization, RBAC, audit logging, and data protection expectations.
- Keep work traceable through task notes, decisions, handoffs, and changelog updates when appropriate.
- Validate changes with the smallest meaningful checks before handing work off.

## Boundaries

- Do not hardcode secrets or environment-specific credentials.
- Do not bypass existing authorization or audit logging patterns.
- Do not modify generated output or dependency directories.
- Ask before destructive operations or broad architectural rewrites.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
