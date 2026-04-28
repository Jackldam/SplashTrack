import { NextResponse } from 'next/server';

import { readTranslationStore } from '@/lib/translation-store';

export async function GET() {
  const store = await readTranslationStore();
  return NextResponse.json(store);
}
