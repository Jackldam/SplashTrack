import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
];

const coreRoutes = [
  { name: 'public-home', path: '/', auth: false },
  { name: 'login', path: '/login', auth: false },
  { name: 'dashboard', path: '/dashboard', auth: true },
  { name: 'students', path: '/dashboard/students', auth: true },
  { name: 'groups', path: '/dashboard/groups', auth: true },
  { name: 'organization', path: '/dashboard/organization', auth: true },
  { name: 'organization-users', path: '/dashboard/organization/users', auth: true },
  { name: 'organization-welcome', path: '/dashboard/organization/welcome', auth: true },
  { name: 'organization-suborgs', path: '/dashboard/organization/sub-organizations', auth: true },
  { name: 'organization-suborgs-new', path: '/dashboard/organization/sub-organizations/new', auth: true },
  { name: 'translations', path: '/dashboard/translations', auth: true },
];

async function login(page: Page) {
  await page.goto(`/login?redirectTo=${encodeURIComponent('/dashboard')}`);
  await page.getByLabel(/e-?mail/i).fill('demo.owner@splashtrack.local');
  await page.getByLabel(/wachtwoord|password/i).fill('DemoOwner123!');
  await page.getByRole('button', { name: /inloggen|sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function discoverDynamicRoutes(page: Page) {
  const routes: Array<{ name: string; path: string; auth: true }> = [];

  await page.goto('/dashboard/students');
  const studentHref = await page
    .locator('a[href^="/dashboard/students/"]:not([href$="/new"])')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (studentHref) {
    routes.push({ name: 'student-detail', path: studentHref, auth: true });
  }

  await page.goto('/dashboard/groups');
  const groupHref = await page
    .locator('a[href^="/dashboard/groups/"]:not([href$="/new"])')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (groupHref) {
    routes.push({ name: 'group-detail', path: groupHref, auth: true });
  }

  return routes;
}

async function assertResponsivePage(page: Page) {
  const metrics = await page.evaluate(() => {
    function isVisible(el: Element) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function rectFor(el: Element) {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function selectorFor(el: Element) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const classes = [...el.classList].slice(0, 3).map((className) => `.${CSS.escape(className)}`).join('');
      return `${el.tagName.toLowerCase()}${classes}`;
    }

    function overlaps(a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>) {
      return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
    }

    const doc = document.documentElement;
    const visibleElements = [...document.querySelectorAll('body *')].filter(isVisible);
    const overflowing = visibleElements
      .map((el) => ({ selector: selectorFor(el), text: (el.textContent || '').trim().slice(0, 80), rect: rectFor(el) }))
      .filter((item) => item.rect.x < -1 || item.rect.right > window.innerWidth + 1)
      .slice(0, 10);

    const smallTargets = [...document.querySelectorAll('button, a[href], select, textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])')]
      .filter(isVisible)
      .map((el) => ({ selector: selectorFor(el), text: ((el.getAttribute('aria-label') || el.textContent || '') as string).trim().slice(0, 80), rect: rectFor(el) }))
      .filter((item) => item.rect.height < 44)
      .slice(0, 10);

    const fixedElements = visibleElements.filter((el) => getComputedStyle(el).position === 'fixed');
    const fixedOverlaps = [];
    const checkedTargets = [...document.querySelectorAll('button, a[href], input, select, textarea, h1, h2')].filter(isVisible);
    for (const fixed of fixedElements) {
      const fixedRect = rectFor(fixed);
      for (const target of checkedTargets) {
        if (fixed === target || fixed.contains(target)) continue;
        const targetRect = rectFor(target);
        if (overlaps(fixedRect, targetRect)) {
          fixedOverlaps.push({ fixed: selectorFor(fixed), target: selectorFor(target), fixedRect, targetRect });
        }
      }
    }

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowing,
      smallTargets,
      fixedOverlaps: fixedOverlaps.slice(0, 10),
    };
  });

  expect(metrics.scrollWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.overflowing, JSON.stringify(metrics, null, 2)).toEqual([]);
  expect(metrics.smallTargets, JSON.stringify(metrics, null, 2)).toEqual([]);
  expect(metrics.fixedOverlaps, JSON.stringify(metrics, null, 2)).toEqual([]);
}

test.beforeAll(() => {
  execFileSync('npm', ['run', 'prisma:seed'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
});

test('core routes do not overflow or hide controls across responsive viewports', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const routes = [...coreRoutes, ...(await discoverDynamicRoutes(page))];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator('.language-selector')).toBeVisible();
      await assertResponsivePage(page);
      await page.screenshot({
        path: `test-results/responsive/${viewport.name}__${route.name}.png`,
        fullPage: true,
      });
    }
  }
});
