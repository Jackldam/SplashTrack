"use server";

/**
 * The `groups` area's Server Actions, covering both modules' write paths.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ACTION IS A THIN SHELL AROUND A SERVICE, AND THAT IS THE POINT
 *
 * A Server Action is an unauthenticated HTTP endpoint until something
 * authenticates it, and it accepts a `FormData` from anywhere — not only from
 * the form that rendered it. So nothing here decides anything: each action
 * resolves the session, hands the raw fields to the service, and lets the
 * service run `requirePermission`, validate the input and write the audit event.
 * There is no branch in this file that reads or writes a table.
 *
 * That is also why none of them trusts a hidden field for the ACTOR. The acting
 * person comes from the session and never from the form; the form supplies only
 * the SUBJECT, which the service then guards on. A hidden `decidedByPersonId`
 * would be a group move somebody else's name gets attached to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `moveStudentAction` IS ONE ACTION FOR ALL THREE DIRECTIONS
 *
 * There is no `promoteStudentAction` beside a `demoteStudentAction`. The
 * direction is a field on the form, the reason is required whichever it is, and
 * the same service call handles all three — D-108's rule that moving down is
 * ordinary history, enforced at the surface as well as in the module.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  assignInstructor,
  createGroup,
  endGroupMembership,
  endInstructorAssignment,
  GroupFullError,
  GroupMoveError,
  IntervalError,
  moveStudent,
  placeStudentInGroup,
  updateGroup,
  type ActorContext,
} from "@/modules/groups";
import {
  addGuestToSession,
  cancelSession,
  clearSessionLaneOverride,
  createClosure,
  createLane,
  createPool,
  createRecurrence,
  deactivateRecurrence,
  FacilityError,
  generateSessions,
  overrideSessionLanes,
  removeGuestFromSession,
  ScheduleError,
  setRecurrenceLanes,
  updateClosure,
  updateLane,
  updatePool,
  updateRecurrence,
} from "@/modules/sessions";
import {
  amendAttendance,
  AttendanceError,
  registerSessionAttendance,
} from "@/modules/attendance";
import { AssessmentError, recordAssessment } from "@/modules/assessment";

const actionLogger = logger.child({ component: "groups.actions" });

/**
 * The actor, from the SESSION — never from a form field.
 *
 * `requireEnrolledSession` and not a bare "is there a session" check: a Server
 * Action is reachable by POST without the page that renders it, so an account
 * still inside the D-185 enrolment window would otherwise move children between
 * groups behind one password.
 */
async function actor(): Promise<ActorContext> {
  const session = await requireEnrolledSession();
  return { principal: { personId: session.person.id }, at: new Date() };
}

/**
 * Turns a thrown refusal into a redirect the screen can explain.
 *
 * `PermissionDeniedError` is logged by the guard itself, so it is not logged
 * again here. A validation or domain refusal is logged at debug — it is an
 * ordinary outcome of a person typing something, not an incident.
 *
 * The error KEY travels in the URL and the message does not: the screen renders
 * the Dutch sentence from the catalogue. That keeps a group move's reason —
 * free text written about a named child — out of a proxy access log.
 */
function refusal(error: unknown, back: string): never {
  if (error instanceof PermissionDeniedError) {
    redirect(`${back}?error=denied`);
  }
  if (error instanceof GroupFullError) {
    redirect(`${back}?error=groupFull`);
  }
  if (error instanceof GroupMoveError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof IntervalError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ScheduleError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof FacilityError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof AttendanceError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof AssessmentError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ApiError) {
    actionLogger.debug(
      { event: "groups.action.rejected", code: error.code },
      "a groups action was rejected by validation",
    );
    redirect(`${back}?error=validation`);
  }
  throw error;
}

/** `redirect()` throws a control-flow signal Next must see; never swallow it. */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

async function run(
  back: string,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (isRedirect(error)) throw error;
    refusal(error, back);
  }
}

// ── groups ──────────────────────────────────────────────────────────────────

export async function createGroupAction(formData: FormData): Promise<void> {
  let created: { id: string } | null = null;
  await run("/groups", async () => {
    created = await createGroup(await actor(), {
      name: formData.get("name"),
      capacity: formData.get("capacity"),
    });
  });
  revalidatePath("/groups");
  if (created) redirect(`/groups/${(created as { id: string }).id}`);
}

export async function updateGroupAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}`, async () => {
    await updateGroup(await actor(), groupId, {
      name: formData.get("name"),
      capacity: formData.get("capacity"),
      active: formData.get("active"),
      // `?? undefined`, unlike `active` above: the screen renders no select
      // and no hidden field when the caller has no levels to offer (see
      // `groups/[groupId]/page.tsx`), and a save from that state must leave
      // the column alone rather than clear a level the caller cannot see.
      courseLevelId: formData.get("courseLevelId") ?? undefined,
    });
  });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?saved=group`);
}

// ── instructors ─────────────────────────────────────────────────────────────

export async function assignInstructorAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}`, async () => {
    await assignInstructor(await actor(), groupId, {
      personId: formData.get("personId"),
      role: formData.get("role"),
      fromDate: formData.get("fromDate"),
    });
  });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?saved=instructor`);
}

export async function endInstructorAssignmentAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}`, async () => {
    await endInstructorAssignment(await actor(), groupId, {
      personId: formData.get("personId"),
      toDate: formData.get("toDate"),
    });
  });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?saved=instructorEnded`);
}

// ── placements and moves ────────────────────────────────────────────────────

export async function placeStudentAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}`, async () => {
    await placeStudentInGroup(await actor(), groupId, {
      studentProfileId: formData.get("studentProfileId"),
      fromDate: formData.get("fromDate"),
      reason: formData.get("reason"),
      overrideCapacity: formData.get("overrideCapacity") === "on",
    });
  });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?saved=placed`);
}

/**
 * ONE ACTION, THREE DIRECTIONS. `direction` is an ordinary select on the form
 * and this function does not read it — see the file comment.
 */
export async function moveStudentAction(formData: FormData): Promise<void> {
  const fromGroupId = String(formData.get("fromGroupId") ?? "");
  await run(`/groups/${fromGroupId}`, async () => {
    await moveStudent(await actor(), {
      studentProfileId: formData.get("studentProfileId"),
      fromGroupId,
      toGroupId: formData.get("toGroupId"),
      direction: formData.get("direction"),
      reason: formData.get("reason"),
      occurredAt: formData.get("occurredAt"),
      overrideCapacity: formData.get("overrideCapacity") === "on",
    });
  });
  revalidatePath(`/groups/${fromGroupId}`);
  revalidatePath(`/groups/${String(formData.get("toGroupId") ?? "")}`);
  redirect(`/groups/${fromGroupId}?saved=moved`);
}

export async function endMembershipAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}`, async () => {
    await endGroupMembership(await actor(), groupId, {
      studentProfileId: formData.get("studentProfileId"),
      toDate: formData.get("toDate"),
    });
  });
  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}?saved=membershipEnded`);
}

// ── schedule ────────────────────────────────────────────────────────────────

export async function createRecurrenceAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}/schedule`, async () => {
    await createRecurrence(await actor(), groupId, {
      poolId: formData.get("poolId"),
      weekday: formData.get("weekday"),
      startTime: formData.get("startTime"),
      durationMinutes: formData.get("durationMinutes"),
      startsOn: formData.get("startsOn"),
      endsOn: formData.get("endsOn"),
    });
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/schedule?saved=recurrence`);
}

/**
 * Generates a term and reports what happened in the URL.
 *
 * The COUNTS travel back, not just a success flag: an administrator who asked
 * for a term and got 34 lessons where they expected 36 has to be able to see
 * that two were skipped, or the only way to tell a working holiday calendar
 * from a broken generator is to count rows. They are integers about a timetable,
 * so a URL is a safe place for them.
 */
export async function generateSessionsAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  let created = 0;
  let planned = 0;
  let skipped = 0;
  await run(`/groups/${groupId}/schedule`, async () => {
    const report = await generateSessions(await actor(), groupId, {
      from: formData.get("from"),
      to: formData.get("to"),
    });
    created = report.created;
    planned = report.planned;
    skipped = report.skipped.length;
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(
    `/groups/${groupId}/schedule?generated=${created}&planned=${planned}&skipped=${skipped}`,
  );
}

/**
 * Corrects a season's weekday, time, length or pool.
 *
 * THE COUNTS TRAVEL BACK, for the same reason `generateSessionsAction`'s do:
 * this edit rewrites lessons the person cannot see from the form, and *"twaalf
 * lessen verschoven, één ervan op de kerstsluiting"* is the only way to learn
 * that before somebody drives to the pool. They are integers and a date about a
 * timetable, so a URL is a safe place for them.
 */
export async function updateRecurrenceAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  let moved = 0;
  let onClosure = 0;
  let movedTo = "";
  await run(`/groups/${groupId}/schedule`, async () => {
    const report = await updateRecurrence(
      await actor(),
      String(formData.get("recurrenceId") ?? ""),
      {
        poolId: formData.get("poolId"),
        weekday: formData.get("weekday"),
        startTime: formData.get("startTime"),
        durationMinutes: formData.get("durationMinutes"),
      },
    );
    moved = report.moved;
    onClosure = report.onClosure;
    movedTo = report.startsOn ?? "";
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(
    `/groups/${groupId}/schedule?updated=${moved}&onClosure=${onClosure}` +
      `&movedTo=${encodeURIComponent(movedTo)}`,
  );
}

/**
 * Stops a rule producing new lessons.
 *
 * The service has existed since phase 1.6 and no screen called it, so a
 * recurrence typed with the wrong weekday could only be worked around by
 * cancelling every lesson it produced, one at a time, with a reason each. It
 * DEACTIVATES rather than deletes — see `deactivateRecurrence` for why the
 * generated lessons make deletion the wrong operation.
 *
 * IT IS NOT HOW A MISTYPED RULE IS CORRECTED, and never was: deactivating
 * leaves every lesson the rule already produced on the timetable, so a
 * replacement series generates its own beside them and the club gets two
 * lessons that evening. `updateRecurrence` is the correction; this is for a
 * series the club has genuinely finished with.
 */
export async function deactivateRecurrenceAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}/schedule`, async () => {
    await deactivateRecurrence(
      await actor(),
      String(formData.get("recurrenceId") ?? ""),
    );
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/schedule?saved=recurrenceStopped`);
}

export async function createClosureAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const scope = String(formData.get("scope") ?? "club");
  await run(`/groups/${groupId}/schedule`, async () => {
    await createClosure(await actor(), {
      // "club" is the ordinary case and is what the form defaults to.
      groupId: scope === "group" ? groupId : null,
      fromDate: formData.get("fromDate"),
      toDate: formData.get("toDate"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/schedule?saved=closure`);
}

/**
 * Corrects a closure's dates or its reason.
 *
 * A closure typed with the wrong month is a fortnight of lessons the generator
 * silently does not produce, and until now the only way out was to leave it
 * there. Correcting it changes what will be GENERATED and nothing that already
 * exists — see `updateClosure`.
 */
export async function updateClosureAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}/schedule`, async () => {
    await updateClosure(
      await actor(),
      String(formData.get("closureId") ?? ""),
      {
        fromDate: formData.get("fromDate"),
        toDate: formData.get("toDate"),
        reason: formData.get("reason"),
      },
    );
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/schedule?saved=closureUpdated`);
}

// ── lanes ───────────────────────────────────────────────────────────────────

/**
 * Sets which lanes a season's lessons use.
 *
 * `getAll` AND NOT `get`. A set of checkboxes posts the ticked ones as repeated
 * fields of the same name and posts NOTHING when they are all unticked, so
 * `get("laneIds")` would read a three-lane selection as one lane and an emptied
 * one as null. `getAll` returns `[]` for the empty case, which is the value that
 * means *"no lanes recorded for this series"* — a real answer, not an absence.
 */
export async function setRecurrenceLanesAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  await run(`/groups/${groupId}/schedule`, async () => {
    await setRecurrenceLanes(
      await actor(),
      String(formData.get("recurrenceId") ?? ""),
      { laneIds: formData.getAll("laneIds") },
    );
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/schedule?saved=recurrenceLanes`);
}

/**
 * Gives one lesson lanes of its own.
 *
 * Back to the LESSON and not to the schedule: the person is looking at one
 * lesson, and a redirect that dropped them into a year of them would make them
 * find it again to see whether the change took.
 */
export async function overrideSessionLanesAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await run(`/groups/${groupId}/sessions/${sessionId}`, async () => {
    await overrideSessionLanes(await actor(), sessionId, {
      laneIds: formData.getAll("laneIds"),
    });
  });
  revalidatePath(`/groups/${groupId}/sessions/${sessionId}`);
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/sessions/${sessionId}?saved=lanesOverridden`);
}

/** Returns one lesson to following its season's lanes. */
export async function clearSessionLaneOverrideAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await run(`/groups/${groupId}/sessions/${sessionId}`, async () => {
    await clearSessionLaneOverride(await actor(), sessionId);
  });
  revalidatePath(`/groups/${groupId}/sessions/${sessionId}`);
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/sessions/${sessionId}?saved=lanesCleared`);
}

export async function cancelSessionAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await run(`/groups/${groupId}/schedule`, async () => {
    await cancelSession(await actor(), sessionId, {
      reason: formData.get("reason"),
    });
  });
  revalidatePath(`/groups/${groupId}/schedule`);
  redirect(`/groups/${groupId}/schedule?saved=cancelled`);
}

// ── roster ──────────────────────────────────────────────────────────────────

export async function addGuestAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await run(`/groups/${groupId}/sessions/${sessionId}`, async () => {
    await addGuestToSession(await actor(), sessionId, {
      studentProfileId: formData.get("studentProfileId"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(`/groups/${groupId}/sessions/${sessionId}`);
  redirect(`/groups/${groupId}/sessions/${sessionId}?saved=guest`);
}

export async function removeGuestAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await run(`/groups/${groupId}/sessions/${sessionId}`, async () => {
    await removeGuestFromSession(
      await actor(),
      sessionId,
      String(formData.get("studentProfileId") ?? ""),
    );
  });
  revalidatePath(`/groups/${groupId}/sessions/${sessionId}`);
  redirect(`/groups/${groupId}/sessions/${sessionId}?saved=guestRemoved`);
}

// ── attendance ──────────────────────────────────────────────────────────────

/**
 * Registers the lesson's attendance — one form, one service call, one
 * transaction (`01-domain-model.md` §4: partial attendance is not a valid
 * state). The pupils are enumerated by repeated `studentProfileIds` fields;
 * each pupil's state, idempotency key and optional note travel in fields
 * suffixed with their id. The `clientEventId`s were generated when the form
 * RENDERED, which is what makes a double-submit collapse to one write (P-02).
 */
export async function registerAttendanceAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const back = `/groups/${groupId}/sessions/${sessionId}`;
  await run(back, async () => {
    const entries = formData
      .getAll("studentProfileIds")
      .map((raw) => String(raw))
      .map((studentProfileId) => ({
        studentProfileId,
        state: formData.get(`state_${studentProfileId}`),
        clientEventId: formData.get(`client_${studentProfileId}`),
        note: formData.get(`note_${studentProfileId}`),
      }));
    await registerSessionAttendance(await actor(), sessionId, { entries });
  });
  revalidatePath(back);
  redirect(`${back}?saved=attendance`);
}

export async function amendAttendanceAction(formData: FormData): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const back = `/groups/${groupId}/sessions/${sessionId}`;
  await run(back, async () => {
    await amendAttendance(await actor(), sessionId, {
      studentProfileId: formData.get("studentProfileId"),
      state: formData.get("state"),
      clientEventId: formData.get("clientEventId"),
      supersedesEventId: formData.get("supersedesEventId"),
      note: formData.get("note"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=attendanceAmended`);
}

// ── assessment (phase 2.3) ───────────────────────────────────────────────────

/**
 * Records one aftest sitting — one student, every criterion of the pinned
 * set, in one call. `criterionId_${criterionId}` names the grade select and
 * `waiver_${criterionId}`/`waiverReason_${criterionId}` the waiver pair; a
 * criterion with neither posted is left out of `results`/`waivers`
 * entirely, which is what makes D-086's "never an outcome over an unset
 * criterion" a server-side refusal (`INCOMPLETE`) rather than a client trick.
 */
export async function recordAssessmentAction(
  formData: FormData,
): Promise<void> {
  const groupId = String(formData.get("groupId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const back = `/groups/${groupId}/sessions/${sessionId}`;
  await run(back, async () => {
    const criterionIds = formData
      .getAll("criterionIds")
      .map((raw) => String(raw));

    const results: {
      criterionId: string;
      gradeValueId: FormDataEntryValue;
      remark?: FormDataEntryValue;
    }[] = [];
    const waivers: {
      criterionId: string;
      reason: FormDataEntryValue;
    }[] = [];

    for (const criterionId of criterionIds) {
      const waived = formData.get(`waiver_${criterionId}`);
      if (waived) {
        waivers.push({
          criterionId,
          reason: formData.get(`waiverReason_${criterionId}`) ?? "",
        });
        continue;
      }
      const gradeValueId = formData.get(`grade_${criterionId}`);
      if (gradeValueId && String(gradeValueId).length > 0) {
        results.push({ criterionId, gradeValueId });
      }
    }

    await recordAssessment(await actor(), sessionId, {
      studentProfileId: formData.get("studentProfileId"),
      criterionSetId: formData.get("criterionSetId"),
      clientEventId: formData.get("clientEventId"),
      remark: formData.get("remark"),
      results,
      waivers,
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=assessment`);
}

// ── facilities ──────────────────────────────────────────────────────────────

export async function createPoolAction(formData: FormData): Promise<void> {
  await run("/groups/pools", async () => {
    await createPool(await actor(), {
      name: formData.get("name"),
      lengthMetres: formData.get("lengthMetres"),
    });
  });
  revalidatePath("/groups/pools");
  redirect("/groups/pools?saved=pool");
}

/**
 * Corrects a pool.
 *
 * THE SUBJECT COMES FROM THE FORM AND THE PERMISSION IS CHECKED IN THE SERVICE,
 * which is the same division every action in this file follows. `poolId` in a
 * hidden field is not a weakness: it names WHICH pool, and `updatePool` guards
 * `planning.manage` at the organisation before it reads the row — so a caller
 * who reached the screen on `planning.read` alone is refused here whichever id
 * they post.
 */
export async function updatePoolAction(formData: FormData): Promise<void> {
  await run("/groups/pools", async () => {
    await updatePool(await actor(), String(formData.get("poolId") ?? ""), {
      name: formData.get("name"),
      lengthMetres: formData.get("lengthMetres"),
      // Not `?? undefined`: an unchecked box posts nothing, and reading that
      // as "leave it alone" would make the flag one-way. `updateGroupAction`
      // reads it the same way.
      active: formData.get("active"),
    });
  });
  revalidatePath("/groups/pools");
  revalidatePath("/groups", "layout");
  redirect("/groups/pools?saved=poolUpdated");
}

export async function createLaneAction(formData: FormData): Promise<void> {
  await run("/groups/pools", async () => {
    await createLane(await actor(), String(formData.get("poolId") ?? ""), {
      name: formData.get("name"),
      sequence: formData.get("sequence"),
    });
  });
  revalidatePath("/groups/pools");
  revalidatePath("/groups", "layout");
  redirect("/groups/pools?saved=lane");
}

export async function updateLaneAction(formData: FormData): Promise<void> {
  await run("/groups/pools", async () => {
    await updateLane(await actor(), String(formData.get("laneId") ?? ""), {
      name: formData.get("name"),
      sequence: formData.get("sequence"),
    });
  });
  revalidatePath("/groups/pools");
  revalidatePath("/groups", "layout");
  redirect("/groups/pools?saved=laneUpdated");
}
