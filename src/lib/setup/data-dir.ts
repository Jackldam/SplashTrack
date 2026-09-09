/**
 * `DATA_DIR` — where the instance keeps the small amount of state that cannot
 * live in the database.
 *
 * `13-configuration-and-setup.md` §3.1 lists it among the Layer 1 bootstrap
 * variables, as *"uploads/assets path (optional, sane default)"*. It qualifies
 * under D-037 for the reason that rule exists: it SELECTS WHERE STATE LIVES, so
 * it cannot itself be read from the state it selects. No ADR is needed to add
 * it — §3.1 already sanctions it — and nothing else is added alongside it.
 *
 * WHY IT IS NEEDED NOW. D-101 puts the setup token at `$DATA_DIR/setup-token`,
 * and the setup token is the credential that gates the wizard on a database
 * with NO TABLES AT ALL. There is nowhere else it could go: the boot state the
 * wizard opens in is `EMPTY`, and a row cannot be written to a schema that does
 * not exist yet. That is the whole reason this file exists rather than the
 * token living in the settings registry with everything else.
 *
 * THE DEFAULT IS THE IMAGE'S OWN VOLUME. The Dockerfile creates `/app/data`
 * owned by uid 10001 at mode 0700 and the reference compose file mounts
 * `splashtrack-data` over it; the process working directory in the image is
 * `/app`. So `process.cwd()/data` is the right default in the container and in
 * a checkout alike, and an operator who mounts their volume elsewhere sets the
 * variable.
 *
 * `src/cli/commands/admin.ts` used to carry its own `DEFAULT_ARTEFACT_DIR =
 * "data"` with a comment saying *"when the wizard lands, this default becomes
 * `$DATA_DIR`"*. The wizard has landed; that constant is gone and this is the
 * one home for the answer.
 *
 * SERVER-ONLY.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The environment, as this module needs to read it.
 *
 * DELIBERATELY NOT `NodeJS.ProcessEnv`. That type requires `NODE_ENV` in this
 * project, so a caller passing a scratch `{ DATA_DIR }` — which is exactly how
 * the token's own tests point it at a temporary directory — would not
 * typecheck. `@/lib/crypto/secret-key.ts` takes the same shape for the same
 * reason, so this is the established form here rather than a new one.
 */
export type SetupEnv = Record<string, string | undefined>;

/**
 * The resolved data directory. Absolute, and created at mode 0700 if it is
 * missing — the token file inside it is a credential, and a directory anybody
 * on the host can list is half of the protection gone.
 *
 * Creating it here rather than at boot keeps the failure attached to the thing
 * that needs it: an unwritable data directory should surface when the setup
 * token is issued, naming the path, rather than as a container that refuses to
 * start for a reason an operator has to guess at.
 */
export function dataDir(env: SetupEnv = process.env): string {
  const configured = env.DATA_DIR?.trim();
  const resolved = configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "data");
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return resolved;
}

/** A path inside {@link dataDir}, with the directory guaranteed to exist. */
export function dataPath(name: string, env: SetupEnv = process.env): string {
  return path.join(dataDir(env), name);
}
