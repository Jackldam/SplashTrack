"use client";

import { useActionState } from 'react';

import {
  removeStudentFromGroupAction,
  DEFAULT_SWIM_GROUP_ACTION_RESULT,
} from '@/lib/swim-group-actions';

type RemoveStudentFormProps = {
  groupId: string;
  studentId: string;
  displayName: string;
};

export function RemoveStudentForm({ groupId, studentId, displayName }: RemoveStudentFormProps) {
  const removeForGroup = removeStudentFromGroupAction.bind(null, groupId);
  const [state, formAction, isPending] = useActionState(
    removeForGroup,
    DEFAULT_SWIM_GROUP_ACTION_RESULT,
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
