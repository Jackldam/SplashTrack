import { z } from 'zod';

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('SplashTrack'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1).default('postgresql://splashtrack:splashtrack@postgres:5432/splashtrack'),
  DIRECT_URL: z.string().min(1).optional(),
});

const authEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
});

const parsedBaseEnv = baseEnvSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  APP_BASE_URL: process.env.APP_BASE_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
});

if (!parsedBaseEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedBaseEnv.error.message}`);
}

export const appConfig = {
  nodeEnv: parsedBaseEnv.data.NODE_ENV,
  port: parsedBaseEnv.data.PORT,
  appName: parsedBaseEnv.data.NEXT_PUBLIC_APP_NAME,
  appBaseUrl: parsedBaseEnv.data.APP_BASE_URL,
  logLevel: parsedBaseEnv.data.LOG_LEVEL,
  databaseUrl: parsedBaseEnv.data.DATABASE_URL,
  directUrl: parsedBaseEnv.data.DIRECT_URL,
} as const;

export function getAuthRuntimeConfig() {
  const parsedAuthEnv = authEnvSchema.safeParse({
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  });

  if (!parsedAuthEnv.success) {
    throw new Error(`Invalid auth environment configuration: ${parsedAuthEnv.error.message}`);
  }

  return {
    betterAuthSecret: parsedAuthEnv.data.BETTER_AUTH_SECRET,
  } as const;
}
