import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getStudentDetail } from '@/lib/student-detail';

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
    </div>
  );
}
