import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getStudentDirectorySummary } from '@/lib/student-directory';

function formatDate(value: Date | null) {
  if (!value) {
    return 'Onbekend';
  }

  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

export default async function StudentsPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const canCreateStudent =
    authContext.membership?.role === APP_ROLES.OWNER || authContext.membership?.role === APP_ROLES.ADMIN;

  const summary = await getStudentDirectorySummary(authContext);

  if (!summary) {
    return null;
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <p className="eyebrow">Batch 9 student foundation</p>
        <h2>Student directory shell</h2>
        <p>
          Eerste kleine business-slice bovenop auth/org foundation: alleen server-side read-model
          voor studenten binnen de huidige organization, zonder inschrijfflows of attendance-mutaties.
        </p>

        <dl className="meta-grid">
          <div>
            <dt>Organization</dt>
            <dd>{summary.organization.name}</dd>
          </div>
          <div>
            <dt>Totaal</dt>
            <dd>{summary.metrics.totalStudents}</dd>
          </div>
          <div>
            <dt>Actief</dt>
            <dd>{summary.metrics.activeStudents}</dd>
          </div>
          <div>
            <dt>Inactief</dt>
            <dd>{summary.metrics.inactiveStudents}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Level spread</p>
            <h3>Actieve studenten per niveau</h3>
          </div>
          <p className="section-note">
            Bewust klein read-only overzicht voor snelle validatie van organization-gebonden studentdata.
          </p>
        </div>

        {summary.metrics.levelSpread.length > 0 ? (
          <div className="status-grid">
            {summary.metrics.levelSpread.map((entry) => (
              <article key={entry.swimLevel}>
                <h4>{entry.swimLevel}</h4>
                <p>{entry.count} actieve studenten</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h4>Nog geen actieve studentdata</h4>
            <p>Seed of latere businessflows moeten hier studenten opleveren.</p>
          </div>
        )}
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Directory</p>
            <h3>Huidige studenten</h3>
          </div>
          <div className="section-actions">
            <p className="section-note">
              Alleen technische read-model velden: naam, geboortedatum, niveau en actieve status.
            </p>
            {canCreateStudent ? (
              <Link className="button secondary-button" href="/dashboard/students/new">
                Nieuwe student
              </Link>
            ) : null}
          </div>
        </div>

        <div className="table-shell" role="region" aria-label="Studenten overzicht">
          <table className="data-table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Geboortedatum</th>
                <th>Niveau</th>
                <th>Status</th>
                <th>Sinds</th>
              </tr>
            </thead>
            <tbody>
              {summary.students.map((student) => (
                <tr key={student.id}>
                  <td>
                    <Link className="text-link" href={`/dashboard/students/${student.id}`}>
                      {student.displayName}
                    </Link>
                  </td>
                  <td>{formatDate(student.dateOfBirth)}</td>
                  <td>{student.swimLevel}</td>
                  <td>{student.isActive ? 'Actief' : 'Inactief'}</td>
                  <td>{formatDate(student.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
