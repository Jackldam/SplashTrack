'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACTIVE_ORGANIZATION_COOKIE, getAuthContext } from '@/lib/authz';

const selectionSchema = z.object({
  organizationSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/i),
});

export async function selectActiveOrganizationAction(formData: FormData) {
  const authContext = await getAuthContext({ allowMissingActiveOrganization: true });

  if (!authContext?.session.user) {
    redirect('/login?redirectTo=/dashboard/organizations/select');
  }

  const parsed = selectionSchema.safeParse({ organizationSlug: formData.get('organizationSlug') });

  if (!parsed.success) {
    redirect('/dashboard/organizations/select?error=invalid');
  }

  const slug = parsed.data.organizationSlug.toLowerCase();
  const membership = authContext.allMemberships.find((item) => item.organization.slug === slug);

  if (!membership) {
    redirect('/forbidden');
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, slug, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });

  redirect('/dashboard');
}
