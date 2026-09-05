/**
 * `npm run secret:init -- <path>` — the same command the image exposes as
 * `splashtrack secret:init --out <path>`.
 *
 * ONE implementation, in `src/cli/commands/secret.ts`. This script is the
 * checkout-side entry point and delegates; the flag shape moved to the binary
 * when the binary arrived rather than being invented twice.
 */
import { generateBootstrapSecret } from "@/cli/commands/secret";

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

  const result = generateBootstrapSecret(target);
  if (!result.created) {
    console.error(result.refusal);
    process.exit(1);
  }

  console.log(`Wrote a new bootstrap secret to ${result.path} (mode 0600).`);
  console.log("Set SECRET_KEY_FILE to that path, and back the file up:");
  console.log(
    "losing it means every encrypted value must be re-entered by hand.",
  );
}

main();
