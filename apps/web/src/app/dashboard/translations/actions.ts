'use server';

import { revalidatePath } from 'next/cache';

import type { TranslationFormState } from './form-state';

import {
  completeTranslationStore,
  defaultTranslationStore,
  mergeTranslationStores,
  readTranslationStore,
  writeCustomTranslationStore,
  type TranslationStore,
} from '@/shared/translation-store';

function decodeStructuredFieldName(key: string, language: string) {
  return `entry:${encodeURIComponent(key)}:${encodeURIComponent(language)}`;
}

function isValidLanguageCode(language: string) {
  return /^[a-z]{2}(-[a-z]{2})?$/.test(language);
}

function isMissingRevalidationContextError(error: unknown) {
  return error instanceof Error && error.message.includes('static generation store missing');
}

function revalidateTranslationPaths() {
  try {
    revalidatePath('/dashboard/translations');
    revalidatePath('/', 'layout');
  } catch (error) {
    if (!isMissingRevalidationContextError(error)) {
      throw error;
    }
  }
}

function parseStructuredTranslations(formData: FormData): TranslationStore | null {
  const languages = formData
    .getAll('languages')
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  const keys = formData
    .getAll('keys')
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (languages.length === 0 || keys.length === 0) {
    return null;
  }

  const uniqueLanguages = Array.from(new Set(languages));
  const uniqueKeys = Array.from(new Set(keys));

  if (!uniqueLanguages.every(isValidLanguageCode)) {
    throw new Error('Een of meer taalcodes zijn ongeldig. Gebruik bijvoorbeeld nl, en of de-de.');
  }

  return {
    languages: uniqueLanguages,
    entries: Object.fromEntries(
      uniqueKeys.map((key) => [
        key,
        Object.fromEntries(
          uniqueLanguages.map((language) => [language, String(formData.get(decodeStructuredFieldName(key, language)) ?? '')]),
        ),
      ]),
    ),
  };
}

function assertPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLanguages(languages: unknown): string[] {
  if (!Array.isArray(languages)) {
    throw new Error('JSON mist een geldige "languages" array.');
  }

  const normalized = Array.from(new Set(languages.map((language) => String(language).trim().toLowerCase()).filter(Boolean)));
  if (normalized.length === 0) {
    throw new Error('Voeg minimaal één taal toe aan "languages".');
  }
  if (!normalized.every(isValidLanguageCode)) {
    throw new Error('Een of meer taalcodes zijn ongeldig. Gebruik bijvoorbeeld nl, en of de-de.');
  }

  return normalized;
}

function parseJsonTranslations(raw: string): TranslationStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON is ongeldig. Controleer komma’s, quotes en accolades.');
  }

  if (!assertPlainRecord(parsed)) {
    throw new Error('JSON moet een object zijn met "languages" en "entries".');
  }

  const languages = normalizeLanguages(parsed.languages);
  if (!assertPlainRecord(parsed.entries)) {
    throw new Error('JSON mist een geldig "entries" object.');
  }

  const entries: TranslationStore['entries'] = {};
  for (const [key, value] of Object.entries(parsed.entries)) {
    const cleanKey = key.trim();
    if (!cleanKey) {
      throw new Error('Vertaalkeys mogen niet leeg zijn.');
    }
    if (!assertPlainRecord(value)) {
      throw new Error(`Vertaalkey "${cleanKey}" moet een object met taalwaarden zijn.`);
    }

    const entry: Record<string, string> = {};
    for (const [language, translation] of Object.entries(value)) {
      const normalizedLanguage = language.trim().toLowerCase();
      if (!isValidLanguageCode(normalizedLanguage)) {
        throw new Error(`Ongeldige taalcode "${language}" bij key "${cleanKey}".`);
      }
      if (!languages.includes(normalizedLanguage)) {
        throw new Error(`Taal "${normalizedLanguage}" bij key "${cleanKey}" staat niet in "languages".`);
      }
      if (typeof translation !== 'string') {
        throw new Error(`Vertaling voor "${cleanKey}" / "${normalizedLanguage}" moet tekst zijn.`);
      }
      entry[normalizedLanguage] = translation;
    }
    entries[cleanKey] = entry;
  }

  if (Object.keys(entries).length === 0) {
    throw new Error('Voeg minimaal één vertaalkey toe aan "entries".');
  }

  return completeTranslationStore({ languages, entries });
}

async function readUploadedJson(formData: FormData) {
  const file = formData.get('translationFile');
  if (file instanceof File && file.size > 0) {
    if (file.size > 1024 * 1024) {
      throw new Error('JSON-bestand is te groot. Gebruik maximaal 1 MB.');
    }
    return file.text();
  }

  return String(formData.get('translations') ?? '').trim();
}

export async function saveTranslations(_: TranslationFormState, formData: FormData): Promise<TranslationFormState> {
  try {
    const raw = await readUploadedJson(formData);
    const parsed = raw ? parseJsonTranslations(raw) : parseStructuredTranslations(formData);

    if (!parsed) {
      return { status: 'error', message: 'Geen vertalingen gevonden om op te slaan.' };
    }

    const importMode = String(formData.get('importMode') ?? 'replace');
    const replaceConfirmation = String(formData.get('replaceConfirmation') ?? '').trim();
    let nextStore = parsed;

    if (raw && importMode !== 'replace') {
      nextStore = mergeTranslationStores(await readTranslationStore(), parsed);
    }

    if (raw && importMode === 'replace') {
      if (replaceConfirmation !== 'REPLACE') {
        return { status: 'error', message: 'Typ REPLACE om alle huidige vertalingen te vervangen, of kies “samenvoegen”.' };
      }
      const missingRequiredKeys = Object.keys(defaultTranslationStore.entries).filter((key) => !nextStore.entries[key]);
      if (missingRequiredKeys.length > 0) {
        return {
          status: 'error',
          message: `Vervangen geblokkeerd: JSON mist verplichte keys (${missingRequiredKeys.slice(0, 6).join(', ')}${missingRequiredKeys.length > 6 ? ', ...' : ''}).`,
        };
      }
    }

    await writeCustomTranslationStore(completeTranslationStore(nextStore));
    revalidateTranslationPaths();
    return { status: 'success', message: 'Vertalingen opgeslagen.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Opslaan is mislukt.' };
  }
}

export async function addLanguage(_: TranslationFormState, formData: FormData): Promise<TranslationFormState> {
  try {
    const language = String(formData.get('language') ?? '').trim().toLowerCase();
    if (!isValidLanguageCode(language)) {
      return { status: 'error', message: 'Gebruik een taalcode zoals nl, en of de-de.' };
    }

    const store = await readTranslationStore();
    if (store.languages.includes(language)) {
      return { status: 'error', message: 'Deze taal bestaat al.' };
    }

    const nextStore: TranslationStore = completeTranslationStore({
      languages: [...store.languages, language],
      entries: Object.fromEntries(
        Object.entries(store.entries).map(([key, entry]) => [key, { ...entry, [language]: entry.en ?? entry.nl ?? key }]),
      ),
    });

    await writeCustomTranslationStore(nextStore);
    revalidateTranslationPaths();
    return { status: 'success', message: `Taal ${language} toegevoegd.` };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Taal toevoegen is mislukt.' };
  }
}
