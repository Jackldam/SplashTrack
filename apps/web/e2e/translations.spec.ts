import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const translationStorePath = process.env.TRANSLATION_STORE_PATH
  ?? path.join(process.cwd(), 'e2e', '.tmp', 'custom-translations.json');

const genericErrorCopy = /Er is een fout opgetreden|Something went wrong|Opslaan is mislukt|Taal toevoegen is mislukt/i;

async function resetTranslationStore() {
  await fs.rm(translationStorePath, { force: true });
  await fs.mkdir(path.dirname(translationStorePath), { recursive: true });
}

async function loginAsOwner(page: Page) {
  await page.goto('/login?redirectTo=/dashboard/translations');
  await page.getByLabel(/e-?mail/i).fill('demo.owner@splashtrack.local');
  await page.getByLabel(/wachtwoord|password/i).fill('DemoOwner123!');
  await page.getByRole('button', { name: /inloggen|sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/translations/);
  await expect(page.getByTestId('translation-editor')).toHaveAttribute('data-hydrated', 'true', { timeout: 15_000 });
}

async function expectNoGenericError(page: Page) {
  await expect(page.locator('.form-status-error').filter({ hasText: genericErrorCopy })).toHaveCount(0);
}

test.beforeAll(() => {
  execFileSync('npm', ['run', 'prisma:seed'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
});

test.beforeEach(async ({ page }) => {
  await resetTranslationStore();
  await loginAsOwner(page);
});

test.afterAll(async () => {
  await resetTranslationStore();
});

test('renders the translation management UI with loaded styling', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Vertalingen beheren' })).toBeVisible();
  await expect(page.getByText('Translation management')).toBeVisible();
  await expect(page.locator('.meta-grid dt').filter({ hasText: /^Talen$/ })).toBeVisible();
  await expect(page.getByTestId('structured-translation-list')).toBeAttached();

  const panelStyles = await page.locator('.dashboard-panel').first().evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      paddingTop: style.paddingTop,
    };
  });

  expect(panelStyles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(panelStyles.borderRadius).not.toBe('0px');
  expect(Number.parseFloat(panelStyles.paddingTop)).toBeGreaterThan(0);
  await expectNoGenericError(page);
});

test('updates an existing translation through the manual UI and persists after reload', async ({ page }) => {
  await page.getByText('Handmatig per key bewerken').click();
  await page.getByLabel('Zoeken').fill('saveChanges');

  const card = page.locator('.translation-entry-card').filter({ hasText: 'saveChanges' });
  const uniqueValue = `Save changes e2e ${Date.now()}`;
  const englishTextarea = card.getByLabel('Vertaling saveChanges en');
  await englishTextarea.clear();
  await expect(englishTextarea).toHaveValue('');
  await englishTextarea.fill(uniqueValue);
  await expect(englishTextarea).toHaveValue(uniqueValue);
  await page.getByRole('button', { name: 'Vertalingen opslaan' }).click();

  await expect(page.getByText('Vertalingen opgeslagen.')).toBeVisible();
  await expectNoGenericError(page);

  await page.reload();
  await page.getByText('Handmatig per key bewerken').click();
  await page.getByLabel('Zoeken').fill('saveChanges');
  await expect(page.locator('.translation-entry-card').filter({ hasText: 'saveChanges' }).getByLabel('Vertaling saveChanges en')).toHaveValue(uniqueValue);
});

test('merges a pasted JSON language update and persists after reload', async ({ page }) => {
  const json = {
    languages: ['nl', 'en', 'es'],
    entries: {
      saveChanges: {
        nl: 'Wijzigingen opslaan',
        en: 'Save changes',
        es: 'Guardar cambios desde e2e',
      },
    },
  };

  await page.getByLabel('JSON plakken of controleren').fill(JSON.stringify(json, null, 2));
  await page.getByRole('button', { name: 'JSON valideren en samenvoegen' }).click();

  await expect(page.getByText('Vertalingen opgeslagen.')).toBeVisible();
  await expectNoGenericError(page);

  await page.reload();
  await expect(page.getByText('nl, en, es')).toBeVisible();
  await page.getByText('Handmatig per key bewerken').click();
  await page.getByLabel('Zoeken').fill('saveChanges');
  await expect(page.locator('.translation-entry-card').filter({ hasText: 'saveChanges' }).getByLabel('Vertaling saveChanges es')).toHaveValue('Guardar cambios desde e2e');
});

test('shows validation for invalid JSON without crashing', async ({ page }) => {
  await page.getByLabel('JSON plakken of controleren').fill('{ "languages": ["nl"], ');
  await page.getByRole('button', { name: 'JSON valideren en samenvoegen' }).click();

  await expect(page.getByText('JSON is ongeldig. Controleer komma’s, quotes en accolades.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vertalingen beheren' })).toBeVisible();
  await expectNoGenericError(page);
});

test('blocks replace mode unless REPLACE confirmation is provided', async ({ page }) => {
  const json = {
    languages: ['nl', 'en'],
    entries: {
      saveChanges: {
        nl: 'Vervangen geblokkeerd',
        en: 'Replace blocked',
      },
    },
  };

  await page.getByLabel('JSON plakken of controleren').fill(JSON.stringify(json, null, 2));
  await page.getByRole('button', { name: 'JSON valideren en vervangen' }).click();

  await expect(page.getByText('Typ REPLACE om alle huidige vertalingen te vervangen, of kies “samenvoegen”.')).toBeVisible();
  await expectNoGenericError(page);

  await page.reload();
  await page.getByText('Handmatig per key bewerken').click();
  await page.getByLabel('Zoeken').fill('saveChanges');
  await expect(page.locator('.translation-entry-card').filter({ hasText: 'saveChanges' }).getByLabel('Vertaling saveChanges en')).toHaveValue('Save changes');
});
