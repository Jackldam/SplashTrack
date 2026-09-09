import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { getPublicOrganizationConfig } from "@/lib/settings";

// Bootstrap first, so application styles can override it.
import "bootstrap/dist/css/bootstrap.min.css";
import "./globals.css";

/**
 * Metadata. The description is the administrator-configured SEO value when set
 * — plain, length-bounded text set through Next's Metadata API, which
 * output-encodes it; it is never interpolated into markup by us.
 *
 * Branding (logo, favicon, theme colours) is NOT here: it is a phase 4 surface
 * and its uploaded-asset machinery was not extracted.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, { config }] = await Promise.all([
    getTranslations(),
    getPublicOrganizationConfig(),
  ]);
  const brand = t("common.brand");
  const description = config.seo.metaDescription ?? t("landing.tagline");

  return {
    title: { default: brand, template: `%s | ${brand}` },
    description,
    openGraph: { title: brand, description },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Extracts the per-request CSP nonce that `middleware.ts` set on the request
 * headers. Next applies it to the inline scripts it manages on its own; reading
 * it here is what makes the value available should a layout ever need to emit
 * an inline script of its own.
 */
async function requestNonce(): Promise<string | undefined> {
  const csp = (await headers()).get("Content-Security-Policy");
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  await requestNonce();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
