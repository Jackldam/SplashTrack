/**
 * Next.js instrumentation hook — runs once when a server instance boots, before
 * any request is served (both the Node.js and Edge runtimes call `register()`).
 *
 * Used here to fail fast on a misconfigured deployment rather than let a
 * missing secret surface later as a confusing runtime error (see
 * `src/lib/env.ts`).
 *
 * The template also started an in-process maintenance scheduler here. That is
 * not extracted: there is no `maintenance` module in v1's foundation, and the
 * boot state machine (including the FAILED state) is phase 1 work.
 */
export async function register() {
  const { assertRequiredEnv } = await import("@/lib/env");
  assertRequiredEnv();

  // The bootstrap secret is READ here, not merely checked for presence: a
  // SECRET_KEY_FILE naming a path that does not exist, or a file holding eight
  // characters, must fail at boot rather than on the first encrypted write
  // (D-112, D-166). `node:fs` is unavailable on the Edge runtime, so this half
  // of the check is Node-only — `assertRequiredEnv` above covers both.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadBootstrapSecret } = await import("@/lib/crypto/secret-key");
    loadBootstrapSecret();
  }
}
