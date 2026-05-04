import { CAPABILITIES, requireAuthContext } from '@/rbac/index';
import { prisma } from '@/shared/prisma';
import { resolveWelcomePageContent } from '@/features/welcome-page';

import { WelcomePageEditor } from './welcome-page-editor';

export default async function OrganizationWelcomePageSettings() {
  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationAdmin });
  const organizationId = authContext.membership?.organization.id;

  const page = organizationId
    ? await prisma.organizationWelcomePage.findUnique({
        where: { organizationId },
        select: {
          title: true,
          subtitle: true,
          body: true,
          ctaLabel: true,
          ctaHref: true,
          cards: true,
        },
      })
    : null;

  return <WelcomePageEditor content={resolveWelcomePageContent(page)} isDefault={!page} />;
}
