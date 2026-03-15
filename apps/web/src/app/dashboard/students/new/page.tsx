import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getStudentDeletePolicySummary } from '@/lib/student-policy';

import { StudentCreateForm } from './student-create-form';

export default async function NewStudentPage() {
  const deletePolicySummary = getStudentDeletePolicySummary();

  await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Student create</p>
            <h2>Nieuwe student</h2>
          </div>
          <Link className="button secondary-button" href="/dashboard/students">
            Terug naar directory
          </Link>
        </div>

        <p>
          Eerste guarded create-flow voor OWNER/ADMIN. Deze route maakt alleen een studentrecord aan
          binnen de huidige organization en schrijft een audit-log event weg.
        </p>
        <p className="section-note">Delete-policy: {deletePolicySummary}</p>

        <StudentCreateForm />
      </section>
    </div>
  );
}
