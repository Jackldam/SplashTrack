import { headers } from 'next/headers';

import { getAuth } from '@/lib/auth';

function isMissingAuthSecretError(error: unknown) {
  return error instanceof Error && error.message.startsWith('Invalid auth environment configuration:');
}

export async function getAuthSession() {
  try {
    return await getAuth().api.getSession({
      headers: await headers(),
    });
  } catch (error) {
    if (isMissingAuthSecretError(error)) {
      return null;
    }

    throw error;
  }
}

export async function getCurrentUser() {
  const session = await getAuthSession();
  return session?.user ?? null;
}
