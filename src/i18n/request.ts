/**
 * next-intl request configuration (ADR-006 — "App Router without i18n
 * routing", cookie-based).
 *
 * Resolves the active locale per request:
 *   1. an explicit `locale` cookie (a returning user's saved choice) wins;
 *   2. otherwise the organisation's admin-configured default locale (Settings →
 *      Localization, Phase 1b) applies;
 *   3. otherwise the built-in default (Dutch). The `Accept-Language` header is
 *      never consulted, so a fresh visitor sees the configured default until
 *      they explicitly switch via the language switcher.
 *
 * The resolved locale then selects the message catalogue, and the admin-
 * configured time zone is passed to next-intl so server-formatted dates render
 * consistently. The admin-configured display name is injected over the
 * `common.brand` message so EVERY brand reference (navbars, landing, footer, …)
 * follows the configured name without per-component wiring. The read is a light,
 * read-only, cached query (no write on this hot path). No middleware is involved
 * — the existing security middleware (CSP/nonce, request-id) is left untouched,
 * exactly as the ADR requires.
 */

import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import { getRequestConfigData } from "@/lib/settings";
import { defaultLocale, isLocale } from "./config";

export default getRequestConfig(async () => {
  const [cookieStore, { brandName, localization }] = await Promise.all([
    cookies(),
    getRequestConfigData(),
  ]);
  const cookieLocale = cookieStore.get("locale")?.value;

  // Cookie choice wins; else the admin default; else the built-in default.
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : (localization.defaultLocale ?? defaultLocale);

  // Inject the configured brand name over `common.brand` so every reference is
  // dynamic. Shallow-clone the affected branch — never mutate the cached import.
  const base = (await import(`../../messages/${locale}.json`)).default;
  const messages = brandName
    ? { ...base, common: { ...base.common, brand: brandName } }
    : base;

  return {
    locale,
    ...(localization.timeZone ? { timeZone: localization.timeZone } : {}),
    messages,
  };
});
