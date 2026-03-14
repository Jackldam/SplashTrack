import Link from 'next/link';

import { SignOutButton } from '@/app/dashboard/sign-out-button';
import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { canAccessOrganizationAdmin } from '@/lib/organization-admin';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const displayName = authContext.session.user.name ?? authContext.session.user.email;
  const showOrganizationAdmin = canAccessOrganizationAdmin(authContext);

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div>
          <p className="eyebrow">Batch 6 admin foundation</p>
          <h1>Dashboard</h1>
          <p>
            Protected shell op Better Auth + Prisma. Ingelogde users met actieve membership mogen
            hier binnen; organization admin onderdelen blijven beperkt tot OWNER/ADMIN.
          </p>
        </div>

        <dl className="meta-grid dashboard-meta-grid">
          <div>
            <dt>User</dt>
            <dd>{displayName}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{authContext.membership?.role ?? 'Geen membership'}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{authContext.membership?.organization.name ?? 'Niet gekoppeld'}</dd>
          </div>
          <div>
            <dt>Capabilities</dt>
            <dd>{authContext.capabilities.join(', ')}</dd>
          </div>
        </dl>

        <nav className="dashboard-nav" aria-label="Dashboard navigatie">
          <Link className="button secondary-button" href="/">
            Home
          </Link>
          <Link className="button secondary-button" href="/dashboard">
            Overview
          </Link>
          {showOrganizationAdmin ? (
            <Link className="button secondary-button" href="/dashboard/organization">
              Organization
            </Link>
          ) : null}
          <Link className="button secondary-button" href="/forbidden">
            Forbidden state
          </Link>
          <SignOutButton />
        </nav>
      </aside>

      <main className="dashboard-main">{children}</main>
    </div>
  );
}
