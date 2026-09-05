/**
 * Runs the REAL `splashtrack` CLI in a child process, against one throwaway
 * database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A CHILD PROCESS AND NOT AN IN-PROCESS CALL
 *
 * `@/lib/database` resolves `DATABASE_URL` when it is IMPORTED, so calling
 * `setupInit()` in-process would reach the suite's own `_test` database rather
 * than the empty one under test. A child process with its own environment is
 * also simply what the operator types.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH STREAMS ARE CAPTURED
 *
 * Every command in `src/cli` logs to STDERR and reserves stdout for machine
 * output (`boot:state` prints `<STATE> <ACTION>` there). A caller asserting on
 * the operator-facing narrative sees nothing unless both are read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `stdin` IS A HERE-DOC, AND SINCE D-187 THAT IS THE ONLY NON-INTERACTIVE PATH
 *
 * `--password-file` was removed from `admin:create`: a password written to a
 * file is exactly what the `/setup` wizard exists to avoid, and the owner
 * rejected it in those terms. A caller that needs to give that command a
 * password passes it here, twice, because the command asks twice.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

export interface CliEnvironment {
  /** The RUNTIME connection — what `@/lib/database` connects as. */
  databaseUrl: string;
  /** The MAINTENANCE connection — migrations and the role model (ADR-0002). */
  maintenanceUrl: string;
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Both streams, in the order a terminal would interleave them closely enough. */
  output: string;
}

/** Runs the CLI and returns everything it said, WITHOUT throwing on failure. */
export function runSplashtrackCliRaw(
  environment: CliEnvironment,
  args: string[],
  stdinInput?: string,
): CliResult {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      path.resolve(process.cwd(), "scripts/cli-dev.ts"),
      ...args,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: environment.databaseUrl,
        DATABASE_MAINTENANCE_URL: environment.maintenanceUrl,
      },
      input: stdinInput,
      encoding: "utf8",
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
  };
}

/**
 * The same invocation, throwing on a non-zero exit with everything the command
 * said attached. For the cases where a failing command means the case is
 * meaningless rather than the case being about the failure.
 */
export function runSplashtrackCli(
  environment: CliEnvironment,
  args: string[],
  stdinInput?: string,
): string {
  const result = runSplashtrackCliRaw(environment, args, stdinInput);
  if (result.status !== 0) {
    throw new Error(
      `splashtrack ${args.join(" ")} exited ${result.status}:\n${result.output}`,
    );
  }
  return result.output;
}
