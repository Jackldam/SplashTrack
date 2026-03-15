"use client";

import { useActionState } from 'react';

import { toggleSwimGroupLifecycleAction } from '@/lib/swim-group-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

type GroupLifecycleFormProps = {
  groupId: string;
  isActive: boolean;
};

export function GroupLifecycleForm({ groupId, isActive }: GroupLifecycleFormProps) {
  const toggleForGroup = toggleSwimGroupLifecycleAction.bind(null, groupId);
  const [state, formAction, isPending] = useActionState(
    toggleForGroup,
    INITIAL_ACTION_STATE,
  );

  const buttonLabel = isActive ? 'Groep deactiveren' : 'Groep heractiveren';
  const pendingLabel = isActive ? 'Groep deactiveren...' : 'Groep heractiveren...';
  const helperText = isActive
    ? 'De groep blijft bewaard maar telt niet meer mee als actief. Bestaande inschrijvingen blijven intact.'
    : 'De groep wordt opnieuw actief en zichtbaar in overzichten.';

  return (
    <form action={formAction}>
      <p className="section-note">{helperText}</p>
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}
      <div className="actions-row">
        <button className="button secondary-button" disabled={isPending} type="submit">
          {isPending ? pendingLabel : buttonLabel}
        </button>
      </div>
    </form>
  );
}
