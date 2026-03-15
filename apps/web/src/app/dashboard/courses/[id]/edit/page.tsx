import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getCourseDetail } from '@/lib/course-admin';

import { CourseEditForm } from './course-edit-form';

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const { id } = await params;
  const course = await getCourseDetail(authContext, id);

  if (!course) {
    notFound();
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cursus bewerken</p>
            <h2>{course.name}</h2>
          </div>
          <Link className="button secondary-button" href={`/dashboard/courses/${course.id}`}>
            Terug naar cursus
          </Link>
        </div>

        <CourseEditForm
          courseId={course.id}
          defaultValues={{
            name: course.name,
            description: course.description ?? '',
            swimLevel: course.swimLevel,
            isActive: course.isActive,
          }}
        />
      </section>
    </div>
  );
}
