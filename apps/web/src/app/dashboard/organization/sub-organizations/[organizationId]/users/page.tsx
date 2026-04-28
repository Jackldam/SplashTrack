import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSubOrganizationUsers } from '@/lib/sub-organization-admin';
import { SubOrganizationMemberForm } from '../../sub-organization-forms';

export default async function SubOrganizationUsersPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationSuborgManage });
  const summary = await getSubOrganizationUsers(authContext, organizationId);
  if (!summary) notFound();
  return <div className="dashboard-stack"><section className="dashboard-panel"><div className="section-heading"><div><p className="eyebrow">Delegated access</p><h2>{summary.organization.name} users</h2></div><Link className="button secondary-button" href="/dashboard/organization/sub-organizations">Terug</Link></div><SubOrganizationMemberForm organizationId={summary.organization.id} /></section><section className="dashboard-panel"><h3>Huidige memberships</h3><div className="table-shell"><table className="data-table"><thead><tr><th>Naam</th><th>Email</th><th>Rol</th><th>Status</th><th>Capabilities</th></tr></thead><tbody>{summary.memberships.map((membership) => <tr key={membership.id}><td data-label="Naam">{membership.user.name ?? 'Onbekend'}</td><td data-label="Email">{membership.user.email}</td><td data-label="Rol">{membership.role}</td><td data-label="Status">{membership.isActive && membership.user.isActive ? 'Actief' : 'Inactief'}</td><td data-label="Capabilities">{membership.capabilities.map((item) => item.capability).join(', ') || 'Rol-defaults'}</td></tr>)}</tbody></table></div></section></div>;
}
