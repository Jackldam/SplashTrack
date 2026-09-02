import { getTranslations } from "next-intl/server";

/**
 * A placeholder landing page, and deliberately nothing more.
 *
 * Phase 0.2 is the foundation: there is no domain module, so there is nothing
 * honest to show. The public course catalogue and inquiry form (R-12, reduced)
 * are a phase 4 surface.
 *
 * This page exists so `next build` has a route to build and so the E2E harness
 * has something to load — not as the beginning of a design.
 */
export default async function LandingPage() {
  const t = await getTranslations();

  return (
    <main className="container py-5">
      <h1>{t("landing.title")}</h1>
      <p className="lead">{t("landing.tagline")}</p>
      <p className="text-muted">{t("landing.foundationNotice")}</p>
    </main>
  );
}
