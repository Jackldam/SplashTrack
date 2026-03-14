import { headers } from 'next/headers';

import { auth } from '@/lib/auth';

export async function getAuthSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

export async function getCurrentUser() {
  const session = await getAuthSession();
  return session?.user ?? null;
}
