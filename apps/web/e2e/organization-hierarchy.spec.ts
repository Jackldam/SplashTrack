import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const ownerEmail = 'demo.owner@splashtrack.local';
const ownerPassword = 'DemoOwner123!';
const adminEmail = 'demo.admin@splashtrack.local';
const adminPassword = 'DemoAdmin123!';

async function login(page: Page, email = ownerEmail, password = ownerPassword) {
  await page.goto(`/login?redirectTo=${encodeURIComponent('/dashboard')}`);
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/wachtwoord|password/i).fill(password);
  await page.getByRole('button', { name: /inloggen|sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.beforeAll(() => {
  execFileSync('npm', ['run', 'prisma:seed'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
});

test('owner creates a sub-organization, delegates admin, and active org scope is enforced', async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = Date.now();
  const name = `E2E Sub Org ${suffix}`;
  const slug = `e2e-sub-org-${suffix}`;

  await login(page);
  await page.goto('/dashboard/organization/sub-organizations');
  await expect(page.getByRole('heading', { name: 'Sub-organizations' })).toBeVisible();

  await page.getByRole('link', { name: 'Nieuwe sub-organization' }).click();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="slug"]').fill(slug);
  await page.getByRole('button', { name: 'Sub-organization aanmaken' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.getByRole('link', { name: 'Users beheren' }).click();
  await expect(page.getByRole('heading', { name: `${name} users` })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="name"]').fill('Demo Admin');
  await expect(page.locator('input[name="name"]')).toHaveValue('Demo Admin');
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('select[name="role"]').selectOption('ADMIN');
  await page.locator('input[name="capabilities"][value="students:write"]').check();
  await page.locator('input[name="capabilities"][value="groups:write"]').check();
  await page.getByRole('button', { name: 'User/delegatie opslaan' }).click();
  await expect(page.getByText('Userdelegatie opgeslagen.')).toBeVisible();
  await expect(page.getByRole('cell', { name: adminEmail })).toBeVisible();

  await page.context().clearCookies();
  await login(page, adminEmail, adminPassword);
  await expect(page.getByRole('heading', { name: 'Kies actieve organization' })).toBeVisible();
  await page.getByRole('button', { name: `Activeer ${name}` }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(name).first()).toBeVisible();

  await page.goto('/dashboard/organization');
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('link', { name: /Beheer sub-organizations|Sub-organizations/ })).toHaveCount(0);

  await page.goto('/dashboard/organization/sub-organizations');
  await expect(page.getByRole('heading', { name: /toegang geweigerd/i })).toBeVisible();

  await page.goto('/dashboard/students');
  await expect(page.getByText(/Geen studenten gevonden|Nog geen actieve studentdata/i).first()).toBeVisible();
});
