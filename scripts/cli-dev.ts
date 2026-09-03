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
 */
import path from "node:path";

import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

void import("@/cli/index");
