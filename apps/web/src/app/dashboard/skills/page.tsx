import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSkillSummary } from '@/lib/skill-admin';

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

export default async function SkillsPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const canManageSkills =
    authContext.membership?.role === APP_ROLES.OWNER ||
    authContext.membership?.role === APP_ROLES.ADMIN;

  const summary = await getSkillSummary(authContext);

  if (!summary) {
    return null;
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vaardigheidsbeheer</p>
            <h2>Vaardigheden</h2>
          </div>
          {canManageSkills ? (
            <Link className="button" href="/dashboard/skills/new">
              Nieuwe vaardigheid
            </Link>
          ) : null}
        </div>

        <p>
          Beheer zwemvaardigheden per niveau. Vaardigheden kunnen worden gekoppeld aan cursussen
          en worden bijgehouden per student.
        </p>

        <dl className="meta-grid">
          <div>
            <dt>Organization</dt>
            <dd>{summary.organization.name}</dd>
          </div>
          <div>
            <dt>Totaal vaardigheden</dt>
            <dd>{summary.metrics.totalSkills}</dd>
          </div>
          <div>
            <dt>Actief</dt>
            <dd>{summary.metrics.activeSkills}</dd>
          </div>
          <div>
            <dt>Inactief</dt>
            <dd>{summary.metrics.inactiveSkills}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Overzicht</p>
            <h3>Alle vaardigheden</h3>
          </div>
        </div>

        {summary.skills.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Vaardigheden overzicht">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Niveau</th>
                  <th>Cursussen</th>
                  <th>Status</th>
                  <th>Aangemaakt</th>
                  {canManageSkills ? <th>Actie</th> : null}
                </tr>
              </thead>
              <tbody>
                {summary.skills.map((skill) => (
                  <tr key={skill.id}>
                    <td>
                      <Link className="text-link" href={`/dashboard/skills/${skill.id}`}>
                        {skill.name}
                      </Link>
                    </td>
                    <td>{skill.swimLevel}</td>
                    <td>{skill.courseCount}</td>
                    <td>{skill.isActive ? 'Actief' : 'Inactief'}</td>
                    <td>{formatDate(skill.createdAt)}</td>
                    {canManageSkills ? (
                      <td>
                        <Link
                          className="text-link"
                          href={`/dashboard/skills/${skill.id}/edit`}
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
            <h4>Nog geen vaardigheden</h4>
            <p>
              Maak een eerste vaardigheid aan om bij te houden welke zwemvaardigheden studenten
              beheersen.
            </p>
            {canManageSkills ? (
              <Link className="button" href="/dashboard/skills/new">
                Eerste vaardigheid aanmaken
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
