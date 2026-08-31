# Contributing to SplashTrack

Thanks for considering a contribution. SplashTrack is swim-school software that
holds personal and health data about children, so some rules below are stricter
than you may be used to. They exist for that reason, not as ceremony.

## Licence

SplashTrack is licensed under the **GNU Affero General Public License v3.0**
(`LICENSE`).

AGPL rather than plain GPL is deliberate: SplashTrack is normally *run as a
network service* rather than distributed as binaries, and GPL copyleft is
triggered by distribution. Under AGPL §13, anyone who runs a modified version
and lets others use it over a network must offer those users the modified
source. If you host a fork for third parties, that obligation applies to you.

By contributing, you agree your contribution is licensed under AGPL-3.0.

## Developer Certificate of Origin (DCO)

Every commit must carry a `Signed-off-by:` line:

```
Signed-off-by: Your Name <your.email@example.com>
```

`git commit -s` adds it for you. Use a real name and a reachable address.

Signing off certifies the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that
you wrote the contribution or have the right to submit it under this project's
licence, and that the contribution and sign-off are public and permanent.

This is not paperwork for its own sake. A project's licence can only be changed
with every copyright holder's agreement, and contributors become unreachable
over time. A verifiable record of who contributed what, under which terms, is
the only thing that keeps that question answerable years later.

## Workflow

1. Review the repository README, `docs/design/`, and active task context.
2. Create focused changes that follow existing patterns.
3. Avoid unrelated refactors in feature or bugfix work.
4. Run the smallest meaningful validation before handoff.
5. Document notable changes, decisions, or follow-up tasks where appropriate.

## Expectations

- Keep changes readable and maintainable.
- Prefer existing dependencies and project utilities over introducing new ones.
- Preserve authentication, authorization, RBAC, audit logging, and data
  protection behaviour.

## Security-relevant changes

Any change touching authentication, authorization and scoping, encryption,
backup and restore, migrations, audit logging, consent, retention or erasure
requires maintainer review regardless of author — maintainers included. These
are the areas where a subtle mistake is invisible in review and expensive in
production.

**Do not open a public issue for a suspected vulnerability.** Contact the
maintainer privately.

## Never commit secrets

No credential, token, connection string or key belongs in this repository, in
any branch, at any time. A secret committed to a public repository must be
treated as disclosed; rewriting history does not reach forks or existing clones.

- Use `.env.local`. Both `.env` and `.env.local` are git-ignored.
- `.env.example` holds **placeholder** values only.
- If secret scanning or push protection stops you: rotate the secret first, fix
  the commit second. In that order.

## Personal data in issues and pull requests

Issues, screenshots and logs from a running instance can contain children's
names, medical notes and guardian details. Redact before pasting. Maintainers
will edit or remove anything that slips through, and may delete an issue
outright rather than leave personal data in a public thread.

## Before you open a pull request

- Tests pass: `npm test`, `npm run lint`, `npm run typecheck`.
- New behaviour has tests. Modules with scoped access carry scope-escape tests
  (D-032) — a module without them does not meet the Definition of Done.
- Migrations are forward-only and additive. Never edit an applied migration and
  never squash a migration chain within a major version (D-048): someone,
  somewhere, is restoring a two-year-old backup into your build.
- Documentation is part of the change, not a follow-up.
- Commits are signed off.

## Architecture decisions

Design decisions live in `docs/design/` and are numbered (`D-xxx`). If your
change contradicts one, say so in the pull request and argue the case — these
decisions are meant to be revisited with reasons, not treated as sacred. A
change that silently contradicts a recorded decision will be sent back.
