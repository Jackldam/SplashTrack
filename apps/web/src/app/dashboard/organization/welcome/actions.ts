'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { initialWelcomePageActionResult, type WelcomePageActionResult } from '@/app/dashboard/organization/welcome/form-state';
import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { buildWelcomePageContentFromFormData } from '@/lib/welcome-page';

export async function saveWelcomePage(
  _previousState: WelcomePageActionResult = initialWelcomePageActionResult,
  formData: FormData,
): Promise<WelcomePageActionResult> {
  void _previousState;

  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationAdmin });
  const organizationId = authContext.membership?.organization.id;

  if (!organizationId) {
    return { status: 'error', message: 'Geen actieve organisatie gevonden.' };
  }

  const parsed = buildWelcomePageContentFromFormData(formData);

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues.map((issue) => issue.message).join(' '),
    };
  }

  const content = parsed.data;

  await prisma.$transaction(async (tx) => {
    const page = await tx.organizationWelcomePage.upsert({
      where: { organizationId },
      update: {
        title: content.title,
        subtitle: content.subtitle ?? null,
        body: content.body,
        ctaLabel: content.ctaLabel ?? null,
        ctaHref: content.ctaHref ?? null,
        cards: content.cards,
        updatedById: authContext.session.user.id,
      },
      create: {
        organizationId,
        title: content.title,
        subtitle: content.subtitle ?? null,
        body: content.body,
        ctaLabel: content.ctaLabel ?? null,
        ctaHref: content.ctaHref ?? null,
        cards: content.cards,
        createdById: authContext.session.user.id,
        updatedById: authContext.session.user.id,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'organization.welcome_page.updated',
        entityType: 'organization_welcome_page',
        entityId: page.id,
        metadata: {
          title: content.title,
          hasSubtitle: Boolean(content.subtitle),
          hasCta: Boolean(content.ctaHref),
          cardCount: content.cards.length,
          performedByMembershipId: authContext.membership?.id,
          performedByRole: authContext.membership?.role,
        },
      },
    });
  });

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/organization/welcome');
  revalidatePath('/dashboard/organization');

  return { status: 'success', message: 'Welkomstpagina is opgeslagen.' };
}

export async function resetWelcomePage(
  _previousState: WelcomePageActionResult = initialWelcomePageActionResult,
): Promise<WelcomePageActionResult> {
  void _previousState;

  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationAdmin });
  const organizationId = authContext.membership?.organization.id;

  if (!organizationId) {
    return { status: 'error', message: 'Geen actieve organisatie gevonden.' };
  }

  const existing = await prisma.organizationWelcomePage.findUnique({
    where: { organizationId },
    select: { id: true, title: true },
  });

  if (!existing) {
    return { status: 'success', message: 'De standaard welkomstpagina was al actief.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationWelcomePage.delete({ where: { organizationId } });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'organization.welcome_page.reset',
        entityType: 'organization_welcome_page',
        entityId: existing.id,
        metadata: {
          previousTitle: existing.title,
          performedByMembershipId: authContext.membership?.id,
          performedByRole: authContext.membership?.role,
        },
      },
    });
  });

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/organization/welcome');
  revalidatePath('/dashboard/organization');

  return { status: 'success', message: 'Welkomstpagina is teruggezet naar de standaard.' };
}
