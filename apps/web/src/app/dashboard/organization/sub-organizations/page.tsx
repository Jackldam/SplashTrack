import Link from 'next/link';

import { CAPABILITIES, requireAuthContext } from '@/rbac/index';
import { getSubOrganizationList } from '@/features/organizations/sub-admin';

export default async function SubOrganizationsPage() {
  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationSuborgManage });
  const organizations = await getSubOrganizationList(authContext);

  if (!organizations) return null;

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Head organization</p><h2>Sub-organizations</h2></div>
          <Link className="button" href="/dashboard/organization/sub-organizations/new">Nieuwe sub-organization</Link>
        </div>
        <p>Beheer directe child organizations van de actieve head organization. Nesting is bewust geblokkeerd voor deze MVP.</p>
        <div className="table-shell" role="region" aria-label="Sub-organizations overzicht">
          <table className="data-table"><thead><tr><th>Naam</th><th>Slug</th><th>Status</th><th>Members</th><th>Students</th><th>Groups</th><th>Acties</th></tr></thead><tbody>
            {organizations.map((organization) => (
              <tr key={organization.id}>
                <td data-label="Naam">{organization.name}</td><td data-label="Slug">{organization.slug}</td><td data-label="Status">{organization.isActive ? 'Actief' : 'Inactief'}</td><td data-label="Members">{organization._count.members}</td><td data-label="Students">{organization._count.students}</td><td data-label="Groups">{organization._count.swimGroups}</td><td data-label="Acties"><Link className="text-link" href={`/dashboard/organization/sub-organizations/${organization.id}/edit`}>Bewerk</Link> · <Link className="text-link" href={`/dashboard/organization/sub-organizations/${organization.id}/users`}>Users</Link></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </section>
    </div>
  );
}
