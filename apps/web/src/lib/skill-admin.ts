import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';

export type SkillSummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string | null;
    swimLevel: string;
    isActive: boolean;
    courseCount: number;
    studentCount: number;
    createdAt: Date;
  }>;
  metrics: {
    totalSkills: number;
    activeSkills: number;
    inactiveSkills: number;
  };
};

export type SkillDetail = {
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
  courses: Array<{
    courseSkillId: string;
    courseId: string;
    courseName: string;
    courseIsActive: boolean;
    sortOrder: number;
  }>;
};

export async function getSkillSummary(
  authContext: AuthContext,
): Promise<SkillSummary | null> {
  if (!authContext.membership) {
    return null;
  }

  const organizationId = authContext.membership.organization.id;

  const [skills, totalSkills, activeSkills] = await Promise.all([
    prisma.skill.findMany({
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
            studentSkills: true,
          },
        },
      },
    }),
    prisma.skill.count({ where: { organizationId } }),
    prisma.skill.count({ where: { organizationId, isActive: true } }),
  ]);

  return {
    organization: authContext.membership.organization,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      swimLevel: skill.swimLevel,
      isActive: skill.isActive,
      courseCount: skill._count.courseSkills,
      studentCount: skill._count.studentSkills,
      createdAt: skill.createdAt,
    })),
    metrics: {
      totalSkills,
      activeSkills,
      inactiveSkills: totalSkills - activeSkills,
    },
  };
}

export async function getSkillDetail(
  authContext: AuthContext,
  skillId: string,
): Promise<SkillDetail | null> {
  if (!authContext.membership) {
    return null;
  }

  const skill = await prisma.skill.findFirst({
    where: {
      id: skillId,
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
        orderBy: [{ sortOrder: 'asc' }, { course: { name: 'asc' } }],
        select: {
          id: true,
          sortOrder: true,
          course: {
            select: {
              id: true,
              name: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!skill) {
    return null;
  }

  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    swimLevel: skill.swimLevel,
    isActive: skill.isActive,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    organization: skill.organization,
    courses: skill.courseSkills.map((cs) => ({
      courseSkillId: cs.id,
      courseId: cs.course.id,
      courseName: cs.course.name,
      courseIsActive: cs.course.isActive,
      sortOrder: cs.sortOrder,
    })),
  };
}

export async function getAvailableSkillsForCourse(
  authContext: AuthContext,
  courseId: string,
): Promise<Array<{ id: string; name: string; swimLevel: string; isActive: boolean }>> {
  if (!authContext.membership) {
    return [];
  }

  const organizationId = authContext.membership.organization.id;

  const skills = await prisma.skill.findMany({
    where: {
      organizationId,
      isActive: true,
      courseSkills: {
        none: { courseId },
      },
    },
    orderBy: [{ swimLevel: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      swimLevel: true,
      isActive: true,
    },
  });

  return skills;
}
