import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';

import { GroupCreateForm } from './group-create-form';

export default async function NewGroupPage() {
  await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Groep aanmaken</p>
            <h2>Nieuwe zwemgroep</h2>
          </div>
          <Link className="button secondary-button" href="/dashboard/groups">
            Terug naar groepen
          </Link>
        </div>

        <p>
          Maak een nieuwe zwemgroep aan voor de huidige organization. Na aanmaken kun je studenten
          toevoegen via de groepdetailpagina.
        </p>

        <GroupCreateForm />
      </section>
    </div>
  );
}
