"use client";

import { useActionState } from 'react';

import {
  createOrganizationUserAction,
  DEFAULT_USER_ADMIN_ACTION_RESULT,
} from '@/lib/user-admin-actions';

export function UserCreateForm() {
  const [state, formAction, isPending] = useActionState(
    createOrganizationUserAction,
    DEFAULT_USER_ADMIN_ACTION_RESULT,
  );

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Naam</span>
          <input maxLength={120} name="name" required type="text" />
        </label>

        <label className="field">
          <span>E-mail</span>
          <input maxLength={320} name="email" required type="email" />
        </label>

        <label className="field">
          <span>Wachtwoord</span>
          <input minLength={8} name="password" required type="password" />
        </label>

        <label className="field">
          <span>Rol</span>
          <select defaultValue="MEMBER" name="role">
            <option value="OWNER">OWNER</option>
            <option value="ADMIN">ADMIN</option>
            <option value="MEMBER">MEMBER</option>
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'User opslaan...' : 'User aanmaken'}
        </button>
      </div>
    </form>
  );
}
