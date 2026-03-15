"use client";

import { useActionState } from 'react';

import { removeStudentFromGroupAction } from '@/lib/swim-group-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

type RemoveStudentFormProps = {
  groupId: string;
  studentId: string;
  displayName: string;
};

export function RemoveStudentForm({ groupId, studentId, displayName }: RemoveStudentFormProps) {
  const removeForGroup = removeStudentFromGroupAction.bind(null, groupId);
  const [state, formAction, isPending] = useActionState(
    removeForGroup,
    INITIAL_ACTION_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="studentId" value={studentId} />
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      <button
        className="button secondary-button"
        disabled={isPending}
        type="submit"
        aria-label={`${displayName} uitschrijven`}
      >
        {isPending ? 'Uitschrijven...' : 'Uitschrijven'}
      </button>
    </form>
  );
}
