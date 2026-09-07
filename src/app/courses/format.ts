/**
 * Presentation helpers for the courses screens.
 *
 * SERVER-SIDE AND LOCALE-FIXED to `nl-NL`, matching `src/app/groups/format.ts`
 * and `src/app/people/format.ts`: these render on the server, so a browser
 * locale cannot shift them, and the UI language is Dutch by default
 * (`CLAUDE.md` §3 — D-159 governs identifiers, not what an administrator
 * reads).
 */

/** `12-03-2026` for a calendar date held at UTC midnight. */
export function formatCalendarDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    // UTC, deliberately: an enrolment date is a calendar day stored at UTC
    // midnight, and rendering it in a zone west of Greenwich would show the day
    // before.
    timeZone: "UTC",
  }).format(value);
}

/** `YYYY-MM-DD`, for a date input's `defaultValue`. */
export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * *"Zwem-ABC — Diploma B"* — one level as a `<select>` option.
 *
 * THE COURSE IS IN THE LABEL, because the dropdown a group's edit form renders
 * spans every course the caller reaches: *"Diploma B"* on its own is ambiguous
 * the moment a club runs a second course with a level of the same name, and the
 * person choosing it is deciding what this group is taught, not which row of a
 * table it points at.
 *
 * Exported and pure, so that property can be tested without rendering a page —
 * the same choice `poolOptionLabel` makes in the groups area.
 */
export function courseLevelOptionLabel(option: {
  readonly courseName: string;
  readonly levelName: string;
}): string {
  return `${option.courseName} — ${option.levelName}`;
}
