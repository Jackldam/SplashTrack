/**
 * Date/time formatting driven by the organisation's localization settings
 * (Architecture.md Section 4.4). The admin picks a locale, an IANA time zone and
 * one of a CLOSED set of presentation styles; this module maps that style to a
 * FIXED `Intl.DateTimeFormat` option set — the admin never supplies raw tokens,
 * so there is no format-string injection surface.
 *
 * Isomorphic and dependency-free: usable from server components and client alike.
 */

import { defaultLocale, type Locale } from "@/i18n/config";
import type { DateFormat, OrganizationConfig } from "./config";

/** The fixed Intl options for each closed presentation style. */
export function dateFormatOptions(
  format: DateFormat,
): Intl.DateTimeFormatOptions {
  switch (format) {
    case "short":
      // e.g. 15-07-2026, 08:41
      return { dateStyle: "short", timeStyle: "short" };
    case "long":
      // e.g. 15 July 2026 at 08:41:07
      return { dateStyle: "long", timeStyle: "medium" };
    case "medium":
    default:
      // e.g. 15 Jul 2026, 08:41
      return { dateStyle: "medium", timeStyle: "short" };
  }
}

/**
 * Formats a timestamp using the organisation's configured locale, time zone and date
 * style. Falls back to the built-in default locale and the runtime's own zone
 * when a setting is unset. Never throws on a bad date — returns an empty string.
 */
export function formatDateTime(
  value: Date | string | number,
  localization: OrganizationConfig["localization"],
  localeOverride?: Locale,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const locale = localeOverride ?? localization.defaultLocale ?? defaultLocale;
  const options = dateFormatOptions(localization.dateFormat);
  if (localization.timeZone) options.timeZone = localization.timeZone;
  // Clock convention: `system` leaves the locale default; otherwise force it.
  if (localization.timeFormat === "24h") options.hour12 = false;
  else if (localization.timeFormat === "12h") options.hour12 = true;

  return new Intl.DateTimeFormat(locale, options).format(date);
}
