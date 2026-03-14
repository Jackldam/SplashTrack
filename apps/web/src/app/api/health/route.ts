import { NextResponse } from 'next/server';

import { appConfig } from '@/lib/env';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: appConfig.appName,
    timestamp: new Date().toISOString(),
    environment: appConfig.nodeEnv,
  });
}
