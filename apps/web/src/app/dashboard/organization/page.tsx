import Link from 'next/link';

import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { ORGANIZATION_ADMIN_ACTIONS } from '@/lib/organization-admin-action-core';
import { getOrganizationAdminSummary } from '@/lib/organization-admin';

import { MembershipActionForm, MembershipRoleForm } from './membership-action-form';

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

function getAuditMetadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const value = metadata[key as keyof typeof metadata];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null;
}

function renderMetadata(metadata: unknown) {
  if (!metadata) {
    return 'Geen metadata';
  }

  return JSON.stringify(metadata, null, 2);
}

function renderAuditSummary(metadata: unknown) {
  const targetEmail = getAuditMetadataValue(metadata, 'targetUserEmail');
  const previousRole = getAuditMetadataValue(metadata, 'previousRole');
  const nextRole = getAuditMetadataValue(metadata, 'nextRole');
  const previousIsActive = getAuditMetadataValue(metadata, 'previousIsActive');
  const nextIsActive = getAuditMetadataValue(metadata, 'nextIsActive');
  const performedByRole = getAuditMetadataValue(metadata, 'performedByRole');

  return (
    <dl className="audit-log-meta-grid">
      {targetEmail ? (
        <div>
          <dt>Target</dt>
          <dd>{targetEmail}</dd>
        </div>
      ) : null}
      {previousRole || nextRole ? (
        <div>
          <dt>Rolwijziging</dt>
          <dd>
            {previousRole ?? 'onbekend'} → {nextRole ?? 'onbekend'}
          </dd>
        </div>
      ) : null}
      {previousIsActive || nextIsActive ? (
        <div>
          <dt>Statuswijziging</dt>
          <dd>
            {previousIsActive ?? 'onbekend'} → {nextIsActive ?? 'onbekend'}
          </dd>
        </div>
      ) : null}
      {performedByRole ? (
        <div>
          <dt>Uitgevoerd als</dt>
          <dd>{performedByRole}</dd>
        </div>
      ) : null}
    </dl>
  );
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
          Kleine server-side beheerbasis voor de huidige single-organization setup. Batch 8 voegt
          technische role-management en admin-UX polish toe, zonder businessfeatures.
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
          <div className="section-actions">
            <p className="section-note">
              OWNER/ADMIN houdt route-toegang. Role-management blijft expres server-side begrensd:
              alleen owners mogen rollen wijzigen, admins blijven beperkt tot veilige membership-statusacties.
            </p>
            <Link className="button secondary-button" href="/dashboard/organization/users">
              Open user admin
            </Link>
          </div>
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
                <th>Role management</th>
                <th>Membership actie</th>
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
                    <td>
                      {member.availableActions.canManageRoles ? (
                        <MembershipRoleForm
                          membershipId={member.id}
                          currentRole={member.role}
                          helperText="Owner-only. Self-role change en laatste-owner downgrade zijn geblokkeerd."
                        />
                      ) : (
                        <span className="section-note">
                          {member.id === summary.currentMembership.id
                            ? 'Eigen membership-rol blijft vergrendeld'
                            : 'Geen role-management toegestaan'}
                        </span>
                      )}
                    </td>
                    <td>
                      {actionLabel && actionId ? (
                        <MembershipActionForm
                          membershipId={member.id}
                          action={actionId}
                          label={actionLabel}
                          helperText={
                            member.id === summary.currentMembership.id
                              ? 'Eigen membership blijft beschermd.'
                              : undefined
                          }
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
            Membership-activaties en rolwijzigingen tonen nu direct target, status/rol-mutatie en
            uitvoerende admin-context. Ruwe metadata blijft beschikbaar voor debugging.
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
                {renderAuditSummary(auditLog.metadata)}
                <details className="audit-log-details">
                  <summary>Ruwe metadata</summary>
                  <pre>{renderMetadata(auditLog.metadata)}</pre>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h4>Nog geen audit events</h4>
            <p>
              De foundation ondersteunt nu ook technische membership-admin-acties en rolwijzigingen.
              Verdere workflows, filters of exports horen in latere batches.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
