import { redirect } from 'next/navigation';

import { getAuthSession } from '@/lib/auth-session';
import {
  APP_ROLES,
  CAPABILITIES,
  collectCapabilities,
  hasRequiredAccess,
  type AccessRequirement,
  type AppCapability,
  type AppRole,
} from '@/lib/authz-core';
import { prisma } from '@/lib/prisma';

export { APP_ROLES, CAPABILITIES, hasRequiredAccess };
export type { AccessRequirement, AppCapability, AppRole };

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
