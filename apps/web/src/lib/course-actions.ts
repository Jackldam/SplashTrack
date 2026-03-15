'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { parseCreateCourseFormData, parseUpdateCourseFormData } from '@/lib/course-forms';
import { getCourseDetail } from '@/lib/course-admin';

export type CourseActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

const DEFAULT_COURSE_ACTION_RESULT: CourseActionResult = {
  status: 'idle',
  message: '',
};

export async function createCourseAction(
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = parseCreateCourseFormData(formData);

  if (!parsed.success) {
    return { status: 'error', message: parsed.message };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await prisma.course.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name: parsed.data.name,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      status: 'error',
      message: `Een cursus met de naam "${parsed.data.name}" bestaat al in deze organization.`,
    };
  }

  const course = await prisma.$transaction(async (tx) => {
    const created = await tx.course.create({
      data: {
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        swimLevel: parsed.data.swimLevel,
        isActive: parsed.data.isActive,
      },
      select: { id: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'course.created',
        entityType: 'course',
        entityId: created.id,
        metadata: {
          courseId: created.id,
          name: created.name,
          swimLevel: parsed.data.swimLevel,
          isActive: parsed.data.isActive,
        },
      },
    });

    return created;
  });

  revalidatePath('/dashboard/courses');
  redirect(`/dashboard/courses/${course.id}`);
}

export async function updateCourseAction(
  courseId: string,
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = parseUpdateCourseFormData(formData);

  if (!parsed.success) {
    return { status: 'error', message: parsed.message };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await prisma.course.findFirst({
    where: { id: courseId, organizationId },
    select: { id: true, name: true, swimLevel: true, isActive: true },
  });

  if (!existing) {
    return { status: 'error', message: 'Cursus niet gevonden.' };
  }

  const nameConflict = await prisma.course.findFirst({
    where: {
      organizationId,
      name: parsed.data.name,
      id: { not: courseId },
    },
    select: { id: true },
  });

  if (nameConflict) {
    return {
      status: 'error',
      message: `Een andere cursus met de naam "${parsed.data.name}" bestaat al in deze organization.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.course.update({
      where: { id: courseId },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        swimLevel: parsed.data.swimLevel,
        isActive: parsed.data.isActive,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'course.updated',
        entityType: 'course',
        entityId: courseId,
        metadata: {
          courseId,
          before: {
            name: existing.name,
            swimLevel: existing.swimLevel,
            isActive: existing.isActive,
          },
          after: {
            name: parsed.data.name,
            swimLevel: parsed.data.swimLevel,
            isActive: parsed.data.isActive,
          },
        },
      },
    });
  });

  revalidatePath(`/dashboard/courses/${courseId}`);
  revalidatePath('/dashboard/courses');
  redirect(`/dashboard/courses/${courseId}`);
}

export async function toggleCourseLifecycleAction(
  courseId: string,
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  _formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;
  void _formData;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await getCourseDetail(authContext, courseId);

  if (!existing) {
    return { status: 'error', message: 'Cursus niet gevonden.' };
  }

  const nextIsActive = !existing.isActive;
  const auditAction = nextIsActive ? 'course.activated' : 'course.deactivated';

  await prisma.$transaction(async (tx) => {
    await tx.course.update({
      where: { id: courseId },
      data: { isActive: nextIsActive },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: auditAction,
        entityType: 'course',
        entityId: courseId,
        metadata: {
          courseId,
          name: existing.name,
          isActive: nextIsActive,
        },
      },
    });
  });

  revalidatePath(`/dashboard/courses/${courseId}`);
  revalidatePath('/dashboard/courses');

  return {
    status: 'success',
    message: nextIsActive
      ? `Cursus "${existing.name}" is opnieuw geactiveerd.`
      : `Cursus "${existing.name}" is gedeactiveerd.`,
  };
}

export async function addSkillToCourseAction(
  courseId: string,
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;
  const skillId = formData.get('skillId');

  if (typeof skillId !== 'string' || !skillId) {
    return { status: 'error', message: 'Geen vaardigheid geselecteerd.' };
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId },
    select: { id: true, name: true },
  });

  if (!course) {
    return { status: 'error', message: 'Cursus niet gevonden.' };
  }

  const skill = await prisma.skill.findFirst({
    where: { id: skillId, organizationId },
    select: { id: true, name: true },
  });

  if (!skill) {
    return { status: 'error', message: 'Vaardigheid niet gevonden.' };
  }

  const alreadyLinked = await prisma.courseSkill.findUnique({
    where: { courseId_skillId: { courseId, skillId } },
    select: { id: true },
  });

  if (alreadyLinked) {
    return { status: 'error', message: 'Vaardigheid is al gekoppeld aan deze cursus.' };
  }

  const maxSortOrder = await prisma.courseSkill.aggregate({
    where: { courseId },
    _max: { sortOrder: true },
  });

  const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.courseSkill.create({
      data: { courseId, skillId, sortOrder: nextSortOrder },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'course.skill_added',
        entityType: 'course',
        entityId: courseId,
        metadata: {
          courseId,
          courseName: course.name,
          skillId,
          skillName: skill.name,
        },
      },
    });
  });

  revalidatePath(`/dashboard/courses/${courseId}`);

  return { status: 'success', message: `Vaardigheid "${skill.name}" is gekoppeld aan ${course.name}.` };
}

export async function removeSkillFromCourseAction(
  courseId: string,
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;
  const skillId = formData.get('skillId');

  if (typeof skillId !== 'string' || !skillId) {
    return { status: 'error', message: 'Geen vaardigheid opgegeven.' };
  }

  const courseSkill = await prisma.courseSkill.findFirst({
    where: {
      courseId,
      skillId,
      course: { organizationId },
    },
    select: {
      id: true,
      course: { select: { name: true } },
      skill: { select: { name: true } },
    },
  });

  if (!courseSkill) {
    return { status: 'error', message: 'Koppeling niet gevonden.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.courseSkill.delete({ where: { id: courseSkill.id } });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'course.skill_removed',
        entityType: 'course',
        entityId: courseId,
        metadata: {
          courseId,
          courseName: courseSkill.course.name,
          skillId,
          skillName: courseSkill.skill.name,
        },
      },
    });
  });

  revalidatePath(`/dashboard/courses/${courseId}`);

  return {
    status: 'success',
    message: `Vaardigheid "${courseSkill.skill.name}" is ontkoppeld van ${courseSkill.course.name}.`,
  };
}

export async function enrollStudentInCourseAction(
  courseId: string,
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;
  const studentId = formData.get('studentId');

  if (typeof studentId !== 'string' || !studentId) {
    return { status: 'error', message: 'Geen student geselecteerd.' };
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, organizationId },
    select: { id: true, name: true },
  });

  if (!course) {
    return { status: 'error', message: 'Cursus niet gevonden.' };
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!student) {
    return { status: 'error', message: 'Student niet gevonden.' };
  }

  const alreadyEnrolled = await prisma.courseEnrollment.findUnique({
    where: { courseId_studentId: { courseId, studentId } },
    select: { id: true },
  });

  if (alreadyEnrolled) {
    return { status: 'error', message: 'Student is al ingeschreven in deze cursus.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.courseEnrollment.create({
      data: { courseId, studentId },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'course.student_enrolled',
        entityType: 'course',
        entityId: courseId,
        metadata: {
          courseId,
          courseName: course.name,
          studentId,
          studentName: `${student.firstName} ${student.lastName}`,
        },
      },
    });
  });

  revalidatePath(`/dashboard/courses/${courseId}`);
  revalidatePath(`/dashboard/students/${studentId}`);

  return { status: 'success', message: `${student.firstName} ${student.lastName} is ingeschreven in ${course.name}.` };
}

export async function removeStudentFromCourseAction(
  courseId: string,
  _previousStateUnused: CourseActionResult = DEFAULT_COURSE_ACTION_RESULT,
  formData: FormData,
): Promise<CourseActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;
  const studentId = formData.get('studentId');

  if (typeof studentId !== 'string' || !studentId) {
    return { status: 'error', message: 'Geen student opgegeven.' };
  }

  const enrollment = await prisma.courseEnrollment.findFirst({
    where: {
      courseId,
      studentId,
      course: { organizationId },
    },
    select: {
      id: true,
      course: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
    },
  });

  if (!enrollment) {
    return { status: 'error', message: 'Inschrijving niet gevonden.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.courseEnrollment.delete({ where: { id: enrollment.id } });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'course.student_removed',
        entityType: 'course',
        entityId: courseId,
        metadata: {
          courseId,
          courseName: enrollment.course.name,
          studentId,
          studentName: `${enrollment.student.firstName} ${enrollment.student.lastName}`,
        },
      },
    });
  });

  revalidatePath(`/dashboard/courses/${courseId}`);
  revalidatePath(`/dashboard/students/${studentId}`);

  return {
    status: 'success',
    message: `${enrollment.student.firstName} ${enrollment.student.lastName} is uitgeschreven uit ${enrollment.course.name}.`,
  };
}
