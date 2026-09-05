/**
 * The one-time setup token — the credential that opens the wizard (D-101).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TOKEN EXISTS AT ALL
 *
 * D-039 makes the wizard *"the only unauthenticated administrative surface"*,
 * and names the race it leaves open: between container start and the operator
 * reaching `/setup`, **whoever arrives first becomes administrator**. On an
 * instance published at a public origin — which is exactly how a self-hoster
 * runs this — that window is reachable by anybody who knows the address. The
 * token closes it: the wizard refuses every request that does not carry it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A FILE AND NOT A LINE IN THE CONTAINER LOG
 *
 * The original mitigation printed the token to the log. F-99 killed that, and
 * the reasoning is not stylistic:
 *
 *   F-20 states as a DESIGN ASSUMPTION that self-hosters debugging a problem
 *   paste logs, screenshots and database rows. The repository is public. An
 *   operator whose setup fails opens an issue, pastes `docker compose logs
 *   app`, and publishes a credential that makes a stranger the administrator of
 *   an instance the school is about to fill with children's records. The same
 *   exposure happens through Portainer, Synology and Unraid log panes, and
 *   through centralised log shipping to a third party.
 *
 * So D-101: the token is written to `$DATA_DIR/setup-token` at mode 0600, and
 * **only its PATH is printed**. Reading it is a deliberate act on a named file
 * that says on its own first line that it is a credential — not something that
 * arrives in a scrollback buffer the operator will paste wholesale.
 *
 * The authority is unchanged and is the same one every break-glass command in
 * `13-…` §7 rests on: HOST ACCESS IS THE PROOF OF OWNERSHIP. Whoever can reach
 * the data volume owns the machine; whoever cannot, cannot begin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE-USE, AND HOW THAT IS ACTUALLY ENFORCED
 *
 * `consumeSetupToken` verifies and then CLAIMS the file with `rename(2)`, which
 * is atomic within a filesystem. Two concurrent submissions of the same valid
 * token therefore cannot both succeed: the loser's rename fails with `ENOENT`
 * and it is refused. A read-then-write "mark it used" would have a window
 * between the two, and the thing on the other side of that window is an
 * `ORGANIZATION`-scoped administrator account.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT CANNOT LIVE IN THE DATABASE, AND THAT IS NOT A SHORTCUT
 *
 * The state the wizard opens in is `EMPTY`: no tables at all (D-098 predicate
 * 1). A row cannot be written to a schema that does not exist, and D-055
 * forbids creating one before the operator has answered what the database is
 * for — which is the question the wizard asks. So the token's whole lifecycle
 * is on the filesystem, and that is the reason `DATA_DIR` is needed at all.
 *
 * SERVER-ONLY. Never imported by a client component; the value never reaches a
 * log, a redirect, an error message or a rendered page.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { dataPath, type SetupEnv } from "./data-dir";

/** The file name D-101 names. Not configurable — the design fixes it. */
export const SETUP_TOKEN_FILENAME = "setup-token";

/**
 * Where the claimed token goes. Its EXISTENCE is what lets `setup:token
 * --status` say "already used" rather than "never issued", which are different
 * problems with different remedies.
 */
export const SETUP_TOKEN_USED_FILENAME = "setup-token.used";

/**
 * D-101: *"expires in ≤60 minutes"*. Sixty exactly — the ceiling the decision
 * permits, because the operator's realistic path is `docker compose up`, read
 * the log, exec into the container, read the file, open a browser, choose a
 * password and enrol an authenticator, and a shorter window turns a first
 * install into a race against a clock nobody warned them about.
 */
export const SETUP_TOKEN_TTL_MINUTES = 60;

/**
 * 20 random bytes — 160 bits — rendered in Crockford base32 as 32 characters.
 *
 * CROCKFORD AND NOT RFC 4648: its alphabet omits `I`, `L`, `O` and `U`, so
 * there is no character pair a human can confuse while transcribing the token
 * from a terminal into a browser on another machine, which is precisely what
 * this credential is for. 160 bits is far above anything guessable inside a
 * sixty-minute window that also locks out after five wrong answers.
 */
const TOKEN_BYTES = 20;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** What the file holds. `usedAt` is only ever set on the `.used` copy. */
export interface SetupTokenRecord {
  token: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
}

/** What `setup:token --status` may say. Never includes the value. */
export interface SetupTokenStatus {
  path: string;
  state: "NONE" | "VALID" | "EXPIRED" | "USED";
  issuedAt?: string;
  expiresAt?: string;
  usedAt?: string;
}

/** Why a submitted token was refused. One shape per genuinely different fix. */
export type SetupTokenRefusal =
  "NO_TOKEN_ISSUED" | "EXPIRED" | "ALREADY_USED" | "MISMATCH";

export type SetupTokenVerdict =
  { ok: true } | { ok: false; refusal: SetupTokenRefusal };

export function setupTokenPath(env: SetupEnv = process.env): string {
  return dataPath(SETUP_TOKEN_FILENAME, env);
}

export function usedSetupTokenPath(env: SetupEnv = process.env): string {
  return dataPath(SETUP_TOKEN_USED_FILENAME, env);
}

/**
 * Mints a token and writes it, replacing any token already there.
 *
 * Returns the PATH and never the value: this is the one function that could
 * leak the token into a caller that logs its return, so it does not have one to
 * leak. The CLI prints what comes back from here verbatim.
 *
 * `mode` on the write AND a `chmod` after it, for the same reason
 * `writeEnrolmentArtefact` does both: the `mode` argument is masked by the
 * process umask on some platforms, and "0600 unless the umask disagreed" is not
 * a property worth stating.
 */
export function issueSetupToken(
  env: SetupEnv = process.env,
  now: Date = new Date(),
): { path: string; expiresAt: Date } {
  const expiresAt = new Date(
    now.getTime() + SETUP_TOKEN_TTL_MINUTES * 60 * 1000,
  );
  const record: SetupTokenRecord = {
    token: mintToken(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
  };

  const file = setupTokenPath(env);
  writeFileSync(file, serialize(record), { mode: 0o600 });
  chmodSync(file, 0o600);
  // A previous token's claim marker would otherwise make `--status` report
  // USED for a token that was just issued.
  rmSync(usedSetupTokenPath(env), { force: true });

  return { path: file, expiresAt };
}

/**
 * Issues a token only if there is no usable one. What the entrypoint runs on
 * every start in setup mode: an operator who restarts the container mid-install
 * must not find the token they wrote down silently replaced, and one who
 * restarts an hour later must not find an expired one and no instruction.
 */
export function ensureSetupToken(
  env: SetupEnv = process.env,
  now: Date = new Date(),
): { path: string; expiresAt: Date; issued: boolean } {
  const existing = readSetupToken(env);
  if (existing && Date.parse(existing.expiresAt) > now.getTime()) {
    return {
      path: setupTokenPath(env),
      expiresAt: new Date(existing.expiresAt),
      issued: false,
    };
  }
  return { ...issueSetupToken(env, now), issued: true };
}

/** The record, or null when no token file exists or it is unreadable. */
export function readSetupToken(
  env: SetupEnv = process.env,
): SetupTokenRecord | null {
  try {
    return parse(readFileSync(setupTokenPath(env), "utf8"));
  } catch {
    // Missing, truncated, or hand-edited into something that is not a record.
    // All three mean "there is no usable token", which is the safe answer: the
    // wizard refuses, and `setup:token --new` is one command.
    return null;
  }
}

/**
 * What state the token is in, with no value in it. Safe to print, safe to log,
 * safe for a diagnostics page.
 */
export function setupTokenStatus(
  env: SetupEnv = process.env,
  now: Date = new Date(),
): SetupTokenStatus {
  const path = setupTokenPath(env);
  const record = readSetupToken(env);

  if (!record) {
    const used = readUsed(env);
    if (used) {
      return {
        path,
        state: "USED",
        issuedAt: used.issuedAt,
        expiresAt: used.expiresAt,
        usedAt: used.usedAt ?? undefined,
      };
    }
    return { path, state: "NONE" };
  }

  const expired = Date.parse(record.expiresAt) <= now.getTime();
  return {
    path,
    state: expired ? "EXPIRED" : "VALID",
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

/**
 * Verifies a submitted token and CLAIMS it, atomically. Returns `{ok: true}`
 * exactly once for any issued token.
 *
 * The comparison is `timingSafeEqual` over the normalised forms. A token is not
 * a password — it is high-entropy and short-lived — but a `===` on a
 * credential is a habit that gets copied to the next one, and the cost here is
 * a buffer compare.
 *
 * NORMALISATION IS DELIBERATE AND ONE-WAY: the operator retypes 32 characters
 * from another machine, so spaces, dashes and case are dropped from BOTH sides
 * before comparing. It never widens the accepted set — a character outside the
 * alphabet simply cannot match a minted token.
 */
export function consumeSetupToken(
  submitted: string,
  env: SetupEnv = process.env,
  now: Date = new Date(),
): SetupTokenVerdict {
  const record = readSetupToken(env);
  if (!record) {
    return {
      ok: false,
      refusal: readUsed(env) ? "ALREADY_USED" : "NO_TOKEN_ISSUED",
    };
  }

  if (Date.parse(record.expiresAt) <= now.getTime()) {
    return { ok: false, refusal: "EXPIRED" };
  }

  if (!matches(submitted, record.token)) {
    return { ok: false, refusal: "MISMATCH" };
  }

  // THE CLAIM. Atomic within the filesystem, so a second concurrent caller
  // holding the same valid token loses the race here rather than both of them
  // creating an administrator.
  try {
    renameSync(setupTokenPath(env), usedSetupTokenPath(env));
  } catch {
    return { ok: false, refusal: "ALREADY_USED" };
  }

  const claimed: SetupTokenRecord = { ...record, usedAt: now.toISOString() };
  const usedFile = usedSetupTokenPath(env);
  writeFileSync(usedFile, serialize(claimed), { mode: 0o600 });
  chmodSync(usedFile, 0o600);

  return { ok: true };
}

/**
 * Removes every trace of the token. Called when setup COMPLETES: a consumed
 * token is inert, but leaving a file called `setup-token` in the data volume of
 * a live installation is an invitation to a support answer that says "paste it".
 *
 * Never called to reopen anything. The wizard is closed by the boot state, not
 * by the absence of this file.
 */
export function clearSetupToken(env: SetupEnv = process.env): void {
  rmSync(setupTokenPath(env), { force: true });
  rmSync(usedSetupTokenPath(env), { force: true });
}

/** True when a token exists, is unclaimed and has not expired. */
export function hasUsableSetupToken(
  env: SetupEnv = process.env,
  now: Date = new Date(),
): boolean {
  return setupTokenStatus(env, now).state === "VALID";
}

// ── internals ───────────────────────────────────────────────────────────────

function mintToken(): string {
  const bytes = randomBytes(TOKEN_BYTES);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

/**
 * The comparable form: upper case, and everything outside the alphabet removed.
 * Applied to the stored token too, so the two sides can never be normalised
 * differently.
 */
export function normaliseSetupToken(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function matches(submitted: string, stored: string): boolean {
  const a = Buffer.from(normaliseSetupToken(submitted), "utf8");
  const b = Buffer.from(normaliseSetupToken(stored), "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length through an exception path. Length is not secret here — every token
  // is 32 characters — so the guard is a plain comparison and the CONTENT
  // compare is the constant-time one.
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function readUsed(env: SetupEnv): SetupTokenRecord | null {
  try {
    return parse(readFileSync(usedSetupTokenPath(env), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The file's own text. The warning is the FIRST key rather than a comment,
 * because JSON has no comments and a credential file that does not say it is
 * one gets pasted.
 */
function serialize(record: SetupTokenRecord): string {
  return `${JSON.stringify(
    {
      _warning:
        "THIS FILE IS A CREDENTIAL. Anyone holding this token can become the " +
        "administrator of this installation until setup completes. Never " +
        "paste it into an issue, a chat, a screenshot or a log.",
      ...record,
    },
    null,
    2,
  )}\n`;
}

function parse(text: string): SetupTokenRecord {
  const raw = JSON.parse(text) as Partial<SetupTokenRecord>;
  if (
    typeof raw.token !== "string" ||
    typeof raw.issuedAt !== "string" ||
    typeof raw.expiresAt !== "string" ||
    Number.isNaN(Date.parse(raw.expiresAt))
  ) {
    throw new Error("The setup token file is not a token record.");
  }
  return {
    token: raw.token,
    issuedAt: raw.issuedAt,
    expiresAt: raw.expiresAt,
    usedAt: typeof raw.usedAt === "string" ? raw.usedAt : null,
  };
}

/** True when a token file is present at all — used by `--new`'s reporting. */
export function setupTokenFileExists(env: SetupEnv = process.env): boolean {
  return existsSync(setupTokenPath(env));
}
