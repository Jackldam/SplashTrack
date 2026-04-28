import Link from 'next/link';

import { CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { SubOrganizationCreateForm } from '../sub-organization-forms';

export default async function NewSubOrganizationPage() {
  await requireAuthContext({ capability: CAPABILITIES.organizationSuborgManage });
  return <div className="dashboard-stack"><section className="dashboard-panel"><div className="section-heading"><div><p className="eyebrow">Sub-organization</p><h2>Nieuwe sub-organization</h2></div><Link className="button secondary-button" href="/dashboard/organization/sub-organizations">Terug</Link></div><SubOrganizationCreateForm /></section></div>;
}
