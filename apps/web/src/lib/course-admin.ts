import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';

export type CourseSummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  courses: Array<{
    id: string;
    name: string;
    description: string | null;
    swimLevel: string;
    isActive: boolean;
    skillCount: number;
    enrollmentCount: number;
    createdAt: Date;
  }>;
  metrics: {
    totalCourses: number;
    activeCourses: number;
    inactiveCourses: number;
  };
};

export type CourseDetail = {
  id: string;
  name: string;
  description: string | null;
  swimLevel: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  skills: Array<{
    courseSkillId: string;
    skillId: string;
    skillName: string;
    skillSwimLevel: string;
    skillIsActive: boolean;
    sortOrder: number;
  }>;
  enrollments: Array<{
    enrollmentId: string;
    studentId: string;
    displayName: string;
    firstName: string;
    lastName: string;
    swimLevel: string;
    studentIsActive: boolean;
    enrolledAt: Date;
  }>;
};

export async function getCourseSummary(
  authContext: AuthContext,
): Promise<CourseSummary | null> {
  if (!authContext.membership) {
    return null;
  }

  const organizationId = authContext.membership.organization.id;

  const [courses, totalCourses, activeCourses] = await Promise.all([
    prisma.course.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        swimLevel: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            courseSkills: true,
            enrollments: {
              where: {
                student: { isActive: true },
              },
            },
          },
        },
      },
    }),
    prisma.course.count({ where: { organizationId } }),
    prisma.course.count({ where: { organizationId, isActive: true } }),
  ]);

  return {
    organization: authContext.membership.organization,
    courses: courses.map((course) => ({
      id: course.id,
      name: course.name,
      description: course.description,
      swimLevel: course.swimLevel,
      isActive: course.isActive,
      skillCount: course._count.courseSkills,
      enrollmentCount: course._count.enrollments,
      createdAt: course.createdAt,
    })),
    metrics: {
      totalCourses,
      activeCourses,
      inactiveCourses: totalCourses - activeCourses,
    },
  };
}

export async function getCourseDetail(
  authContext: AuthContext,
  courseId: string,
): Promise<CourseDetail | null> {
  if (!authContext.membership) {
    return null;
  }

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      organizationId: authContext.membership.organization.id,
    },
    select: {
      id: true,
      name: true,
      description: true,
      swimLevel: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      courseSkills: {
        orderBy: [{ sortOrder: 'asc' }, { skill: { name: 'asc' } }],
        select: {
          id: true,
          sortOrder: true,
          skill: {
            select: {
              id: true,
              name: true,
              swimLevel: true,
              isActive: true,
            },
          },
        },
      },
      enrollments: {
        orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
        select: {
          id: true,
          createdAt: true,
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              swimLevel: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!course) {
    return null;
  }

  return {
    id: course.id,
    name: course.name,
    description: course.description,
    swimLevel: course.swimLevel,
    isActive: course.isActive,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    organization: course.organization,
    skills: course.courseSkills.map((cs) => ({
      courseSkillId: cs.id,
      skillId: cs.skill.id,
      skillName: cs.skill.name,
      skillSwimLevel: cs.skill.swimLevel,
      skillIsActive: cs.skill.isActive,
      sortOrder: cs.sortOrder,
    })),
    enrollments: course.enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.student.id,
      displayName: `${e.student.firstName} ${e.student.lastName}`,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      swimLevel: e.student.swimLevel,
      studentIsActive: e.student.isActive,
      enrolledAt: e.createdAt,
    })),
  };
}

export async function getEnrollableStudentsForCourse(
  authContext: AuthContext,
  courseId: string,
): Promise<Array<{ id: string; displayName: string; swimLevel: string; isActive: boolean }>> {
  if (!authContext.membership) {
    return [];
  }

  const organizationId = authContext.membership.organization.id;

  const students = await prisma.student.findMany({
    where: {
      organizationId,
      isActive: true,
      courseEnrollments: {
        none: { courseId },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      swimLevel: true,
      isActive: true,
    },
  });

  return students.map((s) => ({
    id: s.id,
    displayName: `${s.firstName} ${s.lastName}`,
    swimLevel: s.swimLevel,
    isActive: s.isActive,
  }));
}
