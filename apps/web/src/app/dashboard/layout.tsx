import Link from 'next/link';

import { SignOutButton } from '@/app/dashboard/sign-out-button';
import { CAPABILITIES, requireAuthContext } from '@/rbac/index';
import { selectActiveOrganizationAction } from '@/features/organizations/selection-actions';
import { dictionary, getCopyLanguage, getCurrentLanguage } from '@/shared/i18n';
import { canAccessOrganizationAdmin } from '@/features/organizations/admin';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [authContext, language] = await Promise.all([
    requireAuthContext(
      {
        capability: CAPABILITIES.dashboardAccess,
      },
      { allowMissingActiveOrganization: true },
    ),
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
            <dt>Scope</dt>
            <dd>{authContext.isHeadOrganization ? 'Head organization' : 'Sub-organization'}</dd>
          </div>
          <div>
            <dt>{copy.dashboard.capabilities}</dt>
            <dd>{authContext.capabilities.join(', ')}</dd>
          </div>
        </dl>

        {authContext.allMemberships.length > 1 ? (
          <form action={selectActiveOrganizationAction} className="inline-form">
            <label className="sr-only" htmlFor="organizationSlug">
              Active organization
            </label>
            <select id="organizationSlug" name="organizationSlug" defaultValue={authContext.activeOrganization?.slug}>
              {authContext.allMemberships.map((membership) => (
                <option key={membership.id} value={membership.organization.slug}>
                  {membership.organization.name} ({membership.role})
                </option>
              ))}
            </select>
            <button className="button secondary-button" type="submit">
              Switch org
            </button>
          </form>
        ) : null}

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
              {authContext.capabilities.includes(CAPABILITIES.organizationSuborgManage) ? (
                <Link className="button secondary-button" href="/dashboard/organization/sub-organizations">
                  Sub-organizations
                </Link>
              ) : null}
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
