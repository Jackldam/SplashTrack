import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { resolveWelcomePageContent } from '@/lib/welcome-page';

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
