"use client";

import { useActionState } from 'react';

import {
  updateSwimGroupAction,
  DEFAULT_SWIM_GROUP_ACTION_RESULT,
} from '@/lib/swim-group-actions';
import type { SwimGroupDetail } from '@/lib/swim-group-admin';

export function GroupEditForm({ group }: { group: SwimGroupDetail }) {
  const updateForGroup = updateSwimGroupAction.bind(null, group.id);
  const [state, formAction, isPending] = useActionState(
    updateForGroup,
    DEFAULT_SWIM_GROUP_ACTION_RESULT,
  );

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Groepsnaam</span>
          <input defaultValue={group.name} maxLength={120} name="name" required type="text" />
        </label>

        <label className="field">
          <span>Niveau</span>
          <input defaultValue={group.swimLevel} maxLength={120} name="swimLevel" required type="text" />
        </label>

        <label className="field">
          <span>Status</span>
          <select defaultValue={group.isActive ? 'true' : 'false'} name="isActive">
            <option value="true">Actief</option>
            <option value="false">Inactief</option>
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Groep opslaan...' : 'Wijzigingen opslaan'}
        </button>
      </div>
    </form>
  );
}
