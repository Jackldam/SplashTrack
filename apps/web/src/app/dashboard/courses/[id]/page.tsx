import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getCourseDetail, getEnrollableStudentsForCourse } from '@/lib/course-admin';
import { getAvailableSkillsForCourse } from '@/lib/skill-admin';

import { AddSkillToCourseForm } from './add-skill-to-course-form';
import { CourseLifecycleForm } from './course-lifecycle-form';
import { EnrollStudentInCourseForm } from './enroll-student-in-course-form';
import { RemoveSkillFromCourseForm } from './remove-skill-from-course-form';
import { RemoveStudentFromCourseForm } from './remove-student-from-course-form';

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const { id } = await params;
  const course = await getCourseDetail(authContext, id);

  if (!course) {
    notFound();
  }

  const canManageCourse =
    authContext.membership?.role === APP_ROLES.OWNER ||
    authContext.membership?.role === APP_ROLES.ADMIN;

  const [availableSkills, enrollableStudents] = canManageCourse
    ? await Promise.all([
        getAvailableSkillsForCourse(authContext, course.id),
        getEnrollableStudentsForCourse(authContext, course.id),
      ])
    : [[], []];

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cursus detail</p>
            <h2>{course.name}</h2>
          </div>
          <div className="actions-row">
            {canManageCourse ? (
              <Link className="button secondary-button" href={`/dashboard/courses/${course.id}/edit`}>
                Cursus bewerken
              </Link>
            ) : null}
            <Link className="button secondary-button" href="/dashboard/courses">
              Terug naar cursussen
            </Link>
          </div>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Naam</dt>
            <dd>{course.name}</dd>
          </div>
          <div>
            <dt>Niveau</dt>
            <dd>{course.swimLevel}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{course.isActive ? 'Actief' : 'Inactief'}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{course.organization.name}</dd>
          </div>
          {course.description ? (
            <div>
              <dt>Beschrijving</dt>
              <dd>{course.description}</dd>
            </div>
          ) : null}
          <div>
            <dt>Aangemaakt</dt>
            <dd>{formatDateTime(course.createdAt)}</dd>
          </div>
          <div>
            <dt>Laatst gewijzigd</dt>
            <dd>{formatDateTime(course.updatedAt)}</dd>
          </div>
        </dl>

        {canManageCourse ? (
          <section className="callout-card subtle-card student-lifecycle-card">
            <div>
              <h3>Lifecycle</h3>
            </div>
            <CourseLifecycleForm courseId={course.id} isActive={course.isActive} />
          </section>
        ) : null}
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vaardigheden</p>
            <h3>Vaardigheden in deze cursus</h3>
          </div>
          <p className="section-note">
            {course.skills.length} {course.skills.length === 1 ? 'vaardigheid' : 'vaardigheden'} gekoppeld
          </p>
        </div>

        {course.skills.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Cursusvaardigheden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Niveau</th>
                  <th>Status</th>
                  {canManageCourse ? <th>Actie</th> : null}
                </tr>
              </thead>
              <tbody>
                {course.skills.map((cs) => (
                  <tr key={cs.courseSkillId}>
                    <td>
                      <Link className="text-link" href={`/dashboard/skills/${cs.skillId}`}>
                        {cs.skillName}
                      </Link>
                    </td>
                    <td>{cs.skillSwimLevel}</td>
                    <td>{cs.skillIsActive ? 'Actief' : 'Inactief'}</td>
                    {canManageCourse ? (
                      <td>
                        <RemoveSkillFromCourseForm
                          courseId={course.id}
                          skillId={cs.skillId}
                          skillName={cs.skillName}
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
            <h4>Geen vaardigheden</h4>
            <p>Koppel vaardigheden via het formulier hieronder.</p>
          </div>
        )}
      </section>

      {canManageCourse ? (
        <section className="dashboard-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Vaardigheid koppelen</p>
              <h3>Vaardigheid toevoegen aan cursus</h3>
            </div>
            <p className="section-note">
              Alleen actieve vaardigheden die nog niet zijn gekoppeld worden getoond.
            </p>
          </div>

          <AddSkillToCourseForm courseId={course.id} availableSkills={availableSkills} />
        </section>
      ) : null}

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Deelnemers</p>
            <h3>Studenten in deze cursus</h3>
          </div>
          <p className="section-note">
            {course.enrollments.length} {course.enrollments.length === 1 ? 'student' : 'studenten'} ingeschreven
          </p>
        </div>

        {course.enrollments.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Cursusdeelnemers">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Niveau</th>
                  <th>Student status</th>
                  <th>Ingeschreven</th>
                  {canManageCourse ? <th>Actie</th> : null}
                </tr>
              </thead>
              <tbody>
                {course.enrollments.map((enrollment) => (
                  <tr key={enrollment.enrollmentId}>
                    <td>
                      <Link className="text-link" href={`/dashboard/students/${enrollment.studentId}`}>
                        {enrollment.displayName}
                      </Link>
                    </td>
                    <td>{enrollment.swimLevel}</td>
                    <td>{enrollment.studentIsActive ? 'Actief' : 'Inactief'}</td>
                    <td>{formatDateTime(enrollment.enrolledAt)}</td>
                    {canManageCourse ? (
                      <td>
                        <RemoveStudentFromCourseForm
                          courseId={course.id}
                          studentId={enrollment.studentId}
                          displayName={enrollment.displayName}
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

      {canManageCourse ? (
        <section className="dashboard-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Inschrijving</p>
              <h3>Student toevoegen aan cursus</h3>
            </div>
            <p className="section-note">
              Alleen actieve studenten die nog niet in deze cursus zitten worden getoond.
            </p>
          </div>

          <EnrollStudentInCourseForm courseId={course.id} enrollableStudents={enrollableStudents} />
        </section>
      ) : null}
    </div>
  );
}
