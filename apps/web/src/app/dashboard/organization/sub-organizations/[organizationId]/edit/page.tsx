import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getSubOrganizationDetail } from '@/lib/sub-organization-admin';
import { SubOrganizationEditForm } from '../../sub-organization-forms';

export default async function EditSubOrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const authContext = await requireAuthContext({ capability: CAPABILITIES.organizationSuborgManage });
  const organization = await getSubOrganizationDetail(authContext, organizationId);
  if (!organization) notFound();
  return <div className="dashboard-stack"><section className="dashboard-panel"><div className="section-heading"><div><p className="eyebrow">Sub-organization</p><h2>{organization.name}</h2></div><div className="actions-row"><Link className="button secondary-button" href="/dashboard/organization/sub-organizations">Terug</Link><Link className="button" href={`/dashboard/organization/sub-organizations/${organization.id}/users`}>Users beheren</Link></div></div><SubOrganizationEditForm organization={organization} /></section></div>;
}
