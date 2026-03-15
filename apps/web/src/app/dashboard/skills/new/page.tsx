import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';

import { SkillCreateForm } from './skill-create-form';

export default async function NewSkillPage() {
  await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Vaardigheid aanmaken</p>
            <h2>Nieuwe vaardigheid</h2>
          </div>
          <Link className="button secondary-button" href="/dashboard/skills">
            Terug naar vaardigheden
          </Link>
        </div>

        <p>
          Maak een nieuwe vaardigheid aan voor de huidige organization. Vaardigheden kunnen
          worden gekoppeld aan cursussen en bijgehouden per student.
        </p>

        <SkillCreateForm />
      </section>
    </div>
  );
}
