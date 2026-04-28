import { OrganizationMemberRole } from '@prisma/client';

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
  organizationSuborgCreate: 'organization:suborg:create',
  organizationSuborgManage: 'organization:suborg:manage',
  organizationMembersManage: 'organization:members:manage',
  organizationMembersRole: 'organization:members:role',
  studentsRead: 'students:read',
  studentsWrite: 'students:write',
  groupsRead: 'groups:read',
  groupsWrite: 'groups:write',
  welcomeManage: 'welcome:manage',
  translationsManage: 'translations:manage',
} as const;

export type AppCapability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export type AccessRequirement = {
  capability?: AppCapability;
  capabilities?: AppCapability[];
  role?: AppRole;
  roles?: AppRole[];
};

export const ALL_CAPABILITIES = Object.values(CAPABILITIES);

const roleCapabilities: Record<AppRole, AppCapability[]> = {
  [APP_ROLES.OWNER]: ALL_CAPABILITIES,
  [APP_ROLES.ADMIN]: [
    CAPABILITIES.dashboardAccess,
    CAPABILITIES.organizationAdmin,
    CAPABILITIES.organizationMembersManage,
    CAPABILITIES.studentsRead,
    CAPABILITIES.studentsWrite,
    CAPABILITIES.groupsRead,
    CAPABILITIES.groupsWrite,
    CAPABILITIES.welcomeManage,
    CAPABILITIES.translationsManage,
  ],
  [APP_ROLES.MEMBER]: [
    CAPABILITIES.dashboardAccess,
    CAPABILITIES.studentsRead,
    CAPABILITIES.groupsRead,
  ],
};

export function isAppCapability(value: string): value is AppCapability {
  return (ALL_CAPABILITIES as string[]).includes(value);
}

export function collectCapabilities(role: AppRole | null, overrides: AppCapability[] = []) {
  if (!role) {
    return [] as AppCapability[];
  }

  return [...new Set([...roleCapabilities[role], ...overrides])];
}

export function resolveAllowedCapabilities(requirement: AccessRequirement) {
  const required = new Set<AppCapability>();

  if (requirement.capability) {
    required.add(requirement.capability);
  }

  for (const capability of requirement.capabilities ?? []) {
    required.add(capability);
  }

  return [...required];
}

export function resolveAllowedRoles(requirement: AccessRequirement) {
  const required = new Set<AppRole>();

  if (requirement.role) {
    required.add(requirement.role);
  }

  for (const role of requirement.roles ?? []) {
    required.add(role);
  }

  return [...required];
}

export function hasRequiredAccess(
  context: {
    membership: {
      role: AppRole;
    } | null;
    capabilities: AppCapability[];
  },
  requirement: AccessRequirement = {},
) {
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
