"use client";

import { useActionState } from 'react';

import {
  createSubOrganizationAction,
  updateSubOrganizationAction,
  upsertSubOrganizationMemberAction,
} from '@/lib/sub-organization-admin-actions';
const DELEGABLE_CAPABILITIES = [
  'dashboard:access',
  'organization:admin',
  'organization:suborg:create',
  'organization:suborg:manage',
  'organization:members:manage',
  'organization:members:role',
  'students:read',
  'students:write',
  'groups:read',
  'groups:write',
  'welcome:manage',
  'translations:manage',
];

const INITIAL_STATE = { status: 'idle' as const, message: '' };

export function SubOrganizationCreateForm() {
  const [state, formAction, isPending] = useActionState(createSubOrganizationAction, INITIAL_STATE);

  return (
    <form className="user-form" action={formAction}>
      <div className="user-form-grid">
        <label className="field"><span>Naam</span><input maxLength={120} name="name" required /></label>
        <label className="field"><span>Slug</span><input maxLength={80} name="slug" pattern="[a-zA-Z0-9-]+" required /></label>
      </div>
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      <button className="button" disabled={isPending} type="submit">{isPending ? 'Opslaan...' : 'Sub-organization aanmaken'}</button>
    </form>
  );
}

export function SubOrganizationEditForm({ organization }: { organization: { id: string; name: string; slug: string; isActive: boolean } }) {
  const [state, formAction, isPending] = useActionState(updateSubOrganizationAction.bind(null, organization.id), INITIAL_STATE);

  return (
    <form className="user-form" action={formAction}>
      <div className="user-form-grid">
        <label className="field"><span>Naam</span><input defaultValue={organization.name} maxLength={120} name="name" required /></label>
        <label className="field"><span>Slug</span><input defaultValue={organization.slug} maxLength={80} name="slug" pattern="[a-zA-Z0-9-]+" required /></label>
        <label className="field"><span>Status</span><select defaultValue={String(organization.isActive)} name="isActive"><option value="true">Actief</option><option value="false">Inactief</option></select></label>
      </div>
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}
      <button className="button" disabled={isPending} type="submit">{isPending ? 'Opslaan...' : 'Wijzigingen opslaan'}</button>
    </form>
  );
}

export function SubOrganizationMemberForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, isPending] = useActionState(upsertSubOrganizationMemberAction.bind(null, organizationId), INITIAL_STATE);

  return (
    <form className="user-form" action={formAction}>
      <div className="user-form-grid">
        <label className="field"><span>Naam</span><input maxLength={120} name="name" required /></label>
        <label className="field"><span>E-mail</span><input maxLength={320} name="email" required type="email" /></label>
        <label className="field"><span>Nieuw wachtwoord (alleen nodig voor nieuw account)</span><input minLength={8} name="password" type="password" /></label>
        <label className="field"><span>Rol</span><select defaultValue="MEMBER" name="role"><option value="OWNER">OWNER</option><option value="ADMIN">ADMIN</option><option value="MEMBER">MEMBER</option></select></label>
        <label className="field"><span>Status</span><select defaultValue="true" name="isActive"><option value="true">Actief</option><option value="false">Inactief</option></select></label>
      </div>
      <fieldset className="checkbox-grid">
        <legend>Extra capabilities</legend>
        {DELEGABLE_CAPABILITIES.map((capability) => (
          <label key={capability}>
            <input name="capabilities" type="checkbox" value={capability} /> {capability}
          </label>
        ))}
      </fieldset>
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}
      <button className="button" disabled={isPending} type="submit">{isPending ? 'Opslaan...' : 'User/delegatie opslaan'}</button>
    </form>
  );
}
