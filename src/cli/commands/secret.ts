/**
 * `secret:init` — generates the one bootstrap secret (D-112).
 *
 * IT TOUCHES NOTHING ELSE, and that is a hard requirement rather than a
 * simplification: this is the command an operator runs when there IS no key, on
 * a host where the application therefore cannot start. It must not import the
 * database client, the auth instance or anything that derives a key at module
 * scope — every one of those throws without the very thing this command
 * creates. `node:crypto` and `node:fs` only. Keep it that way.
 *
 * TWO RULES IT EXISTS TO KEEP:
 *
 *   - **The application never generates this key into `DATA_DIR`** (D-113). The
 *     backup archive captures that tree, so key material living there would put
 *     the archive's own decryption key inside the archive, and every "the file
 *     is inert on its own" claim would collapse silently. This writes where the
 *     operator says; the suggested default is `./secrets/`, outside any data
 *     volume.
 *   - **It refuses to overwrite.** Replacing the bootstrap secret makes every
 *     encrypted column, every stored secret and every TOTP enrolment
 *     permanently unreadable. That is a rotation, and rotation is `key:rotate`'s
 *     job (`13-…` §5.3), never a side effect of running this twice.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SECRET_BYTES = 32;

export interface SecretInitResult {
  path: string;
  created: boolean;
  /** Set when `created` is false: why it refused. Never the key. */
  refusal?: string;
}

/** Writes a new bootstrap secret to `target`, refusing to replace one. */
export function generateBootstrapSecret(target: string): SecretInitResult {
  const resolved = path.resolve(process.cwd(), target);
  mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });

  try {
    writeFileSync(resolved, randomBytes(SECRET_BYTES).toString("base64"), {
      // wx: fail if it exists. Silently replacing this key is unrecoverable
      // data loss, not a convenience.
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return {
        path: resolved,
        created: false,
        refusal:
          `Refusing to overwrite ${resolved}: it already holds a bootstrap ` +
          "secret. Replacing it makes every encrypted value and every TOTP " +
          "enrolment permanently unreadable. Rotation is a separate, " +
          "re-encrypting operation (design 13 §5.3).",
      };
    }
    throw error;
  }

  return { path: resolved, created: true };
}
