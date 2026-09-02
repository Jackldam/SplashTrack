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
}
