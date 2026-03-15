import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';

export type SwimGroupSummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  groups: Array<{
    id: string;
    name: string;
    swimLevel: string;
    isActive: boolean;
    memberCount: number;
    createdAt: Date;
  }>;
  metrics: {
    totalGroups: number;
    activeGroups: number;
    inactiveGroups: number;
  };
};

export type SwimGroupDetail = {
  id: string;
  name: string;
  swimLevel: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  members: Array<{
    membershipId: string;
    studentId: string;
    displayName: string;
    firstName: string;
    lastName: string;
    swimLevel: string;
    isActive: boolean;
    enrolledAt: Date;
  }>;
};

export async function getSwimGroupSummary(
  authContext: AuthContext,
): Promise<SwimGroupSummary | null> {
  if (!authContext.membership) {
    return null;
  }

  const organizationId = authContext.membership.organization.id;

  const [groups, totalGroups, activeGroups] = await Promise.all([
    prisma.swimGroup.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        swimLevel: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            memberships: {
              where: {
                student: { isActive: true },
              },
            },
          },
        },
      },
    }),
    prisma.swimGroup.count({ where: { organizationId } }),
    prisma.swimGroup.count({ where: { organizationId, isActive: true } }),
  ]);

  return {
    organization: authContext.membership.organization,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      swimLevel: group.swimLevel,
      isActive: group.isActive,
      memberCount: group._count.memberships,
      createdAt: group.createdAt,
    })),
    metrics: {
      totalGroups,
      activeGroups,
      inactiveGroups: totalGroups - activeGroups,
    },
  };
}

export async function getSwimGroupDetail(
  authContext: AuthContext,
  groupId: string,
): Promise<SwimGroupDetail | null> {
  if (!authContext.membership) {
    return null;
  }

  const group = await prisma.swimGroup.findFirst({
    where: {
      id: groupId,
      organizationId: authContext.membership.organization.id,
    },
    select: {
      id: true,
      name: true,
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
      memberships: {
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

  if (!group) {
    return null;
  }

  return {
    id: group.id,
    name: group.name,
    swimLevel: group.swimLevel,
    isActive: group.isActive,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    organization: group.organization,
    members: group.memberships.map((m) => ({
      membershipId: m.id,
      studentId: m.student.id,
      displayName: `${m.student.firstName} ${m.student.lastName}`,
      firstName: m.student.firstName,
      lastName: m.student.lastName,
      swimLevel: m.student.swimLevel,
      isActive: m.student.isActive,
      enrolledAt: m.createdAt,
    })),
  };
}

export async function getStudentGroupMemberships(
  authContext: AuthContext,
  studentId: string,
): Promise<
  Array<{
    membershipId: string;
    groupId: string;
    groupName: string;
    swimLevel: string;
    groupIsActive: boolean;
    enrolledAt: Date;
  }>
> {
  if (!authContext.membership) {
    return [];
  }

  const memberships = await prisma.groupMembership.findMany({
    where: {
      studentId,
      student: {
        organizationId: authContext.membership.organization.id,
      },
    },
    orderBy: { group: { name: 'asc' } },
    select: {
      id: true,
      createdAt: true,
      group: {
        select: {
          id: true,
          name: true,
          swimLevel: true,
          isActive: true,
        },
      },
    },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    groupId: m.group.id,
    groupName: m.group.name,
    swimLevel: m.group.swimLevel,
    groupIsActive: m.group.isActive,
    enrolledAt: m.createdAt,
  }));
}

export async function getEnrollableStudents(
  authContext: AuthContext,
  groupId: string,
): Promise<
  Array<{
    id: string;
    displayName: string;
    swimLevel: string;
    isActive: boolean;
  }>
> {
  if (!authContext.membership) {
    return [];
  }

  const organizationId = authContext.membership.organization.id;

  const students = await prisma.student.findMany({
    where: {
      organizationId,
      isActive: true,
      groupMemberships: {
        none: { groupId },
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
