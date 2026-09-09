/**
 * Reading a secret from an operator without it landing in a transcript.
 *
 * THE THREAT IS THE PASTE, NOT THE PROCESS. Every command in `13-…` §7 is run
 * as `docker compose exec app splashtrack …` by a self-hoster who, when it does
 * not work, pastes the whole terminal into a public GitHub issue — F-20 states
 * that as a design assumption and D-101 already redesigned the setup token
 * around it. A password echoed at the prompt, or a TOTP secret printed as a
 * courtesy, is in that paste.
 *
 * So:
 *   - a value read from a TTY is read with **echo disabled**, and nothing is
 *     written back to the terminal;
 *   - a non-TTY stdin is accepted (a here-doc, a pipe), because automation is
 *     real and because it is now the only non-interactive path;
 *   - no command in this CLI takes a password as a flag value, and there is no
 *     code path that prints one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `--password-file` IS GONE FROM `admin:create` (D-187), AND THE OWNER IS RIGHT
 *
 * It was offered as the fix for a TTY that mangled his input. His answer:
 * *"Dit gaan we dus niet doen ik ga niet een wachtwoord in een bestand zetten
 * met alle risico's van dien!"* A password written to disk — even briefly, even
 * at 0600 — is exactly what this product refuses everywhere else, and a
 * rejected pattern left in place is how it comes back. The FIX for the mangled
 * prompt is the `/setup` wizard, where a browser can echo a confirmation field
 * back; the prompt is the recovery path, not the front door.
 *
 * {@link readSecretFile} and `resolveSecret`'s `file` option SURVIVE, with
 * exactly one caller: `admin:reset-mfa`. The argument for that one is in
 * `./commands/admin.ts` and it is about D-141, not about convenience.
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

/**
 * Reads one line from stdin. When stdin is a TTY the input is not echoed and
 * `prompt` is written to stderr, so a caller redirecting stdout still sees it
 * and a caller capturing stdout does not capture the prompt.
 */
export async function readSecretLine(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    return readLineFromPipe();
  }

  stdout.write(prompt);
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  // `readline` in terminal mode echoes as it goes. Muting the output stream for
  // the duration of the read is the documented way to suppress that: the
  // interface still receives the keystrokes, the terminal never shows them.
  const asMutable = rl as unknown as { output: NodeJS.WritableStream | null };
  const realOutput = asMutable.output;
  asMutable.output = null;

  try {
    const value = await new Promise<string>((resolve) => {
      rl.question("", resolve);
    });
    return value;
  } finally {
    asMutable.output = realOutput;
    rl.close();
    stdout.write("\n");
  }
}

/** Reads one visible line — for values that are not secret (an email, a name). */
export async function readLine(prompt: string): Promise<string> {
  if (!stdin.isTTY) return readLineFromPipe();

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    return await new Promise<string>((resolve) => rl.question(prompt, resolve));
  } finally {
    rl.close();
  }
}

/**
 * Reads a secret from a file the operator already holds. Preferred over any
 * prompt for scripted use: the value never enters an argument vector, a shell
 * history file or a terminal buffer.
 */
export function readSecretFile(filePath: string): string {
  const raw = readFileSync(filePath, "utf8");
  // A trailing newline is what every editor and `echo` writes; stripping it is
  // the difference between "wrong password" and an hour of confusion.
  return raw.replace(/\r?\n$/, "");
}

/**
 * Resolves a secret from either a file or an interactive prompt, in that order.
 * `confirm` re-prompts and compares, which is what stops a mistyped password
 * becoming an account nobody can sign in to.
 */
export async function resolveSecret(options: {
  file?: string;
  prompt: string;
  confirmPrompt?: string;
}): Promise<string> {
  if (options.file) return readSecretFile(options.file);

  const value = await readSecretLine(options.prompt);
  if (options.confirmPrompt) {
    const again = await readSecretLine(options.confirmPrompt);
    if (value !== again) {
      throw new Error("The two values do not match.");
    }
  }
  return value;
}

/**
 * ONE reader over a non-TTY stdin, kept for the life of the process.
 *
 * WHY IT IS SHARED, AND WHY THAT IS LOAD-BEARING RATHER THAN TIDY. This used to
 * open a fresh `readline` per call and close it after one line. A single read
 * worked; a SECOND read did not, because closing the interface takes the
 * underlying stream with it — so `resolveSecret`'s confirmation prompt could
 * never be answered over a pipe at all.
 *
 * That became load-bearing the moment `--password-file` left `admin:create`
 * (D-187): with the file path gone, a here-doc is the only non-interactive way
 * to give that command a password, and the command asks for it TWICE. One
 * shared iterator reads successive lines from the same stream, which is what a
 * here-doc supplies.
 */
let pipeLines: AsyncIterator<string> | null = null;

/** One line from a pipe or here-doc, leaving the rest for the next caller. */
async function readLineFromPipe(): Promise<string> {
  pipeLines ??= createInterface({ input: stdin, terminal: false })[
    Symbol.asyncIterator
  ]();

  const next = await pipeLines.next();
  if (next.done) throw new Error("No input was supplied on stdin.");
  return next.value;
}
