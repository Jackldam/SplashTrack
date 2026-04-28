import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWelcomePageContentFromFormData,
  defaultWelcomePageContent,
  isSafeWelcomeHref,
  parseWelcomeCards,
  resolveWelcomePageContent,
  welcomePageContentSchema,
} from './welcome-page';

test('default welcome content is valid and provides cards', () => {
  const result = welcomePageContentSchema.safeParse(defaultWelcomePageContent);

  assert.equal(result.success, true);
  assert.equal(defaultWelcomePageContent.cards.length > 0, true);
});

test('safe welcome links allow relative and https URLs only', () => {
  assert.equal(isSafeWelcomeHref('/dashboard/students'), true);
  assert.equal(isSafeWelcomeHref('https://example.com/start'), true);
  assert.equal(isSafeWelcomeHref('javascript:alert(1)'), false);
  assert.equal(isSafeWelcomeHref('http://example.com'), false);
  assert.equal(isSafeWelcomeHref('//evil.example'), false);
});

test('welcome validation enforces card limit and paired CTA fields', () => {
  const tooManyCards = welcomePageContentSchema.safeParse({
    ...defaultWelcomePageContent,
    cards: [
      { title: 'One', body: 'Body' },
      { title: 'Two', body: 'Body' },
      { title: 'Three', body: 'Body' },
      { title: 'Four', body: 'Body' },
    ],
  });
  assert.equal(tooManyCards.success, false);

  const missingCtaLabel = welcomePageContentSchema.safeParse({
    ...defaultWelcomePageContent,
    ctaLabel: '',
    ctaHref: '/dashboard',
  });
  assert.equal(missingCtaLabel.success, false);
});

test('resolveWelcomePageContent falls back when stored content is invalid', () => {
  const resolved = resolveWelcomePageContent({
    title: '',
    subtitle: null,
    body: '',
    ctaLabel: null,
    ctaHref: 'javascript:alert(1)',
    cards: [{ title: '', body: '' }],
  });

  assert.equal(resolved.title, defaultWelcomePageContent.title);
});

test('parseWelcomeCards rejects malformed cards without throwing', () => {
  assert.deepEqual(parseWelcomeCards('not-json'), []);
  assert.deepEqual(parseWelcomeCards([{ title: 'Valid', body: 'Plain text', href: '/dashboard' }]), [
    { title: 'Valid', body: 'Plain text', href: '/dashboard' },
  ]);
});

test('buildWelcomePageContentFromFormData trims fields and rejects unsafe CTA href', () => {
  const formData = new FormData();
  formData.set('title', '  Custom welcome ');
  formData.set('body', ' Hello team ');
  formData.set('ctaLabel', 'Click');
  formData.set('ctaHref', 'javascript:alert(1)');

  const result = buildWelcomePageContentFromFormData(formData);

  assert.equal(result.success, false);
});
