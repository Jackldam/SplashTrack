/**
 * §4.4 — restore is refused against anything other than a genuinely empty
 * database, checked by `restoreFromArchive` itself rather than trusted to a
 * caller. The suite's own `_test` database is never empty by the time this
 * file runs (other integration files seed and write to it, and
 * `fileParallelism: false` guarantees this file does not race them for that
 * state) — which is exactly the fixture this refusal needs: a real,
 * non-empty, real-schema database, not a mock.
 */
import { describe, expect, it } from "vitest";

import { detectBootState } from "@/lib/boot/state";
import { generateRecoveryToken } from "@/lib/crypto/recovery-token";
import {
  restoreFromArchive,
  RestoreRefusedNotEmptyError,
} from "@/modules/backup/application/restore-service";

describe("restore refusal on a running instance (§4.4)", () => {
  it("refuses restoreFromArchive when the boot state is not EMPTY, before touching the archive at all", async () => {
    const decision = await detectBootState();
    // The precondition this test needs. If this ever fails, it means the
    // suite's own database really is empty at this point in the run — worth
    // knowing, but it means this case is not exercising what it says it is.
    expect(decision.state).not.toBe("EMPTY");

    const token = generateRecoveryToken();
    // A garbage buffer: if the refusal happens BEFORE the archive is parsed
    // (as §4.4/D-116 requires — untrusted input is never touched ahead of the
    // state check), this never gets far enough to fail on the archive's shape
    // instead of on the boot state.
    const garbage = Buffer.from("not a real archive");

    await expect(restoreFromArchive(garbage, token.raw)).rejects.toThrow(
      RestoreRefusedNotEmptyError,
    );
  });
});
