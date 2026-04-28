import Link from 'next/link';

import { SignOutButton } from '@/app/dashboard/sign-out-button';
import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { dictionary, getCopyLanguage, getCurrentLanguage } from '@/lib/i18n';
import { canAccessOrganizationAdmin } from '@/lib/organization-admin';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [authContext, language] = await Promise.all([
    requireAuthContext({
      capability: CAPABILITIES.dashboardAccess,
    }),
    getCurrentLanguage(),
  ]);
  const copy = dictionary[getCopyLanguage(language)];

  const displayName = authContext.session.user.name ?? authContext.session.user.email;
  const showOrganizationAdmin = canAccessOrganizationAdmin(authContext);

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div>
          <p className="eyebrow">SplashTrack</p>
          <h1>Dashboard</h1>
          <p>{copy.dashboard.sidebarIntro}</p>
        </div>

        <dl className="meta-grid dashboard-meta-grid">
          <div>
            <dt>{copy.dashboard.user}</dt>
            <dd>{displayName}</dd>
          </div>
          <div>
            <dt>{copy.dashboard.role}</dt>
            <dd>{authContext.membership?.role ?? copy.dashboard.noMembership}</dd>
          </div>
          <div>
            <dt>{copy.dashboard.organization}</dt>
            <dd>{authContext.membership?.organization.name ?? copy.dashboard.notLinked}</dd>
          </div>
          <div>
            <dt>{copy.dashboard.capabilities}</dt>
            <dd>{authContext.capabilities.join(', ')}</dd>
          </div>
        </dl>

        <nav className="dashboard-nav" aria-label={copy.dashboard.navLabel}>
          <Link className="button secondary-button" href="/">
            Home
          </Link>
          <Link className="button secondary-button" href="/dashboard">
            {copy.common.dashboard}
          </Link>
          <Link className="button secondary-button" href="/dashboard/students">
            {copy.common.students}
          </Link>
          <Link className="button secondary-button" href="/dashboard/groups">
            {copy.common.groups}
          </Link>
          {showOrganizationAdmin ? (
            <>
              <Link className="button secondary-button" href="/dashboard/organization">
                {copy.common.organization}
              </Link>
              <Link className="button secondary-button" href="/dashboard/organization/users">
                {copy.common.users}
              </Link>
              <Link className="button secondary-button" href="/dashboard/organization/welcome">
                {copy.common.welcomePage}
              </Link>
              <Link className="button secondary-button" href="/dashboard/translations">
                Translations
              </Link>
            </>
          ) : null}
          <SignOutButton label={copy.common.signOut} pendingLabel={copy.login.pending} />
        </nav>
      </aside>

      <main className="dashboard-main">{children}</main>
    </div>
  );
}
