import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/rbac/index';
import { getOrganizationUsers } from '@/features/user-admin';

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export default async function OrganizationUsersPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const summary = await getOrganizationUsers(authContext);

  if (!summary) {
    return null;
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">User admin</p>
            <h2>Organization users</h2>
          </div>
          <div className="actions-row">
            <Link className="button secondary-button" href="/dashboard/organization">
              Terug naar organization
            </Link>
            <Link className="button" href="/dashboard/organization/users/new">
              Nieuwe user
            </Link>
          </div>
        </div>

        <p>
          Userbeheer binnen de huidige organization. Je kunt users bekijken, aanmaken en bijwerken.
        </p>
        <p className="section-note">
          Let op: verwijderen is bewust nog geen flow. Gebruik inactief zetten voor veilige lifecycle.
        </p>

        <div className="table-shell" role="region" aria-label="Organization users overzicht">
          <table className="data-table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Email</th>
                <th>Rol</th>
                <th>User</th>
                <th>Membership</th>
                <th>Verificatie</th>
                <th>Sinds</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {summary.users.map((user) => (
                <tr key={user.membershipId}>
                  <td data-label="Naam">{user.name ?? 'Onbekend'}</td>
                  <td data-label="Email">{user.email}</td>
                  <td data-label="Rol">{user.role}</td>
                  <td data-label="User">{user.userIsActive ? 'Actief' : 'Inactief'}</td>
                  <td data-label="Membership">{user.membershipIsActive ? 'Actief' : 'Inactief'}</td>
                  <td data-label="Verificatie">{user.emailVerified ? 'Verified' : 'Unverified'}</td>
                  <td data-label="Sinds">{formatDateTime(user.createdAt)}</td>
                  <td data-label="Actie">
                    <Link className="text-link" href={`/dashboard/organization/users/${user.membershipId}/edit`}>
                      Bewerken
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
