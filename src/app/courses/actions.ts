"use server";

/**
 * The `courses` area's Server Actions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ACTION IS A THIN SHELL AROUND A SERVICE, AND THAT IS THE POINT
 *
 * A Server Action is an unauthenticated HTTP endpoint until something
 * authenticates it, and it accepts a `FormData` from anywhere — not only from
 * the form that rendered it. So nothing here decides anything: each action
 * resolves the session, hands the raw fields to the service, and lets the
 * service run `requirePermission`, validate the input and write the audit
 * event. There is no branch in this file that reads or writes a table.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ENROLMENT ACTIONS TAKE A `back` PATH, AND NOTHING ELSE DOES
 *
 * Enrolling happens on a PERSON's screen — that is where somebody knows which
 * pupil they mean — while the operation belongs to this module. So the two
 * enrolment actions carry the path to return to, validated against a fixed
 * prefix before it is used. An unchecked redirect target from a form field is
 * an open redirect, and the fact that this one only ever points inside the
 * application is a property worth enforcing rather than assuming.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  createCourse,
  createCourseLevel,
  CourseLevelError,
  endEnrolment,
  enrolStudent,
  EnrolmentError,
  updateCourse,
  updateCourseLevel,
  type ActorContext,
} from "@/modules/courses";

const actionLogger = logger.child({ component: "courses.actions" });

/**
 * The actor, from the SESSION — never from a form field.
 *
 * `requireEnrolledSession` and not a bare "is there a session" check: a Server
 * Action is reachable by POST without the page that renders it, so an account
 * still inside the D-185 enrolment window would otherwise sign children up for
 * courses behind one password.
 */
async function actor(): Promise<ActorContext> {
  const session = await requireEnrolledSession();
  return { principal: { personId: session.person.id }, at: new Date() };
}

/**
 * Turns a thrown refusal into a redirect the screen can explain.
 *
 * The error KEY travels in the URL and the message does not: the screen renders
 * the Dutch sentence from the catalogue.
 */
function refusal(error: unknown, back: string): never {
  if (error instanceof PermissionDeniedError) {
    redirect(`${back}?error=denied`);
  }
  if (error instanceof CourseLevelError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof EnrolmentError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ApiError) {
    actionLogger.debug(
      { event: "courses.action.rejected", code: error.code },
      "a courses action was rejected by validation",
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

/**
 * The person screen this enrolment came from, or the courses list.
 *
 * ONE SHAPE ONLY: `/people/<id>`. Anything else — an absolute URL, a protocol,
 * a path traversal, a second segment — falls back to `/courses`. A redirect
 * target read out of a `FormData` is attacker-supplied, and "it comes from our
 * own form" is exactly the assumption an open redirect is built on.
 */
function personPath(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  return /^\/people\/[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "/courses";
}

// ── courses ─────────────────────────────────────────────────────────────────

export async function createCourseAction(formData: FormData): Promise<void> {
  let created: { id: string } | null = null;
  await run("/courses", async () => {
    created = await createCourse(await actor(), {
      name: formData.get("name"),
      description: formData.get("description"),
    });
  });
  revalidatePath("/courses");
  if (created) redirect(`/courses/${(created as { id: string }).id}`);
}

export async function updateCourseAction(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId") ?? "");
  await run(`/courses/${courseId}`, async () => {
    await updateCourse(await actor(), courseId, {
      name: formData.get("name"),
      description: formData.get("description"),
      // Not `?? undefined`: an unchecked box posts nothing, and reading that as
      // "leave it alone" would make the flag one-way.
      active: formData.get("active"),
    });
  });
  revalidatePath(`/courses/${courseId}`);
  revalidatePath("/courses");
  redirect(`/courses/${courseId}?saved=course`);
}

// ── levels ──────────────────────────────────────────────────────────────────

export async function createCourseLevelAction(
  formData: FormData,
): Promise<void> {
  const courseId = String(formData.get("courseId") ?? "");
  await run(`/courses/${courseId}`, async () => {
    await createCourseLevel(await actor(), courseId, {
      name: formData.get("name"),
      sequence: formData.get("sequence"),
    });
  });
  revalidatePath(`/courses/${courseId}`);
  redirect(`/courses/${courseId}?saved=level`);
}

export async function updateCourseLevelAction(
  formData: FormData,
): Promise<void> {
  const courseId = String(formData.get("courseId") ?? "");
  await run(`/courses/${courseId}`, async () => {
    await updateCourseLevel(
      await actor(),
      String(formData.get("levelId") ?? ""),
      { name: formData.get("name"), sequence: formData.get("sequence") },
    );
  });
  revalidatePath(`/courses/${courseId}`);
  redirect(`/courses/${courseId}?saved=levelUpdated`);
}

// ── enrolments ──────────────────────────────────────────────────────────────

/**
 * Signs a pupil up for a course.
 *
 * `studentProfileId` comes from the form and the permission is checked in the
 * service, which is the division every action in this area follows: the form
 * supplies the SUBJECT, the session supplies the ACTOR, and `enrolStudent`
 * guards `enrolments.manage` on the COURSE before it writes anything.
 */
export async function enrolStudentAction(formData: FormData): Promise<void> {
  const back = personPath(formData.get("back"));
  await run(back, async () => {
    await enrolStudent(await actor(), String(formData.get("courseId") ?? ""), {
      studentProfileId: formData.get("studentProfileId"),
      status: formData.get("status"),
      startedAt: formData.get("startedAt"),
    });
  });
  revalidatePath(back);
  revalidatePath("/courses");
  redirect(`${back}?saved=enrolled`);
}

/** Ends the open enrolment. The row stays; only `endedAt` is written. */
export async function endEnrolmentAction(formData: FormData): Promise<void> {
  const back = personPath(formData.get("back"));
  await run(back, async () => {
    await endEnrolment(await actor(), String(formData.get("courseId") ?? ""), {
      studentProfileId: formData.get("studentProfileId"),
      endedAt: formData.get("endedAt"),
    });
  });
  revalidatePath(back);
  revalidatePath("/courses");
  redirect(`${back}?saved=enrolmentEnded`);
}
