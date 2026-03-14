import Link from 'next/link';

import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { canAccessOrganizationAdmin } from '@/lib/organization-admin';

export default async function DashboardPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.dashboardAccess,
  });

  const showOrganizationAdmin = canAccessOrganizationAdmin(authContext);

  return (
    <section className="dashboard-panel">
      <p className="eyebrow">Protected route</p>
      <h2>Welkom in de dashboard shell</h2>
      <p>
        Dit blijft bewust een technische basisroute. Batch 6 voegt daar een kleine
        organization/admin foundation bovenop toe, zonder businessflows of legacy-aanpassingen.
      </p>

      <div className="status-grid">
        <article>
          <h3>Auth guard</h3>
          <p>Server-side redirect naar login voor unauthenticated verkeer.</p>
        </article>
        <article>
          <h3>RBAC guard</h3>
          <p>Minimale rol/capability-checks via auth-context helper.</p>
        </article>
        <article>
          <h3>Organization shell</h3>
          <p>
            OWNER/ADMIN krijgen een read-only beheerbasis voor memberships en audit-log context.
          </p>
        </article>
      </div>

      {showOrganizationAdmin ? (
        <div className="callout-card">
          <h3>Organization admin</h3>
          <p>
            Je huidige rol heeft toegang tot de minimale organization beheerweergave voor deze
            single-org foundation.
          </p>
          <Link className="button" href="/dashboard/organization">
            Open organization shell
          </Link>
        </div>
      ) : (
        <div className="callout-card subtle-card">
          <h3>Beperkte dashboardtoegang</h3>
          <p>
            Je membership geeft wel dashboardtoegang, maar geen organization admin rechten. Dat is
            bewust server-side afgedwongen.
          </p>
        </div>
      )}
    </section>
  );
}
