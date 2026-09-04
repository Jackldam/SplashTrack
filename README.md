# SplashTrack

A self-hosted student-tracking system for swimming schools: who is in which
group, what they can already do, what they still need for the next diploma, and
who was in the water on Saturday morning. AGPL-3.0.

One application at the root of this repository (Next.js, TypeScript, Prisma,
PostgreSQL), shipped as one Docker image with PostgreSQL as a second service.
There is no `apps/` workspace and no separate frontend.

**This is a foundation, not a product yet.** What exists today is the people
register, the authorization model, the audit trail, first-run setup and the
deployment path. Groups, lessons, attendance, skills and exams are designed
(`docs/design/`) and not built.

---

## Running an instance

Everything below is the whole of a first install. It needs `docker` with the
Compose plugin and nothing else — no Node, no `psql`, no PostgreSQL knowledge.
Each step prints what to do next, and any step can be repeated.

### 1. Configuration

```sh
cp .env.example .env
```

Then edit `.env`. Every variable in it is documented in place, and none has a
default — a default credential is one misconfiguration away from being the whole
authentication story. You choose three passwords and one public address:

| Variable                          | What it is                                        |
| --------------------------------- | ------------------------------------------------- |
| `POSTGRES_PASSWORD`               | the provisioning superuser, used once at init      |
| `SPLASHTRACK_APP_PASSWORD`        | the runtime database role                          |
| `SPLASHTRACK_RETENTION_PASSWORD`  | the retention/migration role                       |
| `DATABASE_URL`                    | carries `SPLASHTRACK_APP_PASSWORD`                 |
| `DATABASE_MAINTENANCE_URL`        | carries `SPLASHTRACK_RETENTION_PASSWORD`           |
| `BETTER_AUTH_URL`                 | the address people will actually type              |

`BETTER_AUTH_URL` is worth a moment: cookie origins, redirects and the WebAuthn
relying-party id all come from it, and changing its host later invalidates every
enrolled passkey at once.

The three database roles are created for you when the PostgreSQL volume is first
initialised. Nothing to run by hand. Why there are three, and why the web
process is not a superuser, is `docs/adr/0002-database-roles-and-least-privilege.md`.

### 2. The bootstrap secret

```sh
docker compose run --rm secret-init
```

This writes `./secrets/secret_key` and refuses to overwrite one. It is the root
of every key the application uses — encrypted columns, TOTP secrets, the audit
checkpoint MAC — so **keep a copy with your backups**. Nothing can regenerate
it, and a backup archive cannot be restored without it.

The application deliberately will not generate this for you at start-up: a key
generated at start is a key that changes on the next start, and everything
written under the old one becomes permanently unreadable.

### 3. Start

```sh
docker compose up -d
docker compose logs -f app
```

On an empty database nothing is migrated. The container detects that the
database has no purpose yet, enters **setup mode**, serves a notice at
`BETTER_AUTH_URL`, and tells you what to run next. That refusal to migrate a
database it does not understand is deliberate: an empty database is either a
fresh install or the first minute of a restore, and only you know which.

### 4. The first administrator

```sh
docker compose exec app splashtrack admin:create \
    --email you@example.org --name 'Your Name'
```

It asks for a password twice, without echoing it, and creates the account. There
is no public self-registration — host access is the proof of ownership every
privileged operation here rests on.

`setup:init` (migrations and seed, without an account) exists if you would rather
look at the database first, but it is optional: `admin:create` does that work
itself when it has not been done.

**The running container does not need restarting.** It re-reads how far setup
has got on every request, so the page it serves changes on its own. Its start-up
log is now out of date, which is expected. The command prints the resulting boot
state so you never have to guess — and restarting is safe at every point.

### 5. Finish in a browser

Open `BETTER_AUTH_URL/sign-in` and sign in with the password you just chose. You
land straight on a page showing a QR code for your authenticator; scan it, enter
the six digits, and the installation is set up.

Setup is not complete until then, and that is enforced rather than displayed:
until a second factor is verified the account may do exactly two things, sign in
and enrol, and every other page, route and action refuses it. The TOTP secret is
shown on that page and nowhere else — not in a log, not in a file, not on a
terminal.

You are then signed in, on a working instance, with the people register at
`/people`.

### If something refuses to start

The container prints its boot state before it does anything, and every state
carries an instruction:

| State               | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `EMPTY`             | no tables. Setup mode; nothing is migrated.                     |
| `PARTIAL`           | migrated and seeded, no administrator yet. Setup mode.          |
| `PENDING_ENROLMENT` | the administrator exists and has not enrolled. Setup mode.      |
| `EXISTING`          | the schema is behind this image. Migrates forward, then serves. |
| `CURRENT`           | serving.                                                        |
| `AHEAD`             | the schema is newer than this image. Refuses; run the newer one. |
| `FAILED`            | a migration is recorded unfinished. Refuses; see the message.    |
| `TAMPERED`          | data present that no unfinished setup explains. Refuses.        |

`docker compose exec app splashtrack boot:state` asks the same question at any
time.

---

## Working on the code

```sh
npm install
npm run dev            # http://localhost:3000
npm test               # vitest; builds its own _test database
npm run lint
npm run typecheck
npm run format:check
npm run build
```

`npm test` needs a reachable PostgreSQL and the two connection strings in
`.env`; the reference compose stack publishes one on loopback. The suite creates
and drops its own databases and can never act on the development one — the guard
is in `tests/setup/test-db-url.ts`.

| Path                    | What is in it                                             |
| ----------------------- | --------------------------------------------------------- |
| `src/app/`              | routes, pages and Server Actions                           |
| `src/lib/`              | auth, authorization, audit, boot state, database, settings |
| `src/modules/`          | domain modules (`people` today)                            |
| `src/cli/`              | the `splashtrack` CLI the image ships                      |
| `prisma/schema.prisma`  | the data model, with the reasoning in doc comments         |
| `docs/design/`          | the architecture and its decision register                 |
| `docs/adr/`             | architecture decision records                              |
| `docs/build/`           | what each build phase actually did                         |
| `infra/`                | database role provisioning                                 |

`CLAUDE.md` and `CONTRIBUTING.md` carry the rules this codebase is written to.
`docs/design/09-decision-register.md` is where a decision and its reasoning live;
if the code and the register disagree, one of them is a bug and the register
says which.
