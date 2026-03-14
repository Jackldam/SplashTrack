import { createAuthClient } from 'better-auth/react';

import { appConfig } from '@/lib/env';

const authBaseUrl =
  typeof window === 'undefined'
    ? `${appConfig.appBaseUrl}/api/auth`
    : `${window.location.origin}/api/auth`;

export const authClient = createAuthClient({
  baseURL: authBaseUrl,
});
