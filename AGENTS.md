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
