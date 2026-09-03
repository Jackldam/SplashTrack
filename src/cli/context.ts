/**
 * What every command is handed: parsed flags, and the two output channels.
 *
 * `log` writes to **stderr**, not stdout. That is deliberate and it is the
 * property the entrypoint depends on: `boot:state` prints ONE machine-readable
 * token on stdout and everything a human reads on stderr, so
 * `state=$(splashtrack boot:state)` is exact and the operator still sees the
 * explanation. Commands that produce no machine output use the same channel, so
 * there is one rule rather than a per-command convention.
 */

import { createRequire } from "node:module";

export interface CommandContext {
  /** `--key=value` and `--key value`, both forms, keyed without the dashes. */
  flags: Record<string, string>;
  /** Bare positional arguments, in order. */
  positionals: string[];
  /** Human-facing output. Goes to stderr — see the file header. */
  log: (line: string) => void;
  /** Human-facing errors. Goes to stderr. */
  error: (line: string) => void;
  /** Machine-readable output. Goes to stdout. Used by `boot:state` only. */
  emit: (line: string) => void;
}

/**
 * The application version, read from `package.json`. Recorded on the bootstrap
 * record and reported by `boot:state`; never a gate — the gate that refuses to
 * start against a newer schema is `AHEAD`, decided from `_prisma_migrations`.
 */
export const APP_VERSION: string = readVersion();

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require(
      process.env.SPLASHTRACK_PACKAGE_JSON ??
        `${process.cwd()}/package.json`,
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Parses `--flag value`, `--flag=value` and bare positionals. */
export function parseArgs(argv: string[]): {
  flags: Record<string, string>;
  positionals: string[];
} {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const body = argument.slice(2);
    const equals = body.indexOf("=");
    if (equals >= 0) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      index += 1;
    } else {
      flags[body] = "true";
    }
  }

  return { flags, positionals };
}
