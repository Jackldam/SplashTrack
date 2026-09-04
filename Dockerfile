# SplashTrack — the application image (D-033).
#
# ONE application image. PostgreSQL is NOT in it: bundling the database would
# trap the data in a container and break every upgrade and backup story, so the
# reference `docker-compose.yml` supplies it as a second service and an operator
# with a managed database repoints DATABASE_URL instead.
#
# The image at the ROOT of the repository, because the repository holds one
# application at its root and not a workspace with `apps/` (D-174).
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT `03-deployment-model.md` §1.2 ASKS OF THIS FILE, AND WHERE EACH IS
#
#   no default credentials, ever ......... no ENV holds a value; the entrypoint
#                                          refuses to start without SECRET_KEY_FILE
#   no secret in any layer ............... nothing is COPYed from ./secrets, and
#                                          .dockerignore excludes it
#   runs as non-root ..................... USER splashtrack (uid 10001), set
#                                          before the entrypoint and never undone
#   multi-stage build .................... four stages; the runner copies build
#                                          OUTPUT, never the toolchain
#   no devDependencies in the final layer  `npm ci --omit=dev` in `prod-deps`.
#                                          MEASURED, NOT ASSUMED — see the note
#                                          below: none of THIS project's
#                                          devDependencies is present, but
#                                          upstream ships some anyway
#   digest-pinned base image ............. node:22-alpine pinned by sha256 below
#   health and readiness endpoints ....... /api/health and /api/ready, already in
#                                          the application; HEALTHCHECK uses ready
#
# NOT DONE HERE, so it is not mistaken for done: a published SBOM and a
# read-only root filesystem. The SBOM is a CI concern and `.github/workflows/`
# is outside this change's write scope (D-025) — the report carries what CI
# needs. A read-only root filesystem needs every writable path enumerated
# (Next's cache, /tmp, the data volume) and proven, which is a change to make
# once with evidence rather than a flag added blind.
#
# ONE PROPERTY IS WEAKER THAN IT READS, and it is measured rather than assumed.
# `npm ci --omit=dev` removes every devDependency THIS project declares, and it
# does. It does not produce a layer free of development tooling, because upstream
# packages declare some as ordinary dependencies: `@prisma/client` and `prisma`
# pull `typescript`, and `better-auth` pulls `vitest`, which pulls `vite`, `tsx`
# and `esbuild`. They are in the final layer, and no flag here removes them —
# the fixes are upstream, or a bundler that traces only what is reached. The
# claim in `03-…` §1.2 is therefore met for our own dependencies and not for the
# tree as a whole; the report says so rather than letting the flag imply it.
#
# `postgresql-client` is deliberately ABSENT. `14-…` §3.1 once claimed the image
# ships it; D-169 settled that `pg_dump`/`pg_restore` is OUT of v1 scope and not
# a fallback, so installing the client would ship the tooling for a mechanism
# this version does not have.
# ─────────────────────────────────────────────────────────────────────────────

# The digest pins the exact image; the tag beside it is for humans. Update both
# together — a bare tag makes "the same image" untrue between two builds, and
# D-022 promotes ONE image DEV → UAT → PROD.
ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

# ── deps ─────────────────────────────────────────────────────────────────────
# Every dependency, devDependencies included, for the build stage only.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# `--ignore-scripts` skips the postinstall `prisma generate`; the build stage
# runs it explicitly against the schema, which is clearer than a hidden hook.
RUN npm ci --ignore-scripts

# ── build ────────────────────────────────────────────────────────────────────
# The Next.js build and the CLI bundle. Nothing from this stage reaches the
# runner except `.next`, `public` and `dist`.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The Prisma client is generated into `src/generated/prisma` (schema
# `generator client.output`), so it must exist before either build step.
#
# `prisma.config.ts` resolves a connection string when the CLI loads it, and it
# loads it for `generate` too. Since ADR-0002 that string is
# DATABASE_MAINTENANCE_URL rather than DATABASE_URL — migrations run as the
# schema owner, not as the runtime role — so the placeholder moved with it.
#
# Both values below are syntactically valid placeholders for connections that
# are never opened: generation reads the schema FILE, not the database. They are
# confined to this RUN and appear in no layer of the runner.
RUN DATABASE_MAINTENANCE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    npx prisma generate

# `next build` runs `instrumentation.ts`? It does not — that runs at SERVER
# start — but Next does evaluate modules during prerendering, and
# `@/lib/auth/auth.ts` derives the Better Auth signing secret at module scope.
# A build-time-only placeholder is supplied here and NEVER shipped: it exists
# for the duration of this RUN and appears in no layer of the runner. The
# entrypoint refuses to start without a real, operator-supplied key.
RUN SECRET_KEY="build-time-placeholder-not-a-secret-0000000000" \
    DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    DATABASE_MAINTENANCE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    BETTER_AUTH_URL="http://localhost:3000" \
    npm run build

RUN npm run build:cli

# ── prod-deps ────────────────────────────────────────────────────────────────
# Runtime dependencies only. `prisma` is among them ON PURPOSE: `migrate deploy`
# is what the boot state machine runs on an EXISTING database, so an image
# without the Prisma CLI could not upgrade itself. It is a runtime need, not a
# build tool, and package.json says so.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --omit=dev --ignore-scripts

# `--ignore-scripts` above also skips `@prisma/engines`'s own postinstall, which
# is what puts the SCHEMA ENGINE binary on disk — and `migrate deploy` needs it.
# Without this, the first migrating start fails at runtime with "Can't write to
# /app/node_modules/@prisma/engines": Prisma tries to fetch the binary as the
# non-root runtime user into a root-owned tree, which is exactly the download
# that must not happen at start-up. Fetch it here, at build time, once.
RUN node node_modules/@prisma/engines/scripts/postinstall.js

# The generated Prisma client is build OUTPUT, not a dependency; it is copied
# from the build stage in the runner rather than regenerated here.

# ── runner ───────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# A dedicated, high-uid account. NOT the `node` user the base image ships: uid
# 1000 collides with the first ordinary user on most hosts, which makes a
# bind-mounted volume's ownership accidental rather than chosen.
RUN addgroup -g 10001 -S splashtrack \
 && adduser  -u 10001 -S splashtrack -G splashtrack

COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build     --chown=root:root /app/.next        ./.next
COPY --from=build     --chown=root:root /app/dist         ./dist
# No `public/` directory yet — the first static asset creates it, and the COPY
# comes back with it. An absent-directory COPY is a build failure, not a no-op.
COPY --chown=root:root messages       ./messages
COPY --chown=root:root prisma         ./prisma
COPY --chown=root:root next.config.ts prisma.config.ts package.json ./
COPY --chown=root:root docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The whole of `infra/`, not one file. `provision-roles.sql` is what an operator
# on an EXISTING volume or a managed database runs by hand (ADR-0002 §7), so
# `docker compose exec app cat infra/provision-roles.sql` has to work — telling
# somebody to fetch a file from GitHub to fix their own instance is a step that
# does not happen at 23:00. `audit-database-role.sql` is the same statements
# `db:apply-grants` applies, written out for a reader who needs to SEE the
# control rather than trust a command.
COPY --chown=root:root infra         ./infra

# `splashtrack` on the PATH, so every command in `13-…` §7 reads exactly as the
# design writes it: `docker compose exec app splashtrack admin:create …`.
RUN printf '#!/bin/sh\nexec node /app/dist/cli.mjs "$@"\n' > /usr/local/bin/splashtrack \
 && chmod 0755 /usr/local/bin/splashtrack /usr/local/bin/docker-entrypoint.sh

# The application tree is owned by root and only READ by the runtime user —
# a compromised process cannot rewrite its own code. `data` is the one
# exception: it is the writable volume, and it is the only thing that is.
RUN mkdir -p /app/data \
 && chown splashtrack:splashtrack /app/data \
 && chmod 0700 /app/data

USER splashtrack
EXPOSE 3000

# Readiness, not liveness: `/api/ready` answers "can this instance serve
# traffic", which is what an orchestrator's health signal is for. The start
# period covers the entrypoint's state detection and any migration.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["serve"]
