import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSwimGroupDetail } from '@/lib/swim-group-admin';

import { GroupEditForm } from './group-edit-form';

export default async function EditGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const { id } = await params;
  const group = await getSwimGroupDetail(authContext, id);

  if (!group) {
    notFound();
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Groep bewerken</p>
            <h2>{group.name} bijwerken</h2>
          </div>
          <Link className="button secondary-button" href={`/dashboard/groups/${group.id}`}>
            Terug naar groep
          </Link>
        </div>

        <p>
          Pas de naam, het niveau of de status van de groep aan. Bestaande inschrijvingen blijven
          intact bij statuswijziging.
        </p>

        <GroupEditForm group={group} />
      </section>
    </div>
  );
}
