import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSkillDetail } from '@/lib/skill-admin';

import { SkillEditForm } from './skill-edit-form';

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const { id } = await params;
  const skill = await getSkillDetail(authContext, id);

  if (!skill) {
    notFound();
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vaardigheid bewerken</p>
            <h2>{skill.name}</h2>
          </div>
          <Link className="button secondary-button" href={`/dashboard/skills/${skill.id}`}>
            Terug naar vaardigheid
          </Link>
        </div>

        <SkillEditForm
          skillId={skill.id}
          defaultValues={{
            name: skill.name,
            description: skill.description ?? '',
            swimLevel: skill.swimLevel,
            isActive: skill.isActive,
          }}
        />
      </section>
    </div>
  );
}
