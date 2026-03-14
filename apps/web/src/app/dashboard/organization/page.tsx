import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { ORGANIZATION_ADMIN_ACTIONS } from '@/lib/organization-admin-action-core';
import { getOrganizationAdminSummary } from '@/lib/organization-admin';

import { MembershipActionForm } from './membership-action-form';

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

function renderMetadata(metadata: unknown) {
  if (!metadata) {
    return 'Geen metadata';
  }

  return JSON.stringify(metadata, null, 2);
}

export default async function OrganizationAdminPage() {
  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
  });

  const summary = await getOrganizationAdminSummary(authContext);

  if (!summary) {
    return null;
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <p className="eyebrow">Organization admin foundation</p>
        <h2>{summary.organization.name}</h2>
        <p>
          Kleine server-side beheerbasis voor de huidige single-organization setup. Batch 7 voegt
          alleen technische membership-acties toe, zonder businessfeatures.
        </p>

        <dl className="meta-grid">
          <div>
            <dt>Slug</dt>
            <dd>{summary.organization.slug}</dd>
          </div>
          <div>
            <dt>Jouw rol</dt>
            <dd>{summary.currentMembership.role}</dd>
          </div>
          <div>
            <dt>Actieve memberships</dt>
            <dd>{summary.organization.memberCount}</dd>
          </div>
          <div>
            <dt>Owners / Admins</dt>
            <dd>
              {summary.organization.ownerCount} / {summary.organization.adminCount}
            </dd>
          </div>
          <div>
            <dt>Audit log items</dt>
            <dd>{summary.organization.activeAuditLogCount}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Membership overview</p>
            <h3>Huidige organization members</h3>
          </div>
          <p className="section-note">
            Alleen OWNER/ADMIN mag deze route en acties gebruiken. Mutaties blijven beperkt tot
            activate/deactivate membership.
          </p>
        </div>

        <div className="table-shell" role="region" aria-label="Organization members overzicht">
          <table className="data-table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Email</th>
                <th>Rol</th>
                <th>User status</th>
                <th>Membership</th>
                <th>Voorbereide hooks</th>
                <th>Actie</th>
                <th>Sinds</th>
              </tr>
            </thead>
            <tbody>
              {summary.members.map((member) => {
                const actionLabel = member.availableActions.canActivate
                  ? 'Activeer membership'
                  : member.availableActions.canDeactivate
                    ? 'Deactiveer membership'
                    : null;

                const actionId = member.availableActions.canActivate
                  ? ORGANIZATION_ADMIN_ACTIONS.activateMembership
                  : member.availableActions.canDeactivate
                    ? ORGANIZATION_ADMIN_ACTIONS.deactivateMembership
                    : null;

                return (
                  <tr key={member.id}>
                    <td>{member.user.name ?? 'Onbekend'}</td>
                    <td>{member.user.email}</td>
                    <td>{member.role}</td>
                    <td>{member.user.isActive ? 'Actief' : 'Inactief'}</td>
                    <td>
                      {member.isActive ? 'Actief' : 'Inactief'}
                      {member.user.emailVerified ? ' · verified' : ' · unverified'}
                    </td>
                    <td>{member.availableActions.preparedHooks.join(', ')}</td>
                    <td>
                      {actionLabel && actionId ? (
                        <MembershipActionForm
                          membershipId={member.id}
                          action={actionId}
                          label={actionLabel}
                        />
                      ) : (
                        <span className="section-note">Geen veilige actie beschikbaar</span>
                      )}
                    </td>
                    <td>{formatDateTime(member.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit log basis</p>
            <h3>Recente organization events</h3>
          </div>
          <p className="section-note">
            Nieuwe technische admin-acties loggen minimaal wie de actie uitvoerde, op welke
            membership en met welke actieve statuswisseling.
          </p>
        </div>

        {summary.auditLogs.length > 0 ? (
          <div className="audit-log-list">
            {summary.auditLogs.map((auditLog) => (
              <article className="audit-log-card" key={auditLog.id}>
                <div className="audit-log-header">
                  <div>
                    <h4>{auditLog.action}</h4>
                    <p>
                      {auditLog.entityType}
                      {auditLog.entityId ? ` · ${auditLog.entityId}` : ''}
                    </p>
                  </div>
                  <p>{formatDateTime(auditLog.createdAt)}</p>
                </div>
                <p>
                  Actor: {auditLog.actorUser?.email ?? auditLog.actorType} · type: {auditLog.actorType}
                </p>
                <pre>{renderMetadata(auditLog.metadata)}</pre>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h4>Nog geen audit events</h4>
            <p>
              De foundation ondersteunt nu ook technische membership-admin-acties. Verdere
              workflows, filters of exports horen in latere batches.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
