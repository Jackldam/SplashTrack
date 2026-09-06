import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * The way back. On every page, because it is in the root layout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS IN THE LAYOUT AND NOT IN THE PAGES
 *
 * `groups` shipped with no link INTO it, and the fix was one line on the
 * landing page plus a comment asking the next author to remember. The way OUT
 * had the same shape and the same outcome: `/people` and `/groups` had nothing
 * on them that led anywhere but deeper, so the only escape from a list screen
 * was the browser's own chrome — which on a phone held above a wet tiled floor
 * is a gesture, not a target.
 *
 * A comment asking future authors to remember is not a mechanism. The layout
 * IS one: a module cannot render a page outside it, so a module cannot ship
 * without this. `tests/unit/navigation-shell.test.ts` holds the invariant so a
 * later refactor cannot quietly drop it either.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ONLY A HOME LINK
 *
 * The smallest thing that works. The landing page already carries the entry to
 * every module, so "home" is one tap from anywhere and the module you want is
 * the tap after it.
 *
 * Module links HERE would need to know whether the caller is signed in — this
 * header renders on `/sign-in` and inside the setup wizard too — and a header
 * that names `Mensen` and `Groepen` to an anonymous visitor discloses what this
 * installation has before anybody has authenticated, which is the failure
 * `access.tsx` describes. Reading the session to avoid that buys a second tap
 * at the cost of putting authorization state into the layout. So: no session
 * read, nothing disclosed, one target.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WET HANDS
 *
 * The tap target is `--st-touch-target-min` — the same 48px `globals.css`
 * already fixes for buttons, not a second opinion about it — and the bar is
 * `sticky-top`, so the way home does not scroll off a long roster.
 */
export async function AppHeader() {
  const t = await getTranslations();

  return (
    <header className="border-bottom bg-body sticky-top">
      <nav className="container" aria-label={t("common.mainNavigation")}>
        <Link
          className="st-home-link fw-semibold text-body text-decoration-none"
          href="/"
        >
          <span aria-hidden="true">🏊</span> {t("common.brand")}
          <span className="visually-hidden"> — {t("common.toHome")}</span>
        </Link>
      </nav>
    </header>
  );
}
