import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points the plugin at the request configuration used for the cookie-based,
// no-URL-prefix i18n setup. No i18n routing middleware is added: the UI is
// Dutch by default with English available, and the locale never appears in a
// URL (D-159 governs identifiers, not what an instructor reads poolside).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next.js 16 dev servers only fully serve their client runtime (hydration,
  // HMR) to allowed origins; any other Host silently renders a working-looking
  // but non-interactive page. Add a reverse-proxied dev domain and/or direct
  // LAN IP here if you access the dev server from another device — a tablet on
  // the pool wifi is the expected case for this product. Dev-only setting; it
  // has no effect on production builds.
  allowedDevOrigins: [],
};

export default withNextIntl(nextConfig);
