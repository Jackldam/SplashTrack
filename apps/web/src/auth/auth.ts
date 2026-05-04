import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';

import { appConfig, getAuthRuntimeConfig } from '@/shared/env';
import { prisma } from '@/shared/prisma';

export function getAuth() {
  const { betterAuthSecret } = getAuthRuntimeConfig();

  return betterAuth({
    appName: appConfig.appName,
    baseURL: appConfig.appBaseUrl,
    trustedOrigins: appConfig.authTrustedOrigins,
    secret: betterAuthSecret,
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    user: {
      additionalFields: {
        isActive: {
          type: 'boolean',
          required: false,
          input: false,
        },
      },
    },
    plugins: [nextCookies()],
  });
}
