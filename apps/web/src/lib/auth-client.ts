import { createAuthClient } from 'better-auth/react';

import { appConfig } from '@/lib/env';

export const authClient = createAuthClient({
  baseURL: `${appConfig.appBaseUrl}/api/auth`,
});
