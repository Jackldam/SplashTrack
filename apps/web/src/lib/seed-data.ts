import { AuditActorType, OrganizationMemberRole } from '@prisma/client';

export const DEMO_ORGANIZATION = {
  slug: 'demo-org',
  name: 'SplashTrack Demo Organization',
} as const;

export const DEMO_USERS = [
  {
    email: 'demo.owner@splashtrack.local',
    name: 'Demo Owner',
    role: OrganizationMemberRole.OWNER,
    password: 'DemoOwner123!',
  },
  {
    email: 'demo.admin@splashtrack.local',
    name: 'Demo Admin',
    role: OrganizationMemberRole.ADMIN,
    password: 'DemoAdmin123!',
  },
  {
    email: 'demo.member@splashtrack.local',
    name: 'Demo Member',
    role: OrganizationMemberRole.MEMBER,
    password: 'DemoMember123!',
  },
] as const;

export const FOUNDATION_SEED_AUDIT = {
  action: 'foundation.seeded',
  entityType: 'system',
  entityId: DEMO_ORGANIZATION.slug,
  actorType: AuditActorType.USER,
  metadata: {
    note: 'Idempotent Prisma foundation seed for local/demo environments only.',
    seededUsers: DEMO_USERS.map(({ email, role }) => ({ email, role })),
  },
} as const;
