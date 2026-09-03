/**
 * Generates the one bootstrap secret (D-112) into a file the operator holds.
 *
 *     npm run secret:init -- ./secrets/secret_key
 *
 * `13-configuration-and-setup.md` §3.1.1 specifies this as
 * `splashtrack secret:init --out <path>` on the shipped image. There is no
 * `splashtrack` binary yet — the CLI surface arrives with the container image
 * in phase 1 — so this script IS that command for now, and the flag shape moves
 * with the binary rather than being invented twice.
 *
 * Two rules it exists to keep:
 *
 *   - **The application never generates this key into `DATA_DIR`** (D-113). If
 *     key material lived under `DATA_DIR`, the backup archive — which captures
 *     that tree — would contain its own decryption key, and every "the file is
 *     inert without the token" claim would collapse silently. This writes where
 *     the operator says, and the default suggestion is `./secrets/`, outside
 *     any data volume.
 *   - **It refuses to overwrite.** Overwriting the bootstrap secret makes every
 *     encrypted column, every stored secret and every TOTP enrolment
 *     permanently unreadable. That is a rotation, and rotation is
 *     `key:rotate`'s job (design 13 §5.3), not a side effect of running this
 *     twice.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SECRET_BYTES = 32;

function main(): void {
  const target = process.argv[2];
  if (!target) {
    console.error(
      "Usage: npm run secret:init -- <path>\n" +
        "  e.g. npm run secret:init -- ./secrets/secret_key\n" +
        "Then point SECRET_KEY_FILE at that path.",
    );
    process.exit(2);
  }

  const resolved = path.resolve(process.cwd(), target);
  mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });

  try {
    writeFileSync(resolved, randomBytes(SECRET_BYTES).toString("base64"), {
      // wx: fail if it exists. See the header — silently replacing this key is
      // unrecoverable data loss, not a convenience.
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(
        `Refusing to overwrite ${resolved}: it already holds a bootstrap ` +
          "secret. Replacing it makes every encrypted value and every TOTP " +
          "enrolment permanently unreadable. Rotation is a separate, " +
          "re-encrypting operation (design 13 §5.3).",
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(`Wrote a new bootstrap secret to ${resolved} (mode 0600).`);
  console.log("Set SECRET_KEY_FILE to that path, and back the file up:");
  console.log(
    "losing it means every encrypted value must be re-entered by hand.",
  );
}

main();
