import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAuthSession } from '@/auth/session';
import {
  APP_ROLES,
  CAPABILITIES,
  collectCapabilities,
  hasRequiredAccess,
  type AccessRequirement,
  type AppCapability,
  type AppRole,
} from '@/rbac/core';
import { prisma } from '@/shared/prisma';

export { APP_ROLES, CAPABILITIES, hasRequiredAccess };
export type { AccessRequirement, AppCapability, AppRole };

export const ACTIVE_ORGANIZATION_COOKIE = 'splashtrack.activeOrganizationSlug';

type AuthOrganization = {
  id: string;
  name: string;
  slug: string;
  parentOrganizationId: string | null;
  parentOrganization: { id: string; name: string; slug: string } | null;
};

type AuthMembership = {
  id: string;
  role: AppRole;
  organization: AuthOrganization;
};

export type AuthContext = {
  session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;
  membership: AuthMembership | null;
  currentMembership: AuthMembership | null;
  activeOrganization: AuthOrganization | null;
  allMemberships: AuthMembership[];
  capabilities: AppCapability[];
  isHeadOrganization: boolean;
  childOrganizations: Array<{ id: string; name: string; slug: string; isActive: boolean }>;
};

type GetAuthContextOptions = {
  organizationSlug?: string | null;
  allowMissingActiveOrganization?: boolean;
};

function normalizeSlug(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^[a-z0-9-]+$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

export async function getAuthContext(options: GetAuthContextOptions = {}): Promise<AuthContext | null> {
  const session = await getAuthSession();

  if (!session?.user) {
    return null;
  }

  const memberships = await prisma.organizationMember.findMany({
    where: {
      userId: session.user.id,
      isActive: true,
      user: {
        isActive: true,
      },
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
          parentOrganizationId: true,
          parentOrganization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  const requestedSlug = normalizeSlug(options.organizationSlug);
  const cookieStore = await cookies();
  const cookieSlug = normalizeSlug(cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value);
  const preferredSlug = requestedSlug ?? cookieSlug;

  let currentMembership = preferredSlug
    ? memberships.find((item) => item.organization.slug === preferredSlug) ?? null
    : null;

  if (!currentMembership && memberships.length === 1) {
    currentMembership = memberships[0] ?? null;
  }

  const overrides = currentMembership
    ? await prisma.organizationMemberCapability.findMany({
        where: { organizationMemberId: currentMembership.id },
        select: { capability: true },
      })
    : [];

  const capabilities = collectCapabilities(
    currentMembership?.role ?? null,
    overrides.map((override) => override.capability).filter((capability): capability is AppCapability => {
      return Object.values(CAPABILITIES).includes(capability as AppCapability);
    }),
  );

  const activeOrganization = currentMembership?.organization ?? null;
  const isHeadOrganization = Boolean(activeOrganization && !activeOrganization.parentOrganizationId);
  const childOrganizations =
    activeOrganization && capabilities.includes(CAPABILITIES.organizationSuborgManage)
      ? await prisma.organization.findMany({
          where: { parentOrganizationId: activeOrganization.id },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, slug: true, isActive: true },
        })
      : [];

  return {
    session,
    membership: currentMembership,
    currentMembership,
    activeOrganization,
    allMemberships: memberships,
    capabilities,
    isHeadOrganization,
    childOrganizations,
  };
}

export async function requireAuthContext(
  requirement: AccessRequirement = {},
  options: GetAuthContextOptions = {},
): Promise<AuthContext> {
  const context = await getAuthContext(options);

  if (!context?.session.user) {
    redirect('/login?redirectTo=/dashboard');
  }

  if (!context.membership && !options.allowMissingActiveOrganization && context.allMemberships.length > 1) {
    redirect('/dashboard/organizations/select');
  }

  if (!context.membership && options.allowMissingActiveOrganization) {
    return context;
  }

  if (!hasRequiredAccess(context, requirement)) {
    redirect('/forbidden');
  }

  return context;
}
