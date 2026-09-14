/**
 * Ambient type declaration for `node:crypto`'s native Argon2 support
 * (`argon2Sync`/`argon2`), which shipped in Node before this project's pinned
 * `@types/node` (`^20`) caught up — the runtime (Node 24, per `Dockerfile`)
 * has it; the type package does not yet. Scoped to exactly the one function
 * `backup-envelope.ts` calls (D-114's Argon2id KDF), rather than pulling in a
 * broader/newer `@types/node` for one API.
 *
 * Remove this file once `@types/node` ships these types natively.
 */
declare module "node:crypto" {
  export interface Argon2Options {
    message: ArrayBufferView | string;
    nonce: ArrayBufferView | string;
    parallelism: number;
    tagLength: number;
    memory: number;
    passes: number;
    secret?: ArrayBufferView | string;
    associatedData?: ArrayBufferView | string;
    version?: number;
  }

  export function argon2Sync(
    algorithm: "argon2d" | "argon2i" | "argon2id",
    options: Argon2Options,
  ): Buffer;
}
