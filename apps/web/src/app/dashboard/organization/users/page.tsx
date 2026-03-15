import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getOrganizationUsers } from '@/lib/user-admin';

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
          Eerste GUI-laag voor userbeheer binnen de huidige organization. Je kunt users bekijken,
          aanmaken en bijwerken zonder direct in Prisma of seed-data te hoeven zitten.
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
                  <td>{user.name ?? 'Onbekend'}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{user.userIsActive ? 'Actief' : 'Inactief'}</td>
                  <td>{user.membershipIsActive ? 'Actief' : 'Inactief'}</td>
                  <td>{user.emailVerified ? 'Verified' : 'Unverified'}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td>
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
