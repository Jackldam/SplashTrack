/**
 * Server Action for changing the active UI locale (ADR-006).
 *
 * The language switcher calls this to persist the user's choice in the
 * `locale` cookie. It is intentionally NOT httpOnly — the value is a public UI
 * preference, not a secret, and there is no benefit to hiding it from client
 * scripts. After the cookie is set the caller re-renders (router.refresh),
 * which re-runs `i18n/request.ts` and serves the newly chosen language.
 */

"use server";

import { cookies } from "next/headers";

import { isLocale, LOCALE_COOKIE } from "./config";

/** One year, in seconds — the choice should persist across sessions. */
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
  });
}
