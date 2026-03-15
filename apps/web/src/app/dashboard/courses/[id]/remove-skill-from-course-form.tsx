"use client";

import { useActionState } from 'react';
import { removeSkillFromCourseAction } from '@/lib/course-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function RemoveSkillFromCourseForm({
  courseId,
  skillId,
  skillName,
}: {
  courseId: string;
  skillId: string;
  skillName: string;
}) {
  const boundAction = removeSkillFromCourseAction.bind(null, courseId);
  const [state, formAction, isPending] = useActionState(boundAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="skillId" value={skillId} />
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      <button
        className="button secondary-button"
        disabled={isPending}
        type="submit"
        aria-label={`Vaardigheid ${skillName} ontkoppelen`}
      >
        {isPending ? 'Verwerken...' : 'Ontkoppelen'}
      </button>
    </form>
  );
}
