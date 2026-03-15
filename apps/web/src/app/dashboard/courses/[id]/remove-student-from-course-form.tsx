"use client";

import { useActionState } from 'react';
import { removeStudentFromCourseAction } from '@/lib/course-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function RemoveStudentFromCourseForm({
  courseId,
  studentId,
  displayName,
}: {
  courseId: string;
  studentId: string;
  displayName: string;
}) {
  const boundAction = removeStudentFromCourseAction.bind(null, courseId);
  const [state, formAction, isPending] = useActionState(boundAction, INITIAL_ACTION_STATE);

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
        {isPending ? 'Verwerken...' : 'Uitschrijven'}
      </button>
    </form>
  );
}
