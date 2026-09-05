/**
 * The line the enrolment log probe writes to separate APPLICATION output from
 * its own final, deliberate disclosure of the secret.
 *
 * In its own module, with no side effects, because the test that reads the
 * probe's output must not IMPORT the probe: the probe runs its enrolment at
 * module scope and calls `process.exit`, so importing it executes a second,
 * unwanted run inside the test process.
 */
export const SECRET_MARKER = "---MFA-PROBE-SECRET---";
