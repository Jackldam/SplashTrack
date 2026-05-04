import { createAuthClient } from 'better-auth/react';

import { appConfig } from '@/shared/env';

const authBaseUrl =
  typeof window === 'undefined'
    ? `${appConfig.appBaseUrl}/api/auth`
    : `${window.location.origin}/api/auth`;

export const authClient = createAuthClient({
  baseURL: authBaseUrl,
});
