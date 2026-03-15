import { type Prisma } from '@prisma/client';

import { APP_ROLES, CAPABILITIES, type AuthContext } from '@/lib/authz';
import {
  ORGANIZATION_ADMIN_ACTIONS,
  resolveMembershipActionAvailability,
} from '@/lib/organization-admin-action-core';
import { prisma } from '@/lib/prisma';

const adminRoles = [APP_ROLES.OWNER, APP_ROLES.ADMIN] as const;

type OrganizationMembership = NonNullable<AuthContext['membership']>;

export type OrganizationShellSummary = {
  organization: {
    id: string;
    slug: string;
    name: string;
    memberCount: number;
    ownerCount: number;
    adminCount: number;
    activeAuditLogCount: number;
  };
  currentMembership: {
    id: string;
    role: OrganizationMembership['role'];
  };
  members: Array<{
    id: string;
    role: OrganizationMembership['role'];
    isActive: boolean;
    createdAt: Date;
    user: {
      id: string;
      name: string | null;
      email: string;
      isActive: boolean;
      emailVerified: boolean;
    };
    availableActions: {
      canActivate: boolean;
      canDeactivate: boolean;
      canManageRoles: boolean;
      preparedHooks: Array<(typeof ORGANIZATION_ADMIN_ACTIONS)[keyof typeof ORGANIZATION_ADMIN_ACTIONS]>;
    };
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorType: string;
    createdAt: Date;
    actorUser: {
      id: string;
      name: string | null;
      email: string;
    } | null;
    metadata: Prisma.JsonValue;
  }>;
};

export function canAccessOrganizationAdmin(authContext: AuthContext) {
  return authContext.capabilities.includes(CAPABILITIES.organizationAdmin);
}

export async function getOrganizationAdminSummary(
  authContext: AuthContext,
): Promise<OrganizationShellSummary | null> {
  if (!authContext.membership || !canAccessOrganizationAdmin(authContext)) {
    return null;
  }

  const currentMembership = authContext.membership;
  const organizationId = currentMembership.organization.id;

  const [memberCount, roleBreakdown, activeAuditLogCount, members, auditLogs] = await Promise.all([
    prisma.organizationMember.count({
      where: {
        organizationId,
        isActive: true,
      },
    }),
    prisma.organizationMember.groupBy({
      by: ['role'],
      where: {
        organizationId,
        isActive: true,
        role: {
          in: [...adminRoles, APP_ROLES.MEMBER],
        },
      },
      _count: {
        role: true,
      },
    }),
    prisma.auditLog.count({
      where: {
        organizationId,
      },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId,
      },
      orderBy: [
        {
          role: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
      select: {
        id: true,
        role: true,
        isActive: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            emailVerified: true,
          },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorType: true,
        createdAt: true,
        metadata: true,
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const ownerCount = roleBreakdown.find((item) => item.role === APP_ROLES.OWNER)?._count.role ?? 0;
  const adminCount = roleBreakdown.find((item) => item.role === APP_ROLES.ADMIN)?._count.role ?? 0;

  return {
    organization: {
      id: currentMembership.organization.id,
      slug: currentMembership.organization.slug,
      name: currentMembership.organization.name,
      memberCount,
      ownerCount,
      adminCount,
      activeAuditLogCount,
    },
    currentMembership: {
      id: currentMembership.id,
      role: currentMembership.role,
    },
    members: members.map((member) => ({
      ...member,
      availableActions: {
        ...resolveMembershipActionAvailability({
          isActive: member.isActive,
          isCurrentMembership: member.id === currentMembership.id,
          currentUserRole: currentMembership.role,
          targetRole: member.role,
        }),
        preparedHooks: [
          ORGANIZATION_ADMIN_ACTIONS.viewRole,
          ORGANIZATION_ADMIN_ACTIONS.activateMembership,
          ORGANIZATION_ADMIN_ACTIONS.deactivateMembership,
          ORGANIZATION_ADMIN_ACTIONS.updateMembershipRole,
        ],
      },
    })),
    auditLogs,
  };
}
