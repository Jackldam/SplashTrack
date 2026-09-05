/**
 * The application version, read from `package.json`.
 *
 * ONE HOME (`CLAUDE.md` §4). It is recorded on the `InstallationBootstrap`
 * record and reported by `boot:state`, and since D-185 the record is written by
 * the browser enrolment flow rather than by the CLI — so both the CLI and the
 * Next server need this value, and two readers of one fact is how they end up
 * disagreeing about what shipped.
 *
 * PLAIN `readFileSync`, deliberately, not `createRequire` and not a JSON
 * `import`. This module is bundled into the Next server, where a dynamic
 * `require` is something a bundler has to be persuaded about and a static JSON
 * import inlines the version at BUILD time — which is right up until somebody
 * runs the image built from a different checkout. A file read at start reports
 * what is actually on disk.
 *
 * The image puts `package.json` at `/app` and runs with that as the working
 * directory (see the Dockerfile), which is why `process.cwd()` is the right
 * base. `SPLASHTRACK_PACKAGE_JSON` overrides it for a caller that runs from
 * somewhere else; it is a test/diagnostic seam, not configuration, and nothing
 * is gated on the answer.
 *
 * NEVER A GATE. The check that refuses to start against a newer schema is
 * `AHEAD`, decided from `_prisma_migrations`. This is diagnostic, so an
 * unreadable `package.json` degrades to `"unknown"` rather than failing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export const APP_VERSION: string = readVersion();

function readVersion(): string {
  try {
    const file =
      process.env.SPLASHTRACK_PACKAGE_JSON ??
      path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
