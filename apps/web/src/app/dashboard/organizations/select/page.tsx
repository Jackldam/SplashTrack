import { redirect } from 'next/navigation';

import { selectActiveOrganizationAction } from '@/lib/organization-selection-actions';
import { getAuthContext } from '@/lib/authz';

export default async function OrganizationSelectPage() {
  const authContext = await getAuthContext({ allowMissingActiveOrganization: true });

  if (!authContext?.session.user) {
    redirect('/login?redirectTo=/dashboard/organizations/select');
  }

  if (authContext.allMemberships.length === 0) {
    redirect('/forbidden');
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <p className="eyebrow">Organization selector</p>
        <h2>Kies actieve organization</h2>
        <p>
          Je account heeft toegang tot meerdere organizations. Kies expliciet welke tenant je wilt
          beheren; alle dashboarddata wordt daarna op die organization gescoped.
        </p>

        <div className="card-grid">
          {authContext.allMemberships.map((membership) => (
            <form action={selectActiveOrganizationAction} className="dashboard-panel compact-panel" key={membership.id}>
              <input type="hidden" name="organizationSlug" value={membership.organization.slug} />
              <h3>{membership.organization.name}</h3>
              <p className="section-note">
                {membership.organization.parentOrganization
                  ? `Sub-organization van ${membership.organization.parentOrganization.name}`
                  : 'Head organization'}
              </p>
              <dl className="meta-grid">
                <div>
                  <dt>Slug</dt>
                  <dd>{membership.organization.slug}</dd>
                </div>
                <div>
                  <dt>Rol</dt>
                  <dd>{membership.role}</dd>
                </div>
              </dl>
              <button className="button" type="submit">
                Activeer {membership.organization.name}
              </button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
