import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { execFileSync } from 'node:child_process';

const prisma = new PrismaClient();
const ownerEmail = 'demo.owner@splashtrack.local';
const ownerPassword = 'DemoOwner123!';
const memberEmail = 'demo.member@splashtrack.local';
const memberPassword = 'DemoMember123!';
const tenantBEmail = 'welcome-tenant-b@e2e.splashtrack.local';
const tenantBPassword = 'TenantB123!';

async function login(page: Page, email = ownerEmail, password = ownerPassword) {
  await page.goto(`/login?redirectTo=${encodeURIComponent('/dashboard')}`);
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/wachtwoord|password/i).fill(password);
  await page.getByRole('button', { name: /inloggen|sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function resetWelcomePages() {
  await prisma.organizationWelcomePage.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { action: { in: ['organization.welcome_page.updated', 'organization.welcome_page.reset'] } } });
}

async function ensureTenantB() {
  const organization = await prisma.organization.upsert({
    where: { slug: 'e2e-welcome-tenant-b' },
    update: { name: 'E2E Welcome Tenant B', isActive: true },
    create: { slug: 'e2e-welcome-tenant-b', name: 'E2E Welcome Tenant B', isActive: true },
  });

  const user = await prisma.user.upsert({
    where: { email: tenantBEmail },
    update: { name: 'Welcome Tenant B Owner', isActive: true, emailVerified: true },
    create: { email: tenantBEmail, name: 'Welcome Tenant B Owner', isActive: true, emailVerified: true },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: 'OWNER', isActive: true },
    create: { organizationId: organization.id, userId: user.id, role: 'OWNER', isActive: true },
  });

  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
    update: { userId: user.id, password: await hashPassword(tenantBPassword) },
    create: { providerId: 'credential', accountId: user.id, userId: user.id, password: await hashPassword(tenantBPassword) },
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

test.beforeAll(async () => {
  execFileSync('npm', ['run', 'prisma:seed'], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  await resetWelcomePages();
  await ensureTenantB();
});

test.afterAll(async () => {
  await resetWelcomePages();
  await prisma.$disconnect();
});

test('owner edits welcome page, members can view it, invalid links fail, and reset restores default', async ({ page }) => {
  test.setTimeout(60_000);
  const title = `E2E Welcome ${Date.now()}`;

  await login(page);
  await page.goto('/dashboard/organization/welcome');
  await expect(page.getByRole('heading', { name: 'Welkomstpagina beheren' })).toBeVisible();

  await page.locator('input[name="title"]').fill(title);
  await page.locator('input[name="subtitle"]').fill('A tenant-safe landing message');
  await page.locator('textarea[name="body"]').fill('Line one for the team\nLine two remains plain text');
  await page.locator('input[name="ctaLabel"]').fill('Open groups');
  await page.locator('input[name="ctaHref"]').fill('/dashboard/groups');
  await page.locator('input[name="cardTitle0"]').fill('Start here');
  await page.locator('textarea[name="cardBody0"]').fill('Use these cards without raw HTML.');
  await page.locator('input[name="cardLinkLabel0"]').fill('Open students');
  await page.locator('input[name="cardHref0"]').fill('/dashboard/students');
  await page.getByRole('button', { name: 'Opslaan' }).click();
  await expect(page.getByRole('status')).toContainText('Welkomstpagina is opgeslagen');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Line two remains plain text')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open groups' })).toHaveAttribute('href', '/dashboard/groups');
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: /uitloggen|sign out/i }).click();
  await login(page, memberEmail, memberPassword);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('link', { name: /welkomstpagina|welcome page/i })).toHaveCount(0);
  await page.goto('/dashboard/organization/welcome');
  await expect(page.getByRole('heading', { name: /toegang geweigerd/i })).toBeVisible();

  await page.context().clearCookies();
  await login(page);
  await page.goto('/dashboard/organization/welcome');
  await page.locator('input[name="ctaHref"]').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Opslaan' }).click();
  await expect(page.getByRole('status').filter({ hasText: /relatieve link|https:\/\//i })).toBeVisible();

  await page.getByRole('button', { name: 'Reset naar standaard' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'teruggezet naar de standaard' })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Welkom bij SplashTrack' })).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
});

test('welcome pages are isolated by organization and responsive on mobile and laptop', async ({ page }) => {
  const tenantATitle = `Tenant A Only ${Date.now()}`;

  await login(page);
  await page.goto('/dashboard/organization/welcome');
  await page.locator('input[name="title"]').fill(tenantATitle);
  await page.locator('textarea[name="body"]').fill('Tenant A body');
  await page.getByRole('button', { name: 'Opslaan' }).click();
  await expect(page.getByRole('status')).toContainText('opgeslagen');

  await page.getByRole('button', { name: /uitloggen|sign out/i }).click();
  await login(page, tenantBEmail, tenantBPassword);
  await expect(page.getByRole('heading', { name: tenantATitle })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Welkom bij SplashTrack' })).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/dashboard');
    await assertNoHorizontalOverflow(page);
    await page.goto('/dashboard/organization/welcome');
    await assertNoHorizontalOverflow(page);
  }
});
