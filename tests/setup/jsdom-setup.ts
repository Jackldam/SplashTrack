/**
 * Vitest setup for the "dom" project (jsdom environment) — loaded before any
 * component test module. Unlike the node project's setup, this touches NO
 * database: component tests are pure presentational render/interaction tests.
 *
 * Responsibilities:
 *   1. Register @testing-library/jest-dom's custom matchers on vitest's expect
 *      (`toBeInTheDocument`, `toHaveAccessibleName`, `toBeDisabled`, …).
 *   2. Unmount React trees after each test so DOM/state never leaks between
 *      tests (RTL's `cleanup`).
 */
import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
