import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getCourseSummary } from '@/lib/course-admin';

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

export default async function CoursesPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const canManageCourses =
    authContext.membership?.role === APP_ROLES.OWNER ||
    authContext.membership?.role === APP_ROLES.ADMIN;

  const summary = await getCourseSummary(authContext);

  if (!summary) {
    return null;
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cursusbeheer</p>
            <h2>Cursussen</h2>
          </div>
          {canManageCourses ? (
            <Link className="button" href="/dashboard/courses/new">
              Nieuwe cursus
            </Link>
          ) : null}
        </div>

        <p>
          Beheer zwemcursussen per niveau. Cursussen bevatten vaardigheden en studenten kunnen
          worden ingeschreven per cursus.
        </p>

        <dl className="meta-grid">
          <div>
            <dt>Organization</dt>
            <dd>{summary.organization.name}</dd>
          </div>
          <div>
            <dt>Totaal cursussen</dt>
            <dd>{summary.metrics.totalCourses}</dd>
          </div>
          <div>
            <dt>Actief</dt>
            <dd>{summary.metrics.activeCourses}</dd>
          </div>
          <div>
            <dt>Inactief</dt>
            <dd>{summary.metrics.inactiveCourses}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Overzicht</p>
            <h3>Alle cursussen</h3>
          </div>
        </div>

        {summary.courses.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Cursussen overzicht">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Niveau</th>
                  <th>Vaardigheden</th>
                  <th>Deelnemers</th>
                  <th>Status</th>
                  <th>Aangemaakt</th>
                  {canManageCourses ? <th>Actie</th> : null}
                </tr>
              </thead>
              <tbody>
                {summary.courses.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <Link className="text-link" href={`/dashboard/courses/${course.id}`}>
                        {course.name}
                      </Link>
                    </td>
                    <td>{course.swimLevel}</td>
                    <td>{course.skillCount}</td>
                    <td>{course.enrollmentCount}</td>
                    <td>{course.isActive ? 'Actief' : 'Inactief'}</td>
                    <td>{formatDate(course.createdAt)}</td>
                    {canManageCourses ? (
                      <td>
                        <Link
                          className="text-link"
                          href={`/dashboard/courses/${course.id}/edit`}
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
            <h4>Nog geen cursussen</h4>
            <p>
              Maak een eerste cursus aan om studenten in te schrijven en vaardigheden bij te
              houden.
            </p>
            {canManageCourses ? (
              <Link className="button" href="/dashboard/courses/new">
                Eerste cursus aanmaken
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
