import Link from 'next/link';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';

import { UserCreateForm } from './user-create-form';

export default async function NewOrganizationUserPage() {
  await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">User create</p>
            <h2>Nieuwe user</h2>
          </div>
          <Link className="button secondary-button" href="/dashboard/organization/users">
            Terug naar users
          </Link>
        </div>

        <p>
          Maak een nieuwe organization user aan met credential-login, membership en initiële rol in
          één flow.
        </p>
        <p className="section-note">
          Na succesvol aanmaken ga je automatisch terug naar het useroverzicht.
        </p>

        <UserCreateForm />
      </section>
    </div>
  );
}
