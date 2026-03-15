"use client";

import { useActionState } from 'react';
import { updateSkillAction } from '@/lib/skill-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function SkillEditForm({
  skillId,
  defaultValues,
}: {
  skillId: string;
  defaultValues: {
    name: string;
    description: string;
    swimLevel: string;
    isActive: boolean;
  };
}) {
  const boundAction = updateSkillAction.bind(null, skillId);
  const [state, formAction, isPending] = useActionState(boundAction, INITIAL_ACTION_STATE);

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Naam</span>
          <input defaultValue={defaultValues.name} maxLength={120} name="name" required type="text" />
        </label>

        <label className="field">
          <span>Niveau</span>
          <input defaultValue={defaultValues.swimLevel} maxLength={120} name="swimLevel" required type="text" />
        </label>

        <label className="field">
          <span>Status</span>
          <select defaultValue={defaultValues.isActive ? 'true' : 'false'} name="isActive">
            <option value="true">Actief</option>
            <option value="false">Inactief</option>
          </select>
        </label>

        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Beschrijving (optioneel)</span>
          <textarea defaultValue={defaultValues.description} maxLength={500} name="description" rows={3} />
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Wijzigingen opslaan...' : 'Wijzigingen opslaan'}
        </button>
      </div>
    </form>
  );
}
