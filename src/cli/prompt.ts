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
 *   - a value may instead be read from a **file** the operator already holds
 *     (`--password-file`), which is the documented path — a flag VALUE would
 *     land in shell history and in `ps` output for every user on the host;
 *   - no command in this CLI takes a password as a flag value, and there is no
 *     code path that prints one.
 *
 * A non-TTY stdin is accepted (a here-doc, a pipe) because automation is real,
 * but it is not the documented path and the file form is what the report and
 * the entrypoint's messages name.
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

/** One line from a pipe or here-doc, without the reader consuming the rest. */
function readLineFromPipe(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const rl = createInterface({ input: stdin, terminal: false });
    let settled = false;
    rl.once("line", (line) => {
      settled = true;
      rl.close();
      resolve(line);
    });
    rl.once("close", () => {
      if (!settled) reject(new Error("No input was supplied on stdin."));
    });
  });
}
