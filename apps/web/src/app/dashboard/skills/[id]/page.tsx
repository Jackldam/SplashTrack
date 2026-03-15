import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSkillDetail } from '@/lib/skill-admin';

import { SkillLifecycleForm } from './skill-lifecycle-form';

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const { id } = await params;
  const skill = await getSkillDetail(authContext, id);

  if (!skill) {
    notFound();
  }

  const canManageSkill =
    authContext.membership?.role === APP_ROLES.OWNER ||
    authContext.membership?.role === APP_ROLES.ADMIN;

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vaardigheid detail</p>
            <h2>{skill.name}</h2>
          </div>
          <div className="actions-row">
            {canManageSkill ? (
              <Link className="button secondary-button" href={`/dashboard/skills/${skill.id}/edit`}>
                Vaardigheid bewerken
              </Link>
            ) : null}
            <Link className="button secondary-button" href="/dashboard/skills">
              Terug naar vaardigheden
            </Link>
          </div>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Naam</dt>
            <dd>{skill.name}</dd>
          </div>
          <div>
            <dt>Niveau</dt>
            <dd>{skill.swimLevel}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{skill.isActive ? 'Actief' : 'Inactief'}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{skill.organization.name}</dd>
          </div>
          {skill.description ? (
            <div>
              <dt>Beschrijving</dt>
              <dd>{skill.description}</dd>
            </div>
          ) : null}
          <div>
            <dt>Aangemaakt</dt>
            <dd>{formatDateTime(skill.createdAt)}</dd>
          </div>
          <div>
            <dt>Laatst gewijzigd</dt>
            <dd>{formatDateTime(skill.updatedAt)}</dd>
          </div>
        </dl>

        {canManageSkill ? (
          <section className="callout-card subtle-card student-lifecycle-card">
            <div>
              <h3>Lifecycle</h3>
            </div>
            <SkillLifecycleForm skillId={skill.id} isActive={skill.isActive} />
          </section>
        ) : null}
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cursussen</p>
            <h3>Gekoppelde cursussen</h3>
          </div>
          <p className="section-note">
            {skill.courses.length} {skill.courses.length === 1 ? 'cursus' : 'cursussen'} gekoppeld
          </p>
        </div>

        {skill.courses.length > 0 ? (
          <div className="table-shell" role="region" aria-label="Gekoppelde cursussen">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {skill.courses.map((cs) => (
                  <tr key={cs.courseSkillId}>
                    <td>
                      <Link className="text-link" href={`/dashboard/courses/${cs.courseId}`}>
                        {cs.courseName}
                      </Link>
                    </td>
                    <td>{cs.courseIsActive ? 'Actief' : 'Inactief'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h4>Niet gekoppeld aan cursussen</h4>
            <p>Koppel deze vaardigheid aan cursussen via de cursuspagina.</p>
          </div>
        )}
      </section>
    </div>
  );
}
