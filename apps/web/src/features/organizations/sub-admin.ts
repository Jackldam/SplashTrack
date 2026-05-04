import { AuditActorType, type OrganizationMemberRole } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ALL_CAPABILITIES, APP_ROLES, CAPABILITIES, type AppCapability, isAppCapability } from '@/rbac/core';
import { requireAuthContext, type AuthContext } from '@/rbac/index';
import { prisma } from '@/shared/prisma';

export const DELEGABLE_CAPABILITIES = ALL_CAPABILITIES.filter(
  (capability) => capability !== CAPABILITIES.organizationOwner,
);

function canManageSubOrganizations(authContext: AuthContext) {
  return (
    Boolean(authContext.membership) &&
    authContext.isHeadOrganization &&
    authContext.capabilities.includes(CAPABILITIES.organizationSuborgManage)
  );
}

async function requireSubOrganizationManager() {
  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationSuborgManage });

  if (!canManageSubOrganizations(authContext)) {
    redirect('/forbidden');
  }

  return authContext;
}

export async function getSubOrganizationList(authContext: AuthContext) {
  if (!canManageSubOrganizations(authContext) || !authContext.activeOrganization) {
    return null;
  }

  return prisma.organization.findMany({
    where: { parentOrganizationId: authContext.activeOrganization.id },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      isActive: true,
      createdAt: true,
      _count: { select: { members: true, students: true, swimGroups: true } },
    },
  });
}

export async function getSubOrganizationDetail(authContext: AuthContext, organizationId: string) {
  if (!canManageSubOrganizations(authContext) || !authContext.activeOrganization) {
    return null;
  }

  return prisma.organization.findFirst({
    where: { id: organizationId, parentOrganizationId: authContext.activeOrganization.id },
    select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
  });
}

export async function getSubOrganizationUsers(authContext: AuthContext, organizationId: string) {
  const organization = await getSubOrganizationDetail(authContext, organizationId);
  if (!organization) return null;

  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      role: true,
      isActive: true,
      createdAt: true,
      capabilities: { select: { capability: true } },
      user: { select: { id: true, name: true, email: true, isActive: true, emailVerified: true } },
    },
  });

  return { organization, memberships };
}

const organizationSchema = z.object({
  name: z.string().trim().min(2, 'Naam is verplicht.').max(120),
  slug: z
    .string()
    .trim()
    .min(2, 'Slug is verplicht.')
    .max(80)
    .regex(/^[a-z0-9-]+$/i, 'Gebruik alleen letters, cijfers en koppeltekens.')
    .transform((value) => value.toLowerCase()),
  isActive: z.enum(['true', 'false']).optional(),
});

const memberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z
    .string()
    .max(120)
    .optional()
    .transform((value) => value?.trim() ?? ''),
  role: z.enum([APP_ROLES.OWNER, APP_ROLES.ADMIN, APP_ROLES.MEMBER]),
  isActive: z.enum(['true', 'false']).optional(),
});

function parseCapabilities(formData: FormData): AppCapability[] {
  return formData
    .getAll('capabilities')
    .filter((value): value is string => typeof value === 'string')
    .filter(isAppCapability);
}

export async function createSubOrganizationAction(_previousState: unknown, formData: FormData) {
  const authContext = await requireSubOrganizationManager();
  const parsed = organizationSchema.safeParse({ name: formData.get('name'), slug: formData.get('slug') });

  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' };

  let organization: { id: string };
  try {
    organization = await prisma.organization.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        parentOrganizationId: authContext.activeOrganization!.id,
        isActive: true,
        auditLogs: {
          create: {
            actorUserId: authContext.session.user.id,
            actorType: AuditActorType.USER,
            action: 'organization.suborg.created',
            entityType: 'organization',
            metadata: { parentOrganizationId: authContext.activeOrganization!.id, performedByMembershipId: authContext.membership!.id },
          },
        },
      },
      select: { id: true },
    });
  } catch {
    return { status: 'error', message: 'Sub-organization aanmaken is niet gelukt. Controleer of de slug uniek is.' };
  }

  revalidatePath('/dashboard/organization/sub-organizations');
  redirect(`/dashboard/organization/sub-organizations/${organization.id}/edit`);
}

export async function updateSubOrganizationAction(organizationId: string, _previousState: unknown, formData: FormData) {
  const authContext = await requireSubOrganizationManager();
  const existing = await getSubOrganizationDetail(authContext, organizationId);
  if (!existing) return { status: 'error', message: 'Sub-organization niet gevonden.' };

  const parsed = organizationSchema.safeParse({ name: formData.get('name'), slug: formData.get('slug'), isActive: formData.get('isActive') });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { name: parsed.data.name, slug: parsed.data.slug, isActive: parsed.data.isActive === 'true' },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: 'organization.suborg.updated',
          entityType: 'organization',
          entityId: organizationId,
          metadata: { previousSlug: existing.slug, performedByMembershipId: authContext.membership!.id },
        },
      });
    });
  } catch {
    return { status: 'error', message: 'Sub-organization bijwerken is niet gelukt. Controleer of de slug uniek is.' };
  }

  revalidatePath('/dashboard/organization/sub-organizations');
  revalidatePath(`/dashboard/organization/sub-organizations/${organizationId}/edit`);
  return { status: 'success', message: 'Sub-organization bijgewerkt.' };
}

export async function upsertSubOrganizationMemberAction(organizationId: string, _previousState: unknown, formData: FormData) {
  const authContext = await requireSubOrganizationManager();
  const organization = await getSubOrganizationDetail(authContext, organizationId);
  if (!organization) return { status: 'error', message: 'Sub-organization niet gevonden.' };

  const parsed = memberSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: typeof formData.get('password') === 'string' ? formData.get('password') : undefined,
    role: formData.get('role'),
    isActive: formData.get('isActive') ?? 'true',
  });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' };

  if (parsed.data.role === APP_ROLES.OWNER && authContext.membership!.role !== APP_ROLES.OWNER) {
    return { status: 'error', message: 'Alleen head owners mogen owners delegeren.' };
  }

  const capabilities = parseCapabilities(formData);

  try {
    await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } });
      if (!user) {
        if (!parsed.data.password || parsed.data.password.length < 8) throw new Error('PASSWORD_REQUIRED');
        user = await tx.user.create({
          data: { email: parsed.data.email, name: parsed.data.name, emailVerified: true, isActive: true },
          select: { id: true },
        });
        await tx.account.create({
          data: { userId: user.id, providerId: 'credential', accountId: user.id, password: await hashPassword(parsed.data.password) },
        });
      } else {
        await tx.user.update({ where: { id: user.id }, data: { name: parsed.data.name, isActive: parsed.data.isActive === 'true' } });
        if (parsed.data.password && parsed.data.password.length >= 8) {
          await tx.account.updateMany({ where: { userId: user.id, providerId: 'credential' }, data: { password: await hashPassword(parsed.data.password) } });
        }
      }

      const membership = await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        update: { role: parsed.data.role as OrganizationMemberRole, isActive: parsed.data.isActive === 'true' },
        create: { organizationId, userId: user.id, role: parsed.data.role as OrganizationMemberRole, isActive: true },
        select: { id: true },
      });

      await tx.organizationMemberCapability.deleteMany({ where: { organizationMemberId: membership.id } });
      if (capabilities.length > 0) {
        await tx.organizationMemberCapability.createMany({
          data: capabilities.map((capability) => ({ organizationMemberId: membership.id, capability, grantedByUserId: authContext.session.user.id })),
          skipDuplicates: true,
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: 'organization.suborg.member.upserted',
          entityType: 'organizationMember',
          entityId: membership.id,
          metadata: { targetUserEmail: parsed.data.email, nextRole: parsed.data.role, capabilities },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'PASSWORD_REQUIRED') {
      return { status: 'error', message: 'Nieuw account vereist een wachtwoord van minimaal 8 tekens.' };
    }
    return { status: 'error', message: 'User/delegatie opslaan is niet gelukt.' };
  }

  revalidatePath(`/dashboard/organization/sub-organizations/${organizationId}/users`);
  return { status: 'success', message: 'Userdelegatie opgeslagen.' };
}
