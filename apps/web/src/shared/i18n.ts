import { cookies } from 'next/headers';

import { languageCookieName, normalizeLanguage, type Language } from '@/shared/i18n-shared';
import { readTranslationStore } from '@/shared/translation-store';

export async function getCurrentLanguage(): Promise<Language> {
  const cookieStore = await cookies();
  return normalizeLanguage(cookieStore.get(languageCookieName)?.value);
}

export async function getAvailableLanguages(): Promise<string[]> {
  const store = await readTranslationStore();
  return store.languages;
}

export {
  dictionary,
  getCopyLanguage,
  languageCookieName,
  normalizeLanguage,
  supportedLanguages,
  type Language,
} from '@/shared/i18n-shared';
