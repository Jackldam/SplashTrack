"use client";

import { useActionState } from 'react';

import type { OrganizationUserDetail } from '@/lib/user-admin';
import { updateOrganizationUserAction } from '@/lib/user-admin-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function UserEditForm({ user }: { user: OrganizationUserDetail }) {
  const action = updateOrganizationUserAction.bind(null, user.membershipId);
  const [state, formAction, isPending] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form className="user-form" action={formAction}>
      <div className="user-form-grid">
        <label className="field">
          <span>Naam</span>
          <input defaultValue={user.name ?? ''} maxLength={120} name="name" required type="text" />
        </label>

        <label className="field">
          <span>E-mail</span>
          <input defaultValue={user.email} maxLength={320} name="email" required type="email" />
        </label>

        <label className="field">
          <span>Nieuw wachtwoord</span>
          <input minLength={8} name="password" placeholder="Leeg laten om niet te wijzigen" type="password" />
        </label>

        <label className="field">
          <span>Rol</span>
          <select defaultValue={user.role} name="role">
            <option value="OWNER">OWNER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="MEMBER">MEMBER</option>
          </select>
        </label>

        <label className="field">
          <span>Status</span>
          <select defaultValue={user.userIsActive ? 'true' : 'false'} name="isActive">
            <option value="true">Actief</option>
            <option value="false">Inactief</option>
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'User opslaan...' : 'Wijzigingen opslaan'}
        </button>
      </div>
    </form>
  );
}
