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

export const DEMO_STUDENTS = [
  {
    firstName: 'Saar',
    lastName: 'de Vries',
    dateOfBirth: '2018-02-14',
    swimLevel: 'Watergewenning',
    isActive: true,
  },
  {
    firstName: 'Milan',
    lastName: 'Jansen',
    dateOfBirth: '2017-06-03',
    swimLevel: 'Diploma A',
    isActive: true,
  },
  {
    firstName: 'Nora',
    lastName: 'Visser',
    dateOfBirth: '2016-11-21',
    swimLevel: 'Diploma B',
    isActive: true,
  },
  {
    firstName: 'Timo',
    lastName: 'Bakker',
    dateOfBirth: '2015-09-09',
    swimLevel: 'Diploma A',
    isActive: false,
  },
] as const;

export const DEMO_SWIM_GROUPS = [
  {
    name: 'Beginners A',
    swimLevel: 'Watergewenning',
    isActive: true,
  },
  {
    name: 'Diploma A Groep',
    swimLevel: 'Diploma A',
    isActive: true,
  },
  {
    name: 'Gevorderden B',
    swimLevel: 'Diploma B',
    isActive: true,
  },
] as const;

export const DEMO_SKILLS = [
  {
    name: 'Watergewenning basis',
    description: 'Basisvaardigheden voor watergewenning: vertrouwen in het water, onderdompelen.',
    swimLevel: 'Watergewenning',
    isActive: true,
  },
  {
    name: 'Schoolslag armbewegingen',
    description: 'Correcte armbewegingen bij schoolslag uitvoeren.',
    swimLevel: 'Diploma A',
    isActive: true,
  },
  {
    name: 'Schoolslag beenbewegingen',
    description: 'Correcte beenbewegingen bij schoolslag uitvoeren.',
    swimLevel: 'Diploma A',
    isActive: true,
  },
  {
    name: 'Rugslag basis',
    description: 'Op de rug zwemmen met correcte lichaamshouding.',
    swimLevel: 'Diploma B',
    isActive: true,
  },
  {
    name: 'Borstcrawl coördinatie',
    description: 'Armen, benen en ademhaling coördineren bij borstcrawl.',
    swimLevel: 'Diploma B',
    isActive: true,
  },
] as const;

export const DEMO_COURSES = [
  {
    name: 'Watergewenning basis',
    description: 'Introductiecursus voor jonge zwemmers om vertrouwen in het water te krijgen.',
    swimLevel: 'Watergewenning',
    isActive: true,
  },
  {
    name: 'Diploma A voorbereiding',
    description: 'Cursus ter voorbereiding op het zwem diploma A.',
    swimLevel: 'Diploma A',
    isActive: true,
  },
  {
    name: 'Diploma B gevorderden',
    description: 'Gevorderde cursus voor het behalen van zwem diploma B.',
    swimLevel: 'Diploma B',
    isActive: true,
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
    seededStudents: DEMO_STUDENTS.map(({ firstName, lastName, swimLevel, isActive }) => ({
      firstName,
      lastName,
      swimLevel,
      isActive,
    })),
    seededSwimGroups: DEMO_SWIM_GROUPS.map(({ name, swimLevel }) => ({ name, swimLevel })),
    seededSkills: DEMO_SKILLS.map(({ name, swimLevel }) => ({ name, swimLevel })),
    seededCourses: DEMO_COURSES.map(({ name, swimLevel }) => ({ name, swimLevel })),
  },
} as const;
