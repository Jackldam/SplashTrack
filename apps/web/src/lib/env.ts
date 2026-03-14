import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default('SplashTrack'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1).default('postgresql://splashtrack:splashtrack@postgres:5432/splashtrack'),
  DIRECT_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
});

const parsedEnv = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  APP_BASE_URL: process.env.APP_BASE_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
});

if (!parsedEnv.success) {
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const appConfig = {
  nodeEnv: parsedEnv.data.NODE_ENV,
  port: parsedEnv.data.PORT,
  appName: parsedEnv.data.NEXT_PUBLIC_APP_NAME,
  appBaseUrl: parsedEnv.data.APP_BASE_URL,
  logLevel: parsedEnv.data.LOG_LEVEL,
  databaseUrl: parsedEnv.data.DATABASE_URL,
  directUrl: parsedEnv.data.DIRECT_URL,
  betterAuthSecret: parsedEnv.data.BETTER_AUTH_SECRET,
} as const;
