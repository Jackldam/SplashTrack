import Link from 'next/link';

import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { dictionary, getCopyLanguage, getCurrentLanguage } from '@/lib/i18n';
import { canAccessOrganizationAdmin } from '@/lib/organization-admin';
import { prisma } from '@/lib/prisma';
import { resolveWelcomePageContent, type WelcomePageCard } from '@/lib/welcome-page';

function WelcomeLink({ className, href, children }: { className: string; href: string; children: React.ReactNode }) {
  const isExternal = href.startsWith('https://');

  return isExternal ? (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ) : (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}

function WelcomeCard({ card }: { card: WelcomePageCard }) {
  return (
    <article>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      {card.href && card.linkLabel ? (
        <WelcomeLink className="text-link" href={card.href}>
          {card.linkLabel}
        </WelcomeLink>
      ) : null}
    </article>
  );
}

export default async function DashboardPage() {
  const [authContext, language] = await Promise.all([
    requireAuthContext({
      capability: CAPABILITIES.dashboardAccess,
    }),
    getCurrentLanguage(),
  ]);
  const copy = dictionary[getCopyLanguage(language)];

  const organizationId = authContext.membership?.organization.id;
  const welcomePage = organizationId
    ? await prisma.organizationWelcomePage.findUnique({
        where: { organizationId },
        select: {
          title: true,
          subtitle: true,
          body: true,
          ctaLabel: true,
          ctaHref: true,
          cards: true,
        },
      })
    : null;
  const welcome = resolveWelcomePageContent(welcomePage);
  const showOrganizationAdmin = canAccessOrganizationAdmin(authContext);

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel welcome-hero-panel">
        <p className="eyebrow">{copy.dashboard.welcomeEyebrow}</p>
        <h2>{welcome.title}</h2>
        {welcome.subtitle ? <p className="welcome-subtitle">{welcome.subtitle}</p> : null}
        <p className="welcome-body">{welcome.body}</p>
        {welcome.ctaHref && welcome.ctaLabel ? (
          <div className="actions-row">
            <WelcomeLink className="button" href={welcome.ctaHref}>
              {welcome.ctaLabel}
            </WelcomeLink>
            {showOrganizationAdmin ? (
              <Link className="button secondary-button" href="/dashboard/organization/welcome">
                {copy.dashboard.editWelcomePage}
              </Link>
            ) : null}
          </div>
        ) : showOrganizationAdmin ? (
          <div className="actions-row">
            <Link className="button secondary-button" href="/dashboard/organization/welcome">
              {copy.dashboard.editWelcomePage}
            </Link>
          </div>
        ) : null}
      </section>

      {welcome.cards.length > 0 ? (
        <section className="welcome-card-grid" aria-label={copy.dashboard.welcomeCardsLabel}>
          {welcome.cards.map((card) => (
            <WelcomeCard card={card} key={`${card.title}-${card.body}`} />
          ))}
        </section>
      ) : null}

      <section className="dashboard-panel">
      <p className="eyebrow">{copy.dashboard.routeEyebrow}</p>
      <h2>{copy.dashboard.title}</h2>
      <p>{copy.dashboard.intro}</p>

      <div className="status-grid">
        <article>
          <h3>{copy.dashboard.authGuard}</h3>
          <p>{copy.dashboard.authGuardBody}</p>
        </article>
        <article>
          <h3>{copy.dashboard.rbacGuard}</h3>
          <p>{copy.dashboard.rbacGuardBody}</p>
        </article>
        <article>
          <h3>{copy.dashboard.organizationShell}</h3>
          <p>{copy.dashboard.organizationShellBody}</p>
        </article>
      </div>

      <div className="callout-card">
        <h3>{copy.dashboard.studentDirectory}</h3>
        <p>{copy.dashboard.studentDirectoryBody}</p>
        <Link className="button" href="/dashboard/students">
          {copy.dashboard.openStudentDirectory}
        </Link>
      </div>

      {showOrganizationAdmin ? (
        <div className="callout-card">
          <h3>{copy.dashboard.organizationAdmin}</h3>
          <p>{copy.dashboard.organizationAdminBody}</p>
          <div className="actions-row">
            <Link className="button" href="/dashboard/organization">
              {copy.dashboard.openOrganizationShell}
            </Link>
            <Link className="button secondary-button" href="/dashboard/organization/users">
              {copy.dashboard.openUserAdmin}
            </Link>
          </div>
        </div>
      ) : (
        <div className="callout-card subtle-card">
          <h3>{copy.dashboard.limitedAccess}</h3>
          <p>{copy.dashboard.limitedAccessBody}</p>
        </div>
      )}
      </section>
    </div>
  );
}
