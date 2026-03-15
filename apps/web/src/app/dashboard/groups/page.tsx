import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSwimGroupSummary } from '@/lib/swim-group-admin';

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

export default async function GroupsPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const canManageGroups =
    authContext.membership?.role === APP_ROLES.OWNER ||
    authContext.membership?.role === APP_ROLES.ADMIN;

  const summary = await getSwimGroupSummary(authContext);

  if (!summary) {
    return null;
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Groepsbeheer</p>
            <h2>Zwemgroepen</h2>
          </div>
          {canManageGroups ? (
            <Link className="button" href="/dashboard/groups/new">
              Nieuwe groep
            </Link>
          ) : null}
        </div>

        <p>
          Structureer studenten in zwemgroepen per niveau. Elke groep is gekoppeld aan de huidige
          organization en kan studenten bevatten onafhankelijk van hun individuele niveau.
        </p>

        <dl className="meta-grid">
          <div>
            <dt>Organization</dt>
            <dd>{summary.organization.name}</dd>
          </div>
          <div>
            <dt>Totaal groepen</dt>
            <dd>{summary.metrics.totalGroups}</dd>
          </div>
          <div>
            <dt>Actief</dt>
            <dd>{summary.metrics.activeGroups}</dd>
          </div>
          <div>
            <dt>Inactief</dt>
            <dd>{summary.metrics.inactiveGroups}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Overzicht</p>
            <h3>Alle groepen</h3>
          </div>
        </div>

        {summary.groups.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Zwemgroepen overzicht">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Niveau</th>
                  <th>Actieve deelnemers</th>
                  <th>Status</th>
                  <th>Aangemaakt</th>
                  {canManageGroups ? <th>Actie</th> : null}
                </tr>
              </thead>
              <tbody>
                {summary.groups.map((group) => (
                  <tr key={group.id}>
                    <td>
                      <Link className="text-link" href={`/dashboard/groups/${group.id}`}>
                        {group.name}
                      </Link>
                    </td>
                    <td>{group.swimLevel}</td>
                    <td>{group.memberCount}</td>
                    <td>{group.isActive ? 'Actief' : 'Inactief'}</td>
                    <td>{formatDate(group.createdAt)}</td>
                    {canManageGroups ? (
                      <td>
                        <Link
                          className="text-link"
                          href={`/dashboard/groups/${group.id}/edit`}
                        >
                          Bewerken
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h4>Nog geen zwemgroepen</h4>
            <p>
              Maak een eerste groep aan om studenten te structureren per level of klasse.
            </p>
            {canManageGroups ? (
              <Link className="button" href="/dashboard/groups/new">
                Eerste groep aanmaken
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
