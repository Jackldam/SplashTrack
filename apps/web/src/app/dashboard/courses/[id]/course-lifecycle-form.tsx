"use client";

import { useActionState } from 'react';
import { toggleCourseLifecycleAction } from '@/lib/course-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function CourseLifecycleForm({
  courseId,
  isActive,
}: {
  courseId: string;
  isActive: boolean;
}) {
  const boundAction = toggleCourseLifecycleAction.bind(null, courseId);
  const [state, formAction, isPending] = useActionState(boundAction, INITIAL_ACTION_STATE);

  return (
    <form action={formAction}>
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button secondary-button" disabled={isPending} type="submit">
          {isPending
            ? 'Verwerken...'
            : isActive
              ? 'Cursus deactiveren'
              : 'Cursus activeren'}
        </button>
      </div>
    </form>
  );
}
