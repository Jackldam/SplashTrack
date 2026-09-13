/**
 * The `attendance` module (phase 2.2) — SplashTrack's flagship screen, on
 * its five modules (D-138) — `docs/build/phase-2.2-attendance-report.md`,
 * driven through a real browser.
 *
 * Two scenarios:
 *
 *  1. A COMPLETE, successful register: an instructor opens the LESSON
 *     screen, registers the whole roster's attendance in ONE form/ONE
 *     transaction (`01-domain-model.md` §4 — "partial attendance is not a
 *     valid state"), including the per-pupil `note` field
 *     (`AttendanceEvent.note` — the report's §1.8, decided 2026-09-09 to
 *     stay an unprotected, purely internal instructor field, no
 *     `students.notes.*` gate), sees the confirmation, and the result is
 *     visible on the pupil's own person page.
 *
 *  2. A CORRECTION on an already-registered pupil — the append-only pattern
 *     (D-005/D-061): a correction is a NEW event carrying
 *     `supersedesEventId`, the earlier one never edited, never deleted.
 *     Jack's decision round (2026-09-09, §1.5 of the report) confirmed
 *     explicitly that "the right to correct" always holds, even once a
 *     lesson is later cancelled or the pupil has left the group —
 *     `amendAttendance` deliberately re-checks neither. The struck-through
 *     history (D-061 — "who said a child was present, and when they changed
 *     their mind, is the record's whole point") is asserted directly, both
 *     on the lesson screen and on the pupil's own person page.
 *
 * The live-search "gast toevoegen" picker (fase eecdf81 / PR#21 / PR#22) is
 * DELIBERATELY NOT re-tested here: `assessment-aftest.spec.ts`'s first
 * scenario already drives the EXACT SAME mechanism on this EXACT SAME
 * screen — `openDetails(page, "Gast toevoegen (inhaalles, andere groep of
 * proefzwemmer)")`, `pickFromLiveSearch`, the `saved=guest` redirect and the
 * `GAST` badge on the roster table — since the guest mechanism (one
 * `SessionRosterEntry`, `addGuestToSession`) is shared verbatim by every
 * module that reads the session's roster, attendance included. Re-testing
 * the same picker here would only duplicate that coverage, not add any.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`. MUST NOT run in the same `playwright
 * test` invocation as another spec in this directory (each truncates the
 * same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/attendance-register.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

import {
  createAdmin,
  createStudent,
  openDetails,
  pickFromLiveSearch,
  resetScratchDatabase,
  setUpCourseGroupAndSession,
  signInAndEnrol,
} from "./support/e2e-common";

const ADMIN_EMAIL = "e2e-admin-attendance@example.invalid";
const ADMIN_NAME = "E2E Attendance Admin";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
});

/**
 * The register/history table under the "Aanwezigheid" heading — found by
 * document position (`xpath=following::table[1]`) rather than a bare
 * `tbody tr`, because a pupil's name and their attendance STATE both also
 * appear verbatim in other tables on the same page (the roster table above
 * shows the same names; a correction form's own `<select>` re-shows the
 * current state as an `<option>`'s text). Works for both renderings this
 * section has — the initial blank form's table (inside a `<form>`, hence
 * not a direct sibling) and the later read-only lines table — since
 * `following::` walks the whole subsequent document, not just siblings.
 */
function attendanceTable(page: Page) {
  return page
    .getByRole("heading", { name: "Aanwezigheid", exact: true })
    .locator("xpath=following::table[1]");
}

test("compleet gelukt: de hele groep registreren, de onbeschermde notitie, en een correctie op een bestaande registratie (recht op correctie, fase 2.2 decision round §1.5)", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36);
  const { groupId, sessionUrl } = await setUpCourseGroupAndSession(
    page,
    suffix,
    "Attendance",
  );

  const presentFamilyName = `Aanwezig${suffix}`;
  const absentFamilyName = `Afwezig${suffix}`;
  await createStudent(page, "Noor", presentFamilyName);
  await createStudent(page, "Max", absentFamilyName);

  for (const familyName of [presentFamilyName, absentFamilyName]) {
    await page.goto(`/groups/${groupId}`);
    await openDetails(page, "Leerling plaatsen");
    await pickFromLiveSearch(
      page,
      "Zoek leerling op naam",
      familyName,
      new RegExp(familyName),
    );
    await page.locator("#placeReason").fill("E2E: plaatsing voor aanwezigheid");
    await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
    await expect(page).toHaveURL(/saved=placed/);
  }

  // --- register the whole group's attendance, one form, one transaction ----
  await page.goto(sessionUrl);

  const presentRow = attendanceTable(page).locator("tbody tr", {
    has: page.getByText(presentFamilyName),
  });
  const absentRow = attendanceTable(page).locator("tbody tr", {
    has: page.getByText(absentFamilyName),
  });

  await presentRow
    .getByRole("combobox", { name: "Status" })
    .selectOption({ label: "Aanwezig" });
  const presentNote = `E2E: kwam vrolijk het water in (${suffix})`;
  await presentRow.getByRole("textbox", { name: "Notitie" }).fill(presentNote);

  await absentRow
    .getByRole("combobox", { name: "Status" })
    .selectOption({ label: "Afwezig" });
  const absentNote = `E2E: ziek gemeld door ouder (${suffix})`;
  await absentRow.getByRole("textbox", { name: "Notitie" }).fill(absentNote);

  await page.getByRole("button", { name: "Vastleggen", exact: true }).click();

  // --- the confirmation --------------------------------------------------------
  await expect(page).toHaveURL(/saved=attendance/);
  await expect(
    page.getByText("Aanwezigheid vastgelegd.", { exact: true }),
  ).toBeVisible();

  // The register now renders as read lines, not the initial blank form. The
  // status column is `td:nth-child(2)` — scoped there rather than a bare
  // `getByText`, since the correction form's own (identically-labelled)
  // `<select>` on the same row would otherwise also match.
  await expect(
    attendanceTable(page)
      .locator("tbody tr", { has: page.getByText(presentFamilyName) })
      .locator("td")
      .nth(1),
  ).toHaveText("Aanwezig");
  await expect(
    attendanceTable(page)
      .locator("tbody tr", { has: page.getByText(absentFamilyName) })
      .locator("td")
      .nth(1),
  ).toHaveText("Afwezig");

  // --- visible on the pupil's OWN person page -----------------------------------
  await page.goto("/people");
  await page
    .locator("tbody tr", {
      has: page.locator("a", { hasText: presentFamilyName }),
    })
    .locator("a")
    .click();
  await expect(page).toHaveURL(/\/people\/[^/?]+$/);
  await expect(
    page.getByRole("heading", { name: "Aanwezigheid", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Aanwezig", { exact: true })).toBeVisible();
  await expect(page.getByText(presentNote)).toBeVisible();

  // --- now correct the ABSENT pupil's registration: they were actually late,
  //     not absent — the append-only correction (D-005/D-061) -----------------
  await page.goto(sessionUrl);
  const absentLineRow = attendanceTable(page).locator("tbody tr", {
    has: page.getByText(absentFamilyName),
  });
  await absentLineRow
    .getByRole("combobox", { name: "Status" })
    .selectOption({ label: "Te laat" });
  const correctionNote = `E2E: bleek toch te laat te zijn, geen no-show (${suffix})`;
  await absentLineRow
    .getByRole("textbox", { name: "Notitie" })
    .fill(correctionNote);
  await absentLineRow.getByRole("button", { name: "Corrigeren" }).click();

  await expect(page).toHaveURL(/saved=attendanceAmended/);
  await expect(
    page.getByText(
      "Aanwezigheid gecorrigeerd. De eerdere waarneming blijft zichtbaar in de geschiedenis.",
      { exact: true },
    ),
  ).toBeVisible();

  // The line itself now shows the CORRECTED state.
  await expect(
    attendanceTable(page)
      .locator("tbody tr", { has: page.getByText(absentFamilyName) })
      .locator("td")
      .nth(1),
  ).toHaveText("Te laat");

  // --- the history keeps BOTH events, the superseded one struck through -------
  await openDetails(
    page,
    "Geschiedenis — elke waarneming, correcties doorgestreept",
  );
  // The line is plain text inside the `<li>` (`{time} — {name}: {state}`,
  // no wrapping element per field), so the state is matched by the literal
  // ": {state}" fragment the template always produces — a bare `hasText:
  // "Afwezig"` would also match the FAMILY NAME itself (`Afwezig${suffix}`).
  const historyItems = page.locator("details li");
  const supersededEntry = historyItems.filter({
    hasText: new RegExp(`${absentFamilyName}: Afwezig`),
  });
  await expect(supersededEntry).toHaveClass(/text-decoration-line-through/);
  const correctionEntry = historyItems.filter({
    hasText: new RegExp(`${absentFamilyName}: Te laat`),
  });
  await expect(correctionEntry).not.toHaveClass(/text-decoration-line-through/);
  await expect(correctionEntry).toContainText("correctie");

  // --- and the correction, with the PRIOR observation struck through, shows
  //     on the pupil's own person page too --------------------------------------
  await page.goto("/people");
  await page
    .locator("tbody tr", {
      has: page.locator("a", { hasText: absentFamilyName }),
    })
    .locator("a")
    .click();
  await expect(page).toHaveURL(/\/people\/[^/?]+$/);

  const personAttendanceTable = page
    .getByRole("heading", { name: "Aanwezigheid", exact: true })
    .locator("xpath=following::table[1]");
  const supersededPersonRow = personAttendanceTable.locator("tbody tr", {
    hasText: "Afwezig",
  });
  await expect(supersededPersonRow).toHaveClass(/text-decoration-line-through/);
  const correctedPersonRow = personAttendanceTable.locator("tbody tr", {
    hasText: "Te laat",
  });
  await expect(correctedPersonRow).not.toHaveClass(
    /text-decoration-line-through/,
  );
  await expect(correctedPersonRow.getByText(correctionNote)).toBeVisible();
});
