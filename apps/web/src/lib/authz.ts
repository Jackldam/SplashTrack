import { OrganizationMemberRole } from '@prisma/client';
import { redirect } from 'next/navigation';

import { getAuthSession } from '@/lib/auth-session';
import { prisma } from '@/lib/prisma';

export const APP_ROLES = {
  OWNER: OrganizationMemberRole.OWNER,
  ADMIN: OrganizationMemberRole.ADMIN,
  MEMBER: OrganizationMemberRole.MEMBER,
} as const;

export type AppRole = (typeof APP_ROLES)[keyof typeof APP_ROLES];

export const CAPABILITIES = {
  dashboardAccess: 'dashboard:access',
  organizationAdmin: 'organization:admin',
  organizationOwner: 'organization:owner',
} as const;

export type AppCapability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const roleCapabilities: Record<AppRole, AppCapability[]> = {
  [APP_ROLES.OWNER]: [
    CAPABILITIES.dashboardAccess,
    CAPABILITIES.organizationAdmin,
    CAPABILITIES.organizationOwner,
  ],
  [APP_ROLES.ADMIN]: [CAPABILITIES.dashboardAccess, CAPABILITIES.organizationAdmin],
  [APP_ROLES.MEMBER]: [CAPABILITIES.dashboardAccess],
};

export type AuthContext = {
  session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;
  membership: {
    id: string;
    role: AppRole;
    organization: {
      id: string;
      name: string;
      slug: string;
    };
  } | null;
  capabilities: AppCapability[];
};

type AccessRequirement = {
  capability?: AppCapability;
  capabilities?: AppCapability[];
  role?: AppRole;
  roles?: AppRole[];
};

function collectCapabilities(role: AppRole | null) {
  if (!role) {
    return [] as AppCapability[];
  }

  return roleCapabilities[role];
}

function resolveAllowedCapabilities(requirement: AccessRequirement) {
  const required = new Set<AppCapability>();

  if (requirement.capability) {
    required.add(requirement.capability);
  }

  for (const capability of requirement.capabilities ?? []) {
    required.add(capability);
  }

  return [...required];
}

function resolveAllowedRoles(requirement: AccessRequirement) {
  const required = new Set<AppRole>();

  if (requirement.role) {
    required.add(requirement.role);
  }

  for (const role of requirement.roles ?? []) {
    required.add(role);
  }

  return [...required];
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await getAuthSession();

  if (!session?.user) {
    return null;
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      userId: session.user.id,
      isActive: true,
      organization: {
        isActive: true,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  const capabilities = collectCapabilities(membership?.role ?? null);

  return {
    session,
    membership: membership
      ? {
          id: membership.id,
          role: membership.role,
          organization: membership.organization,
        }
      : null,
    capabilities,
  };
}

export function hasRequiredAccess(context: AuthContext, requirement: AccessRequirement = {}) {
  const allowedRoles = resolveAllowedRoles(requirement);
  const allowedCapabilities = resolveAllowedCapabilities(requirement);

  if (allowedRoles.length > 0) {
    const currentRole = context.membership?.role;
    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return false;
    }
  }

  if (allowedCapabilities.length > 0) {
    return allowedCapabilities.every((capability) => context.capabilities.includes(capability));
  }

  return true;
}

export async function requireAuthContext(requirement: AccessRequirement = {}): Promise<AuthContext> {
  const context = await getAuthContext();

  if (!context?.session.user) {
    redirect('/login?redirectTo=/dashboard');
  }

  if (!hasRequiredAccess(context, requirement)) {
    redirect('/forbidden');
  }

  return context;
}
