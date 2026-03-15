import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getEnrollableStudents, getSwimGroupDetail } from '@/lib/swim-group-admin';

import { EnrollStudentForm } from './enroll-student-form';
import { GroupLifecycleForm } from './group-lifecycle-form';
import { RemoveStudentForm } from './remove-student-form';

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const { id } = await params;
  const group = await getSwimGroupDetail(authContext, id);

  if (!group) {
    notFound();
  }

  const canManageGroup =
    authContext.membership?.role === APP_ROLES.OWNER ||
    authContext.membership?.role === APP_ROLES.ADMIN;

  const enrollableStudents = canManageGroup
    ? await getEnrollableStudents(authContext, group.id)
    : [];

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Groepdetail</p>
            <h2>{group.name}</h2>
          </div>
          <div className="actions-row">
            {canManageGroup ? (
              <Link className="button secondary-button" href={`/dashboard/groups/${group.id}/edit`}>
                Groep bewerken
              </Link>
            ) : null}
            <Link className="button secondary-button" href="/dashboard/groups">
              Terug naar groepen
            </Link>
          </div>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Naam</dt>
            <dd>{group.name}</dd>
          </div>
          <div>
            <dt>Niveau</dt>
            <dd>{group.swimLevel}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{group.isActive ? 'Actief' : 'Inactief'}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{group.organization.name}</dd>
          </div>
          <div>
            <dt>Aangemaakt</dt>
            <dd>{formatDateTime(group.createdAt)}</dd>
          </div>
          <div>
            <dt>Laatst gewijzigd</dt>
            <dd>{formatDateTime(group.updatedAt)}</dd>
          </div>
        </dl>

        {canManageGroup ? (
          <section className="callout-card subtle-card student-lifecycle-card">
            <div>
              <h3>Lifecycle</h3>
            </div>
            <GroupLifecycleForm groupId={group.id} isActive={group.isActive} />
          </section>
        ) : null}
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Deelnemers</p>
            <h3>Studenten in deze groep</h3>
          </div>
          <p className="section-note">
            {group.members.length} {group.members.length === 1 ? 'student' : 'studenten'} ingeschreven
          </p>
        </div>

        {group.members.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Groepsdeelnemers">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Niveau</th>
                  <th>Student status</th>
                  <th>Ingeschreven</th>
                  {canManageGroup ? <th>Actie</th> : null}
                </tr>
              </thead>
              <tbody>
                {group.members.map((member) => (
                  <tr key={member.membershipId}>
                    <td>
                      <Link className="text-link" href={`/dashboard/students/${member.studentId}`}>
                        {member.displayName}
                      </Link>
                    </td>
                    <td>{member.swimLevel}</td>
                    <td>{member.isActive ? 'Actief' : 'Inactief'}</td>
                    <td>{formatDateTime(member.enrolledAt)}</td>
                    {canManageGroup ? (
                      <td>
                        <RemoveStudentForm
                          groupId={group.id}
                          studentId={member.studentId}
                          displayName={member.displayName}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h4>Geen deelnemers</h4>
            <p>Schrijf studenten in via het formulier hieronder.</p>
          </div>
        )}
      </section>

      {canManageGroup ? (
        <section className="dashboard-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Inschrijving</p>
              <h3>Student toevoegen aan groep</h3>
            </div>
            <p className="section-note">
              Alleen actieve studenten die nog niet in deze groep zitten worden getoond.
            </p>
          </div>

          <EnrollStudentForm groupId={group.id} enrollableStudents={enrollableStudents} />
        </section>
      ) : null}
    </div>
  );
}
