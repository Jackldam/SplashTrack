import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
const outDir = path.resolve('apps/web/test-results/ux-audit');
const viewports = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
];
const staticRoutes = [
  { name: 'public-home', path: '/', auth: false },
  { name: 'login', path: '/login', auth: false },
  { name: 'dashboard', path: '/dashboard', auth: true },
  { name: 'students', path: '/dashboard/students', auth: true },
  { name: 'students-new', path: '/dashboard/students/new', auth: true },
  { name: 'groups', path: '/dashboard/groups', auth: true },
  { name: 'groups-new', path: '/dashboard/groups/new', auth: true },
  { name: 'organization', path: '/dashboard/organization', auth: true },
  { name: 'organization-users', path: '/dashboard/organization/users', auth: true },
  { name: 'organization-users-new', path: '/dashboard/organization/users/new', auth: true },
  { name: 'translations', path: '/dashboard/translations', auth: true },
  { name: 'forbidden', path: '/forbidden', auth: true },
];

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

async function login(page) {
  await page.goto(`${baseURL}/login?redirectTo=${encodeURIComponent('/dashboard')}`, { waitUntil: 'networkidle' });
  await page.getByLabel(/e-?mail/i).fill('demo.owner@splashtrack.local');
  await page.getByLabel(/wachtwoord|password/i).fill('DemoOwner123!');
  await page.getByRole('button', { name: /inloggen|sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
}

async function discoverDynamicRoutes(page) {
  const routes = [];
  await page.goto(`${baseURL}/dashboard/students`, { waitUntil: 'networkidle' });
  const studentHref = await page.locator('a[href^="/dashboard/students/"]:not([href$="/new"])').first().getAttribute('href').catch(() => null);
  if (studentHref) {
    routes.push({ name: 'student-detail', path: studentHref, auth: true });
    routes.push({ name: 'student-edit', path: `${studentHref}/edit`, auth: true });
  }
  await page.goto(`${baseURL}/dashboard/groups`, { waitUntil: 'networkidle' });
  const groupHref = await page.locator('a[href^="/dashboard/groups/"]:not([href$="/new"])').first().getAttribute('href').catch(() => null);
  if (groupHref) {
    routes.push({ name: 'group-detail', path: groupHref, auth: true });
    routes.push({ name: 'group-edit', path: `${groupHref}/edit`, auth: true });
  }
  return routes;
}

async function auditPage(page, route, vp) {
  const url = `${baseURL}${route.path}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  const safeName = `${vp.name}__${route.name}`.replace(/[^a-z0-9_-]+/gi, '-');
  const screenshot = path.join(outDir, `${safeName}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const metrics = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    const fixedRects = [...document.querySelectorAll('*')]
      .filter((el) => getComputedStyle(el).position === 'fixed')
      .map((el) => ({ selector: selectorFor(el), text: (el.textContent || '').trim().slice(0, 80), rect: rectFor(el) }))
      .filter((x) => x.rect.width > 0 && x.rect.height > 0);

    function rectFor(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    }
    function selectorFor(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const cls = [...el.classList].slice(0, 3).map((c) => `.${CSS.escape(c)}`).join('');
      const name = el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : '';
      return `${el.tagName.toLowerCase()}${cls}${name}`;
    }
    function visible(el) {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
    }
    function accessibleName(el) {
      return el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim() || '';
    }
    function hasLabel(el) {
      const id = el.id;
      return Boolean(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label'));
    }
    function overlap(a,b) { return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y); }

    const all = [...document.querySelectorAll('body *')].filter(visible);
    const offenders = all.map((el) => ({ selector: selectorFor(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80), rect: rectFor(el) }))
      .filter((x) => x.rect.x < -1 || x.rect.right > vw + 1)
      .slice(0, 30);
    const unlabeledFields = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(visible).filter((el) => !hasLabel(el)).map((el) => ({ selector: selectorFor(el), type: el.tagName.toLowerCase(), name: el.getAttribute('name') || '', rect: rectFor(el) }));
    const namelessButtons = [...document.querySelectorAll('button, a[href]')].filter(visible).filter((el) => accessibleName(el).length === 0).map((el) => ({ selector: selectorFor(el), rect: rectFor(el) }));
    const smallTargets = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(visible).map((el) => ({ selector: selectorFor(el), text: accessibleName(el).slice(0, 50), rect: rectFor(el) })).filter((x) => x.rect.width < 44 || x.rect.height < 44).slice(0, 50);
    const fixedOverlaps = [];
    for (const f of fixedRects) {
      for (const el of [...document.querySelectorAll('button, a[href], input, select, textarea, h1, h2')].filter(visible)) {
        const r = rectFor(el);
        if (overlap(f.rect, r) && selectorFor(el) !== f.selector && !el.closest(f.selector)) {
          fixedOverlaps.push({ fixed: f, target: { selector: selectorFor(el), text: accessibleName(el).slice(0, 60), rect: r } });
        }
      }
    }
    const headings = [...document.querySelectorAll('h1,h2,h3')].filter(visible).map((el) => ({ level: el.tagName, text: el.textContent.trim().slice(0,100) }));
    const tableShells = [...document.querySelectorAll('.table-shell')].map((el) => ({ selector: selectorFor(el), rect: rectFor(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, hasHorizontalScroll: el.scrollWidth > el.clientWidth + 1 }));
    return {
      title: document.title,
      url: location.pathname + location.search,
      viewport: { width: vw, height: vh },
      doc: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1 },
      fixedRects, offenders, unlabeledFields, namelessButtons, smallTargets, fixedOverlaps, headings, tableShells,
    };
  });
  return { route, viewport: vp, screenshot, metrics };
}

const browser = await chromium.launch();
const results = [];
for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.width < 600, hasTouch: vp.width < 900 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(401|403|404)/i.test(m.text())) consoleErrors.push(m.text()); });
  await login(page);
  const dynamicRoutes = await discoverDynamicRoutes(page);
  const routes = [...staticRoutes, ...dynamicRoutes];
  for (const route of routes) {
    try {
      const r = await auditPage(page, route, vp);
      r.consoleErrors = [...consoleErrors];
      results.push(r);
    } catch (error) {
      results.push({ route, viewport: vp, error: String(error), consoleErrors: [...consoleErrors] });
    }
  }
  await context.close();
}
await browser.close();
await fs.writeFile(path.join(outDir, 'audit-results.json'), JSON.stringify(results, null, 2));
console.log(`UX audit complete: ${results.length} page/viewport results`);
console.log(`Artifacts: ${outDir}`);
for (const r of results) {
  if (r.error) console.log('ERROR', r.viewport.name, r.route.name, r.error);
  else {
    const m = r.metrics;
    const probs = [];
    if (m.doc.horizontalOverflow) probs.push(`doc overflow ${m.doc.scrollWidth}>${m.doc.clientWidth}`);
    if (m.offenders.length) probs.push(`${m.offenders.length} overflowing el`);
    if (m.unlabeledFields.length) probs.push(`${m.unlabeledFields.length} unlabeled fields`);
    if (m.namelessButtons.length) probs.push(`${m.namelessButtons.length} nameless links/buttons`);
    if (m.smallTargets.length) probs.push(`${m.smallTargets.length} small targets`);
    if (m.fixedOverlaps.length) probs.push(`${m.fixedOverlaps.length} fixed overlaps`);
    if (m.tableShells.some(t => t.hasHorizontalScroll)) probs.push(`${m.tableShells.filter(t => t.hasHorizontalScroll).length} scrolling tables`);
    if (probs.length) console.log(`${r.viewport.name} ${r.route.name} ${r.metrics.url}: ${probs.join('; ')}`);
  }
}
