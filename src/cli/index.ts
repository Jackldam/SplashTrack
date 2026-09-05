/**
 * `splashtrack` — the break-glass CLI (`13-configuration-and-setup.md` §7,
 * D-141).
 *
 * ITS AUTHORITY IS HOST ACCESS. There is no token, no password and no network
 * path into any of these commands: reaching them means being able to run a
 * process inside the container, which is proof of ownership in a way a bearer
 * credential is not. That is what makes this a recovery path from an
 * authentication misconfiguration and not a second, weaker front door — it
 * *"cannot be reached from the internet at all"*.
 *
 * WHAT EVERY INVOCATION OWES: an audit event with a `system:cli` actor, and a
 * banner for every administrator that only somebody else can dismiss. Both are
 * in `./break-glass`, and a command that changes anything privileged calls it
 * BEFORE the change.
 *
 * WHAT NO COMMAND HERE DOES: print a password, a TOTP secret, a backup code or
 * a session token. Since D-185 `admin:create` does not ENROL either — it
 * creates the account and prints the URL where the administrator enrols in a
 * browser. See `./commands/admin.ts`.
 *
 * `secret:init` IS here, and it is the one command that must run with no
 * database and no `SECRET_KEY` — it is what creates the key. That is why every
 * other command is loaded through a dynamic `import()` below: nothing that
 * derives a key or opens a connection at module scope is evaluated unless the
 * command being run needs it, so `secret:init` works on a host where the
 * application cannot yet start.
 */

import { generateBootstrapSecret } from "./commands/secret";
import { parseArgs, type CommandContext } from "./context";

/**
 * `secret:init`, wired here rather than dynamically imported: its whole point is
 * to run on a machine with no key and no database, so it must not sit behind a
 * module graph that needs either.
 */
async function secretInit(ctx: CommandContext): Promise<number> {
  const target = ctx.flags.out ?? ctx.positionals[0];
  if (!target) {
    ctx.error("Usage: splashtrack secret:init --out <path>");
    return 2;
  }

  const result = generateBootstrapSecret(target);
  if (!result.created) {
    ctx.error(result.refusal ?? "Refused.");
    return 1;
  }

  ctx.log(`Wrote a new bootstrap secret to ${result.path} (mode 0600).`);
  ctx.log("Point SECRET_KEY_FILE at that path, and BACK THE FILE UP:");
  ctx.log(
    "losing it means every encrypted value and every TOTP enrolment is gone.",
  );
  return 0;
}

type Command = (ctx: CommandContext) => Promise<number>;

const USAGE = `splashtrack <command> [flags]

  boot:state                      Print the boot state and the action it implies
  setup:token [--new|--ensure]    Issue or report the one-time token that opens
                                  the /setup wizard. NEVER prints the token
  setup:init                      Apply migrations and seed the catalogue
  admin:create --email <e>        BREAK-GLASS, not the front door. Creates an
                 [--name <n>]     ORGANIZATION administrator from the host on an
                                  instance whose /setup wizard cannot be used.
                                  The password is typed at a prompt or piped;
                                  there is no --password-file (D-187)
  admin:reset-mfa --email <e>     Replace a LOST authenticator, and re-enrol
                 [--password-file <p>] [--out <dir>]
  admin:grant-admin --email <e>   Grant ORGANIZATION admin for 24 hours
  bootstrap:clear-tampered [--yes]  Clear D-099's TAMPERED state
  audit:verify [--prune-before <d>] [--reason <r>]
  audit:grants                    Report the D-149 grants that actually exist
  db:apply-grants [--owner <r>]   Put the ADR-0002 role model in force on this
                                  database. Runs after every migration
  secret:init --out <path>        Generate the one bootstrap secret (D-112)

Every command that changes anything writes an audit event with a system:cli
actor and raises a banner for all administrators. None of them prints a
password, a TOTP secret, a backup code or the setup token.

A NEW INSTALLATION IS SET UP IN A BROWSER (D-187). Nothing above is part of it:

    docker compose up -d
    docker compose exec app cat /app/data/setup-token    # the PATH is in the log
    …then open <this instance>/setup, enter that token, name the organisation,
      choose the first administrator's password, and scan the QR code with an
      authenticator. That completes setup and /setup closes permanently.

The commands above are the recovery route for an instance the wizard cannot
finish — a lost password before enrolment, a data volume you cannot read.`;

async function resolve(name: string): Promise<Command | null> {
  switch (name) {
    case "boot:state":
      return (await import("./commands/boot")).bootState;
    case "bootstrap:clear-tampered":
      return (await import("./commands/boot")).bootstrapClearTampered;
    case "setup:init":
      return (await import("./commands/setup")).setupInit;
    case "setup:token":
      return (await import("./commands/setup")).setupToken;
    case "admin:create":
      return (await import("./commands/admin")).adminCreate;
    case "admin:reset-mfa":
      return (await import("./commands/admin")).adminResetMfa;
    case "admin:grant-admin":
      return (await import("./commands/admin")).adminGrantAdmin;
    case "audit:verify":
      return (await import("./commands/audit")).auditVerify;
    case "audit:grants":
      return (await import("./commands/audit")).auditGrants;
    case "db:apply-grants":
      return (await import("./commands/database")).databaseApplyGrants;
    case "secret:init":
      return secretInit;
    default:
      return null;
  }
}

export async function run(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "help") {
    process.stderr.write(`${USAGE}\n`);
    return name ? 0 : 2;
  }

  const command = await resolve(name);
  if (!command) {
    process.stderr.write(`Unknown command: ${name}\n\n${USAGE}\n`);
    return 2;
  }

  const { flags, positionals } = parseArgs(rest);
  const ctx: CommandContext = {
    flags,
    positionals,
    log: (line) => process.stderr.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
    emit: (line) => process.stdout.write(`${line}\n`),
  };

  return command(ctx);
}

async function main(): Promise<void> {
  let code = 2;
  try {
    code = await run(process.argv.slice(2));
  } catch (error) {
    // The message, never the stack, unless the operator asks: a stack from this
    // process can carry a connection string through a driver error.
    process.stderr.write(`\n${(error as Error).message}\n`);
    if (process.env.SPLASHTRACK_CLI_TRACE === "1") {
      process.stderr.write(`${(error as Error).stack ?? ""}\n`);
    }
    code = 1;
  }
  // The Prisma client holds a pool; without this the process hangs after a
  // command that touched the database. Guarded on DATABASE_URL because
  // `secret:init` runs on a host that has none — importing the client there
  // would throw on the way out of a command that succeeded.
  if (process.env.DATABASE_URL) {
    const { prisma } = await import("@/lib/database");
    await prisma.$disconnect().catch(() => undefined);
  }
  process.exit(code);
}

void main();
