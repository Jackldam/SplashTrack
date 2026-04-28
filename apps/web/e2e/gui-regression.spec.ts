import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';

const prisma = new PrismaClient();
const e2ePrefix = 'E2E GUI';
const genericErrorHeading = /Er is een fout opgetreden|Something went wrong|Application error/i;

type PageProblem = { type: 'console' | 'pageerror'; text: string };

async function cleanupE2eData() {
  const e2eStudents = await prisma.student.findMany({
    where: { firstName: { startsWith: e2ePrefix } },
    select: { id: true },
  });
  const e2eGroups = await prisma.swimGroup.findMany({
    where: { name: { startsWith: e2ePrefix } },
    select: { id: true },
  });
  const e2eUsers = await prisma.user.findMany({
    where: { email: { contains: '@e2e.splashtrack.local' } },
    select: { id: true },
  });

  await prisma.groupMembership.deleteMany({
    where: {
      OR: [
        { studentId: { in: e2eStudents.map((student) => student.id) } },
        { groupId: { in: e2eGroups.map((group) => group.id) } },
      ],
    },
  });
  await prisma.student.deleteMany({ where: { id: { in: e2eStudents.map((student) => student.id) } } });
  await prisma.swimGroup.deleteMany({ where: { id: { in: e2eGroups.map((group) => group.id) } } });
  await prisma.organizationMember.deleteMany({ where: { userId: { in: e2eUsers.map((user) => user.id) } } });
  await prisma.account.deleteMany({ where: { userId: { in: e2eUsers.map((user) => user.id) } } });
  await prisma.session.deleteMany({ where: { userId: { in: e2eUsers.map((user) => user.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: e2eUsers.map((user) => user.id) } } });
}

function monitorPageProblems(page: Page) {
  const problems: PageProblem[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!/favicon|Failed to load resource.*(401|403|404)/i.test(text)) {
        problems.push({ type: 'console', text });
      }
    }
  });

  page.on('pageerror', (error) => {
    problems.push({ type: 'pageerror', text: error.message });
  });

  return problems;
}

async function expectHealthyPage(page: Page, problems: PageProblem[]) {
  await expect(page.locator('body')).toHaveCSS('font-family', /Inter|Arial|sans-serif/i);
  await expect(page.locator('.language-selector')).toBeVisible();
  await expect(page.locator('.dashboard-panel, .hero-card').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: genericErrorHeading })).toHaveCount(0);
  await expect(page.getByText(/^500$/)).toHaveCount(0);
  expect(problems).toEqual([]);
}

async function login(page: Page, email = 'demo.owner@splashtrack.local', password = 'DemoOwner123!', redirectTo = '/dashboard') {
  await page.goto(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/wachtwoord|password/i).fill(password);
  await page.getByRole('button', { name: /inloggen|sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(redirectTo.replaceAll('/', '\\/')));
}

async function createStudentThroughUi(page: Page, marker: string) {
  await page.goto('/dashboard/students/new');
  await page.getByLabel('Voornaam').fill(`${e2ePrefix} Student ${marker}`);
  await page.getByLabel('Achternaam').fill('Regression');
  await page.getByLabel('Geboortedatum').fill('2016-04-28');
  await page.getByLabel('Niveau').fill(`E2E Niveau ${marker}`);
  await page.getByLabel('Status').selectOption('true');
  await page.getByRole('button', { name: 'Student aanmaken' }).click();
  await expect(page).toHaveURL(/\/dashboard\/students$/);
  await expect(page.getByRole('link', { name: `${e2ePrefix} Student ${marker} Regression` })).toBeVisible();
}

test.beforeAll(async () => {
  execFileSync('npm', ['run', 'prisma:seed'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
  await prisma.$disconnect();
});

test('public home, language selector and login validation render with styling', async ({ page }) => {
  const problems = monitorPageProblems(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SplashTrack' })).toBeVisible();
  await expect(page.getByRole('link', { name: /naar login|login/i })).toBeVisible();
  await expectHealthyPage(page, problems);

  await page.getByLabel(/taal|language/i).selectOption('en');
  await expect(page.getByRole('link', { name: /go to login/i })).toBeVisible();
  await page.getByRole('link', { name: /go to login/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: /login|inloggen/i })).toBeVisible();

  await page.getByLabel(/e-?mail/i).fill('not-a-demo@splashtrack.local');
  await page.getByLabel(/password|wachtwoord/i).fill('short');
  await page.getByRole('button', { name: /log in|inloggen/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('input[name="password"]:invalid')).toBeVisible();
  await expectHealthyPage(page, problems);
});

test('owner dashboard navigation covers top-level GUI routes without console errors', async ({ page }) => {
  const problems = monitorPageProblems(page);
  await login(page);

  const routes = [
    { path: '/dashboard', heading: /dashboard/i },
    { path: '/dashboard/students', heading: /student directory/i },
    { path: '/dashboard/students/new', heading: /nieuwe student/i },
    { path: '/dashboard/groups', heading: /zwemgroepen/i },
    { path: '/dashboard/groups/new', heading: /nieuwe zwemgroep/i },
    { path: '/dashboard/organization', heading: /splashtrack demo organization/i },
    { path: '/dashboard/organization/users', heading: /organization users/i },
    { path: '/dashboard/organization/users/new', heading: /nieuwe user/i },
    { path: '/dashboard/organization/welcome', heading: /welkomstpagina beheren/i },
    { path: '/dashboard/translations', heading: /vertalingen beheren/i },
    { path: '/forbidden', heading: /toegang geweigerd/i },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
    await expectHealthyPage(page, problems);
  }

  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: /navigatie|navigation/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: /navigatie|navigation/i }).getByRole('link', { name: /studenten|students/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: /navigatie|navigation/i }).getByRole('link', { name: /groepen|groups/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /gebruikers|users/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /uitloggen|sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('student directory supports search, create, edit and lifecycle mutations', async ({ page }) => {
  const problems = monitorPageProblems(page);
  const marker = `${Date.now()}`;
  const fullName = `${e2ePrefix} Student ${marker} Regression`;

  await login(page);
  await page.goto('/dashboard/students');
  await page.getByLabel('Zoek student of niveau').fill('Mila');
  await page.getByRole('button', { name: 'Toepassen' }).click();
  await expect(page.getByRole('status')).toContainText(/zoekterm: “Mila”/i);
  await page.getByRole('link', { name: 'Reset' }).click();
  await expectHealthyPage(page, problems);

  await createStudentThroughUi(page, marker);
  await page.getByRole('link', { name: fullName }).click();
  await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lifecycle' })).toBeVisible();

  await page.getByRole('link', { name: 'Student bewerken' }).click();
  await page.locator('input[name="swimLevel"]').fill(`E2E Updated ${marker}`);
  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page).toHaveURL(/\/dashboard\/students\//);
  await expect(page.locator('.meta-grid dd').filter({ hasText: `E2E Updated ${marker}` }).first()).toBeVisible();

  await page.getByRole('button', { name: /student deactiveren/i }).click();
  await expect(page.getByText(/is gedeactiveerd/i)).toBeVisible();
  await expect(page.getByText(/^Inactief$/)).toBeVisible();
  await expectHealthyPage(page, problems);
});

test('group management supports create, edit, enroll, remove and lifecycle mutations', async ({ page }) => {
  const problems = monitorPageProblems(page);
  const marker = `${Date.now()}`;
  const groupName = `${e2ePrefix} Group ${marker}`;
  const studentName = `${e2ePrefix} Student ${marker} Regression`;

  await login(page);
  await createStudentThroughUi(page, marker);

  await page.goto('/dashboard/groups/new');
  await page.getByLabel('Groepsnaam').fill(groupName);
  await page.getByLabel('Niveau').fill(`E2E Niveau ${marker}`);
  await page.getByLabel('Status').selectOption('true');
  await page.getByRole('button', { name: 'Groep aanmaken' }).click();
  await expect(page).toHaveURL(/\/dashboard\/groups\//);
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible();

  await page.getByRole('link', { name: 'Groep bewerken' }).click();
  await expect(page).toHaveURL(/\/dashboard\/groups\/[^/]+\/edit$/);
  await page.locator('input[name="swimLevel"]').fill(`E2E Niveau Updated ${marker}`);
  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page.locator('.meta-grid dd').filter({ hasText: `E2E Niveau Updated ${marker}` }).first()).toBeVisible();

  await page.getByLabel('Student').selectOption({ label: `${studentName} (E2E Niveau ${marker})` });
  await page.getByRole('button', { name: 'Student inschrijven' }).click();
  await expect(page.getByText(new RegExp(`${studentName} is ingeschreven`))).toBeVisible();
  await expect(page.getByRole('link', { name: studentName })).toBeVisible();

  await page.getByRole('button', { name: `${studentName} uitschrijven` }).click();
  await expect(page.getByRole('link', { name: studentName })).toHaveCount(0);

  await page.getByRole('button', { name: 'Groep deactiveren' }).click();
  await expect(page.getByText(/is gedeactiveerd/i)).toBeVisible();
  await expect(page.getByText(/^Inactief$/)).toBeVisible();
  await expectHealthyPage(page, problems);
});

test('organization user admin supports create and edit with isolated test users', async ({ page }) => {
  const problems = monitorPageProblems(page);
  const marker = `${Date.now()}`;
  const email = `gui-${marker}@e2e.splashtrack.local`;
  const updatedEmail = `gui-${marker}-updated@e2e.splashtrack.local`;

  await login(page);
  await page.goto('/dashboard/organization/users/new');
  await page.getByLabel('Naam').fill(`${e2ePrefix} User ${marker}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Wachtwoord').fill('E2ePassword123!');
  await page.getByLabel('Rol').selectOption('MEMBER');
  await page.getByRole('button', { name: 'User aanmaken' }).click();
  await expect(page).toHaveURL(/\/dashboard\/organization\/users$/);
  await expect(page.getByText(email)).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: email });
  await row.getByRole('link', { name: 'Bewerken' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`${e2ePrefix} User ${marker} bijwerken`) })).toBeVisible();
  await page.getByLabel('Naam').fill(`${e2ePrefix} User ${marker} Updated`);
  await page.getByLabel('E-mail').fill(updatedEmail);
  await page.getByLabel('Status').selectOption('false');
  await page.getByRole('button', { name: 'Wijzigingen opslaan' }).click();
  await expect(page).toHaveURL(/\/dashboard\/organization\/users$/);
  await expect(page.getByText(updatedEmail)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: updatedEmail })).toContainText('Inactief');
  await expectHealthyPage(page, problems);
});

test('member access is limited to non-admin dashboard routes', async ({ page }) => {
  const problems = monitorPageProblems(page);
  await login(page, 'demo.member@splashtrack.local', 'DemoMember123!', '/dashboard');

  await expect(page.getByRole('link', { name: /organization/i })).toHaveCount(0);
  await page.goto('/dashboard/organization');
  await expect(page.getByRole('heading', { name: /toegang geweigerd/i })).toBeVisible();
  await page.goto('/dashboard/organization/welcome');
  await expect(page.getByRole('heading', { name: /toegang geweigerd/i })).toBeVisible();
  await page.goto('/dashboard/students');
  await expect(page.getByRole('heading', { name: /student directory/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nieuwe student' })).toHaveCount(0);
  await expectHealthyPage(page, problems);
});
