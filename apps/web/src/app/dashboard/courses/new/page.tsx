import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';

import { CourseCreateForm } from './course-create-form';

export default async function NewCoursePage() {
  await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cursus aanmaken</p>
            <h2>Nieuwe cursus</h2>
          </div>
          <Link className="button secondary-button" href="/dashboard/courses">
            Terug naar cursussen
          </Link>
        </div>

        <p>
          Maak een nieuwe cursus aan voor de huidige organization. Na aanmaken kun je vaardigheden
          koppelen en studenten inschrijven via de cursusdetailpagina.
        </p>

        <CourseCreateForm />
      </section>
    </div>
  );
}
