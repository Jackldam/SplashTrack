/**
 * Shared internationalization configuration (ADR-006).
 *
 * The platform's primary language is Dutch (`nl`); English (`en`) is offered
 * as a switchable option. Locale is stored in a `locale` cookie and never
 * encoded in the URL (no `[locale]` route segment), so this module is the
 * single source of truth for the supported locales. A fresh visitor with no
 * `locale` cookie always resolves to the Dutch default (see
 * `src/i18n/request.ts`) — the `Accept-Language` header is never consulted,
 * so English is only ever served after an explicit choice via the language
 * switcher.
 */

export const locales = ["nl", "en"] as const;

export type Locale = (typeof locales)[number];

/** Default locale used when nothing else can be determined (Section 4.4). */
export const defaultLocale: Locale = "nl";

/** Name of the cookie holding the user's explicit locale choice. */
export const LOCALE_COOKIE = "locale";

/** Type guard narrowing an arbitrary string to a supported `Locale`. */
export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
