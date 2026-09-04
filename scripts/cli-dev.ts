/**
 * The `splashtrack` CLI, run from a checkout with `tsx`.
 *
 * The image ships the same commands as a bundled binary (`dist/cli.mjs`, built
 * by `scripts/build-cli.ts`) with a `splashtrack` wrapper on the PATH. This
 * entry point exists so the identical code is runnable during development
 * without a container: `npm run cli -- boot:state`.
 *
 * It loads `.env` first — the image does not need that, because the entrypoint
 * runs with the environment already set, but a checkout keeps its three
 * variables in `.env` like every other local command here.
 *
 * `quiet` IS NOT COSMETIC. dotenv writes a banner to STDOUT, and `boot:state`
 * reserves stdout for exactly one machine-readable line, `<STATE> <ACTION>`,
 * which `docker-entrypoint.sh` branches on. Without this the dev CLI's contract
 * differs from the image's, and anything parsing it in a checkout — the
 * first-run integration test, or an operator's script — reads the banner as
 * part of the state.
 */
import path from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

void import("@/cli/index");
