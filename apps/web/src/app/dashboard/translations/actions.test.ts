import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';

type ActionsModule = typeof import('./actions');
type FormStateModule = typeof import('./form-state');
type StoreModule = typeof import('@/shared/translation-store');

let originalCwd: string;
let tempDir: string;
let actions: ActionsModule;
let formState: FormStateModule;
let store: StoreModule;

before(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(tmpdir(), 'splashtrack-translations-'));
  process.chdir(tempDir);
  actions = await import('./actions');
  formState = await import('./form-state');
  store = await import('@/shared/translation-store');
});

beforeEach(async () => {
  await rm(path.join(tempDir, 'translations'), { recursive: true, force: true });
});

after(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

function formDataFromJson(payload: unknown, mode = 'merge', replaceConfirmation = '') {
  const formData = new FormData();
  formData.set('translations', typeof payload === 'string' ? payload : JSON.stringify(payload));
  formData.set('importMode', mode);
  if (replaceConfirmation) {
    formData.set('replaceConfirmation', replaceConfirmation);
  }
  return formData;
}

test('translation actions mutate translations and languages without crashing', async () => {
  const addForm = new FormData();
  addForm.set('language', 'de');

  const addResult = await actions.addLanguage(formState.initialTranslationFormState, addForm);
  assert.equal(addResult.status, 'success');

  const afterAdd = await store.readTranslationStore();
  assert.deepEqual(afterAdd.languages, ['nl', 'en', 'de']);
  assert.equal(afterAdd.entries.active.de, 'Active');

  const manualForm = new FormData();
  for (const language of afterAdd.languages) {
    manualForm.append('languages', language);
  }
  for (const [key, entry] of Object.entries(afterAdd.entries)) {
    manualForm.append('keys', key);
    for (const language of afterAdd.languages) {
      manualForm.set(`entry:${encodeURIComponent(key)}:${encodeURIComponent(language)}`, key === 'active' && language === 'en' ? 'ACTIVE UPDATED' : entry[language] ?? '');
    }
  }

  const manualResult = await actions.saveTranslations(formState.initialTranslationFormState, manualForm);
  assert.equal(manualResult.status, 'success');
  assert.equal((await store.readTranslationStore()).entries.active.en, 'ACTIVE UPDATED');
});

test('JSON merge adds languages and updates existing language values', async () => {
  const mergeResult = await actions.saveTranslations(
    formState.initialTranslationFormState,
    formDataFromJson({
      languages: ['nl', 'en', 'fr'],
      entries: {
        active: { nl: 'Actief aangepast', en: 'Active merged', fr: 'Actif' },
      },
    }),
  );

  assert.equal(mergeResult.status, 'success');
  const mergedStore = await store.readTranslationStore();
  assert.deepEqual(mergedStore.languages, ['nl', 'en', 'fr']);
  assert.equal(mergedStore.entries.active.nl, 'Actief aangepast');
  assert.equal(mergedStore.entries.active.en, 'Active merged');
  assert.equal(mergedStore.entries.active.fr, 'Actif');
  assert.equal(mergedStore.entries.inactive.fr, 'Inactive');
});

test('invalid JSON and unconfirmed replace return validation errors without changing stored data', async () => {
  const beforeStore = await store.readTranslationStore();

  const invalidResult = await actions.saveTranslations(formState.initialTranslationFormState, formDataFromJson('{"languages":["nl"],'));
  assert.equal(invalidResult.status, 'error');
  assert.match(invalidResult.message, /JSON is ongeldig/);
  assert.deepEqual(await store.readTranslationStore(), beforeStore);

  const unconfirmedReplaceResult = await actions.saveTranslations(
    formState.initialTranslationFormState,
    formDataFromJson(beforeStore, 'replace'),
  );
  assert.equal(unconfirmedReplaceResult.status, 'error');
  assert.match(unconfirmedReplaceResult.message, /Typ REPLACE/);
  assert.deepEqual(await store.readTranslationStore(), beforeStore);
});

test('replace mode requires baseline keys before writing', async () => {
  const result = await actions.saveTranslations(
    formState.initialTranslationFormState,
    formDataFromJson({ languages: ['nl', 'en'], entries: { active: { nl: 'Actief', en: 'Active' } } }, 'replace', 'REPLACE'),
  );

  assert.equal(result.status, 'error');
  assert.match(result.message, /mist verplichte keys/);
});
