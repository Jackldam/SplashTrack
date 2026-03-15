import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getRecentStudentAuditActivity } from '@/lib/student-audit';
import { getStudentDetail } from '@/lib/student-detail';
import { getStudentDeletePolicySummary } from '@/lib/student-policy';

import { StudentLifecycleForm } from './student-lifecycle-form';

function formatDate(value: Date | null) {
  if (!value) {
    return 'Onbekend';
  }

  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const { id } = await params;
  const student = await getStudentDetail(authContext, id);

  if (!student) {
    notFound();
  }

  const recentActivity = await getRecentStudentAuditActivity(authContext, student.id);
  const deletePolicySummary = getStudentDeletePolicySummary();

  const canEditStudent =
    authContext.membership?.role === APP_ROLES.OWNER || authContext.membership?.role === APP_ROLES.ADMIN;

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Student detail</p>
            <h2>{student.displayName}</h2>
          </div>
          <div className="actions-row">
            {canEditStudent ? (
              <Link className="button secondary-button" href={`/dashboard/students/${student.id}/edit`}>
                Student bewerken
              </Link>
            ) : null}
            <Link className="button secondary-button" href="/dashboard/students">
              Terug naar directory
            </Link>
          </div>
        </div>

        <p>
          Studentdetail binnen de huidige organization, inclusief guarded lifecycle-actie voor
          OWNER/ADMIN om een student te deactiveren of later weer te heractiveren.
        </p>
        <p className="section-note">Delete-policy: {deletePolicySummary}</p>

        <dl className="meta-grid">
          <div>
            <dt>Voornaam</dt>
            <dd>{student.firstName}</dd>
          </div>
          <div>
            <dt>Achternaam</dt>
            <dd>{student.lastName}</dd>
          </div>
          <div>
            <dt>Geboortedatum</dt>
            <dd>{formatDate(student.dateOfBirth)}</dd>
          </div>
          <div>
            <dt>Niveau</dt>
            <dd>{student.swimLevel}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{student.isActive ? 'Actief' : 'Inactief'}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{student.organization.name}</dd>
          </div>
          <div>
            <dt>Aangemaakt</dt>
            <dd>{formatDateTime(student.createdAt)}</dd>
          </div>
          <div>
            <dt>Laatst gewijzigd</dt>
            <dd>{formatDateTime(student.updatedAt)}</dd>
          </div>
        </dl>

        {canEditStudent ? (
          <section className="callout-card subtle-card student-lifecycle-card">
            <div>
              <h3>Lifecycle</h3>
              <p>
                Gebruik deactiveren voor archivering zonder dat studentdata of auditspoor verloren
                gaat.
              </p>
            </div>
            <StudentLifecycleForm student={student} />
          </section>
        ) : null}
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Zwemgroepen</p>
            <h3>Groepslidmaatschappen</h3>
          </div>
          <p className="section-note">
            Groepen waaraan deze student is toegewezen binnen de huidige organization.
          </p>
        </div>

        {student.groupMemberships.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Groepslidmaatschappen">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Groep</th>
                  <th>Niveau</th>
                  <th>Groep status</th>
                  <th>Ingeschreven</th>
                </tr>
              </thead>
              <tbody>
                {student.groupMemberships.map((membership) => (
                  <tr key={membership.membershipId}>
                    <td>
                      <Link className="text-link" href={`/dashboard/groups/${membership.groupId}`}>
                        {membership.groupName}
                      </Link>
                    </td>
                    <td>{membership.swimLevel}</td>
                    <td>{membership.groupIsActive ? 'Actief' : 'Inactief'}</td>
                    <td>{formatDateTime(membership.enrolledAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h4>Geen groepslidmaatschappen</h4>
            <p>
              Deze student is nog niet aan een zwemgroep toegewezen. Wijs een groep toe via de
              groepdetailpagina.
            </p>
          </div>
        )}
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Student activity</p>
            <h3>Recente wijzigingen</h3>
          </div>
          <p className="section-note">
            Gebaseerd op bestaande audit-log events voor create, update en lifecycle-mutaties van
            deze student.
          </p>
        </div>

        {recentActivity.length > 0 ? (
          <div className="audit-log-list">
            {recentActivity.map((activityItem) => (
              <article className="audit-log-card" key={activityItem.id}>
                <div className="audit-log-header">
                  <div>
                    <h4>{activityItem.actionLabel}</h4>
                    <p>{activityItem.summary}</p>
                  </div>
                  <p>{formatDateTime(activityItem.createdAt)}</p>
                </div>
                <p>
                  Actor: {activityItem.actorLabel} · type: {activityItem.actorType}
                </p>
                {activityItem.changes.length > 0 ? (
                  <dl className="audit-log-meta-grid">
                    {activityItem.changes.map((change) => (
                      <div key={`${activityItem.id}-${change.label}`}>
                        <dt>{change.label}</dt>
                        <dd>{change.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <details className="audit-log-details">
                  <summary>Ruwe metadata</summary>
                  <pre>{JSON.stringify(activityItem.rawMetadata, null, 2)}</pre>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h4>Nog geen studentactiviteit</h4>
            <p>
              Zodra create, update of lifecycle-acties plaatsvinden, verschijnt hier een compact
              auditspoor voor deze student.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
