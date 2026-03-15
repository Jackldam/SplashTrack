import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import {
  buildStudentDirectoryStatusLabel,
  parseStudentDirectoryQuery,
  type StudentDirectoryStatusFilter,
} from '@/lib/student-directory-filters';
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

type StudentsPageProps = {
  searchParams?: Promise<{
    status?: string;
    search?: string;
  }>;
};

const STATUS_OPTIONS: Array<{ value: StudentDirectoryStatusFilter; label: string }> = [
  { value: 'all', label: 'Alle statussen' },
  { value: 'active', label: 'Actief' },
  { value: 'inactive', label: 'Inactief' },
];

function buildStudentsDirectoryHref(status: StudentDirectoryStatusFilter, search?: string) {
  const params = new URLSearchParams();

  if (status !== 'all') {
    params.set('status', status);
  }

  if (search) {
    params.set('search', search);
  }

  const query = params.toString();
  return query ? `/dashboard/students?${query}` : '/dashboard/students';
}

export default async function StudentsPage({ searchParams }: StudentsPageProps) {
  const [authContext, resolvedSearchParams] = await Promise.all([
    requireAuthContext({
      capability: CAPABILITIES.dashboardAccess,
    }),
    searchParams,
  ]);

  const canCreateStudent =
    authContext.membership?.role === APP_ROLES.OWNER || authContext.membership?.role === APP_ROLES.ADMIN;

  const directoryQuery = parseStudentDirectoryQuery({
    status: resolvedSearchParams?.status,
    search: resolvedSearchParams?.search,
  });

  const summary = await getStudentDirectorySummary(authContext, directoryQuery);

  if (!summary) {
    return null;
  }

  const filterSummary = summary.filters.search
    ? `${buildStudentDirectoryStatusLabel(summary.filters.status)} • zoekterm: “${summary.filters.search}”`
    : buildStudentDirectoryStatusLabel(summary.filters.status);

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <p className="eyebrow">Student directory</p>
        <h2>Student directory</h2>
        <p>
          Organization-gebonden studentbeheer met server-side filtering op status en zoekterm, als
          veilige basis voor verdere CRUD en operationele flows.
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
            Compact health-signaal voor de huidige organization; bewust nog los van attendance of
            groepsindeling.
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
              Filter op status of zoek op naam en niveau; de query blijft server-side en
              organization-scoped.
            </p>
            {canCreateStudent ? (
              <Link className="button secondary-button" href="/dashboard/students/new">
                Nieuwe student
              </Link>
            ) : null}
          </div>
        </div>

        <form className="directory-filter-form" method="get">
          <label className="field" htmlFor="student-directory-search">
            Zoek student of niveau
            <input
              defaultValue={summary.filters.search ?? ''}
              id="student-directory-search"
              maxLength={120}
              name="search"
              placeholder="Bijv. Mila, De Vries of Diploma A"
              type="search"
            />
          </label>

          <div className="directory-filter-actions">
            <div className="directory-filter-pills" aria-label="Status filter">
              {STATUS_OPTIONS.map((option) => {
                const href = buildStudentsDirectoryHref(option.value, summary.filters.search);
                const isCurrent = summary.filters.status === option.value;

                return (
                  <Link
                    key={option.value}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={`filter-pill${isCurrent ? ' filter-pill-active' : ''}`}
                    href={href}
                  >
                    {option.label}
                  </Link>
                );
              })}
            </div>

            <div className="directory-filter-buttons">
              <input name="status" type="hidden" value={summary.filters.status} />
              <button className="button secondary-button" type="submit">
                Toepassen
              </button>
              <Link className="button secondary-button" href="/dashboard/students">
                Reset
              </Link>
            </div>
          </div>
        </form>

        <div className="directory-filter-summary" role="status" aria-live="polite">
          <strong>{summary.filters.matchedStudents}</strong> studenten in resultaat • {filterSummary}
        </div>

        {summary.students.length > 0 ? (
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
        ) : (
          <div className="empty-state">
            <h4>Geen studenten gevonden</h4>
            <p>
              Er zijn geen studenten die passen bij deze filtercombinatie. Pas status of zoekterm
              aan, of maak een nieuwe student aan.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
