import { z } from 'zod';

export const MAX_WELCOME_CARDS = 3;

export type WelcomePageCard = {
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
};

export type WelcomePageContent = {
  title: string;
  subtitle?: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
  cards: WelcomePageCard[];
};

export const defaultWelcomePageContent: WelcomePageContent = {
  title: 'Welkom bij SplashTrack',
  subtitle: 'Alles voor je zwemschool overzichtelijk op één plek.',
  body: 'Gebruik dit dashboard om studenten, groepen en organisatie-instellingen veilig te beheren.\n\nNieuwe gebruikers zien hier de belangrijkste startpunten voor jullie organisatie.',
  ctaLabel: 'Open studentoverzicht',
  ctaHref: '/dashboard/students',
  cards: [
    {
      title: 'Studenten beheren',
      body: 'Bekijk inschrijvingen, niveaus en statusinformatie per leerling.',
      href: '/dashboard/students',
      linkLabel: 'Naar studenten',
    },
    {
      title: 'Groepen plannen',
      body: 'Houd zwemgroepen en groepsleden overzichtelijk bij.',
      href: '/dashboard/groups',
      linkLabel: 'Naar groepen',
    },
    {
      title: 'Veilig samenwerken',
      body: 'Rechten zijn per organisatie en rol afgeschermd, zodat gegevens binnen de juiste tenant blijven.',
    },
  ],
};

function optionalTrimmedString(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));
}

export function isSafeWelcomeHref(value: string | undefined) {
  if (!value) {
    return true;
  }

  if (value.startsWith('/')) {
    return !value.startsWith('//') && !/[\u0000-\u001F\u007F]/.test(value);
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

const safeHrefSchema = optionalTrimmedString(500).refine(isSafeWelcomeHref, {
  message: 'Gebruik een relatieve link die met / begint of een veilige https:// URL.',
});

export const welcomePageCardSchema = z
  .object({
    title: z.string().trim().min(1, 'Kaarttitel is verplicht.').max(80, 'Kaarttitel is te lang.'),
    body: z.string().trim().min(1, 'Kaarttekst is verplicht.').max(240, 'Kaarttekst is te lang.'),
    href: safeHrefSchema,
    linkLabel: optionalTrimmedString(80),
  })
  .refine((card) => !card.linkLabel || card.href, {
    message: 'Een kaart-linktekst heeft ook een veilige link nodig.',
    path: ['linkLabel'],
  });

export const welcomePageContentSchema = z
  .object({
    title: z.string().trim().min(1, 'Titel is verplicht.').max(120, 'Titel is te lang.'),
    subtitle: optionalTrimmedString(180),
    body: z.string().trim().min(1, 'Bodytekst is verplicht.').max(2000, 'Bodytekst is te lang.'),
    ctaLabel: optionalTrimmedString(80),
    ctaHref: safeHrefSchema,
    cards: z.array(welcomePageCardSchema).max(MAX_WELCOME_CARDS, `Gebruik maximaal ${MAX_WELCOME_CARDS} kaarten.`),
  })
  .refine((content) => !content.ctaLabel || content.ctaHref, {
    message: 'Een CTA-label heeft ook een veilige CTA-link nodig.',
    path: ['ctaHref'],
  })
  .refine((content) => !content.ctaHref || content.ctaLabel, {
    message: 'Een CTA-link heeft ook een CTA-label nodig.',
    path: ['ctaLabel'],
  });

export function parseWelcomeCards(value: unknown): WelcomePageCard[] {
  const result = z.array(welcomePageCardSchema).max(MAX_WELCOME_CARDS).safeParse(value);
  return result.success ? result.data : [];
}

export function resolveWelcomePageContent(
  page:
    | {
        title: string;
        subtitle: string | null;
        body: string;
        ctaLabel: string | null;
        ctaHref: string | null;
        cards: unknown;
      }
    | null
    | undefined,
): WelcomePageContent {
  if (!page) {
    return defaultWelcomePageContent;
  }

  const parsed = welcomePageContentSchema.safeParse({
    title: page.title,
    subtitle: page.subtitle ?? undefined,
    body: page.body,
    ctaLabel: page.ctaLabel ?? undefined,
    ctaHref: page.ctaHref ?? undefined,
    cards: parseWelcomeCards(page.cards),
  });

  return parsed.success ? parsed.data : defaultWelcomePageContent;
}

export function buildWelcomePageContentFromFormData(formData: FormData) {
  const cards = Array.from({ length: MAX_WELCOME_CARDS }, (_, index) => {
    const title = String(formData.get(`cardTitle${index}`) ?? '').trim();
    const body = String(formData.get(`cardBody${index}`) ?? '').trim();
    const href = String(formData.get(`cardHref${index}`) ?? '').trim();
    const linkLabel = String(formData.get(`cardLinkLabel${index}`) ?? '').trim();

    if (!title && !body && !href && !linkLabel) {
      return null;
    }

    return { title, body, href: href || undefined, linkLabel: linkLabel || undefined };
  });

  const presentCards = cards.filter((card) => card !== null);

  return welcomePageContentSchema.safeParse({
    title: String(formData.get('title') ?? ''),
    subtitle: String(formData.get('subtitle') ?? ''),
    body: String(formData.get('body') ?? ''),
    ctaLabel: String(formData.get('ctaLabel') ?? ''),
    ctaHref: String(formData.get('ctaHref') ?? ''),
    cards: presentCards,
  });
}
