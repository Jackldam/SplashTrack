import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getStudentDetail } from '@/lib/student-detail';

import { StudentEditForm } from './student-edit-form';

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const { id } = await params;
  const student = await getStudentDetail(authContext, id);

  if (!student) {
    notFound();
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Student edit</p>
            <h2>{student.displayName} bijwerken</h2>
          </div>
          <Link className="button secondary-button" href={`/dashboard/students/${student.id}`}>
            Terug naar detail
          </Link>
        </div>

        <p>
          Eerste guarded update-flow voor OWNER/ADMIN. Deze route werkt alleen binnen de huidige
          organization en schrijft een audit-log event voor de wijziging weg.
        </p>

        <StudentEditForm student={student} />
      </section>
    </div>
  );
}
