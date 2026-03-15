import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';

export type OrganizationUserSummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  users: Array<{
    membershipId: string;
    userId: string;
    name: string | null;
    email: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    userIsActive: boolean;
    membershipIsActive: boolean;
    emailVerified: boolean;
    createdAt: Date;
  }>;
};

export type OrganizationUserDetail = OrganizationUserSummary['users'][number] & {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
};

export async function getOrganizationUsers(authContext: AuthContext): Promise<OrganizationUserSummary | null> {
  if (!authContext.membership) {
    return null;
  }

  const organizationId = authContext.membership.organization.id;

  const memberships = await prisma.organizationMember.findMany({
    where: {
      organizationId,
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
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
  });

  return {
    organization: authContext.membership.organization,
    users: memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      userIsActive: membership.user.isActive,
      membershipIsActive: membership.isActive,
      emailVerified: membership.user.emailVerified,
      createdAt: membership.createdAt,
    })),
  };
}

export async function getOrganizationUserDetail(
  authContext: AuthContext,
  membershipId: string,
): Promise<OrganizationUserDetail | null> {
  if (!authContext.membership) {
    return null;
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      id: membershipId,
      organizationId: authContext.membership.organization.id,
    },
    select: {
      id: true,
      role: true,
      isActive: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
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
  });

  if (!membership) {
    return null;
  }

  return {
    membershipId: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    userIsActive: membership.user.isActive,
    membershipIsActive: membership.isActive,
    emailVerified: membership.user.emailVerified,
    createdAt: membership.createdAt,
    organization: membership.organization,
  };
}
