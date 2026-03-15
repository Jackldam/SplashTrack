import Link from 'next/link';
import { notFound } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getOrganizationUserDetail } from '@/lib/user-admin';

import { UserEditForm } from './user-edit-form';

export default async function EditOrganizationUserPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const { membershipId } = await params;
  const user = await getOrganizationUserDetail(authContext, membershipId);

  if (!user) {
    notFound();
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">User edit</p>
            <h2>{user.name ?? user.email} bijwerken</h2>
          </div>
          <Link className="button secondary-button" href="/dashboard/organization/users">
            Terug naar users
          </Link>
        </div>

        <p>
          Werk gebruikersgegevens, rol, status en optioneel credential-wachtwoord bij binnen de
          huidige organization.
        </p>
        <p className="section-note">
          Na succesvol opslaan ga je automatisch terug naar het useroverzicht.
        </p>

        <UserEditForm user={user} />
      </section>
    </div>
  );
}
