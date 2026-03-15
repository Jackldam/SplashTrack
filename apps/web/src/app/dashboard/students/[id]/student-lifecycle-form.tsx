"use client";

import { useActionState } from 'react';

import {
  DEFAULT_STUDENT_LIFECYCLE_ACTION_RESULT,
  updateStudentLifecycleAction,
} from '@/lib/student-actions';
import { resolveStudentLifecycleCopy } from '@/lib/student-lifecycle';
import type { StudentDetail } from '@/lib/student-detail';

export function StudentLifecycleForm({ student }: { student: StudentDetail }) {
  const lifecycleCopy = resolveStudentLifecycleCopy(student.isActive);
  const updateStudentLifecycleForId = updateStudentLifecycleAction.bind(null, student.id);
  const [state, formAction, isPending] = useActionState(
    updateStudentLifecycleForId,
    DEFAULT_STUDENT_LIFECYCLE_ACTION_RESULT,
  );

  return (
    <form className="student-lifecycle-form" action={formAction}>
      <p className="form-hint">{lifecycleCopy.helperText}</p>
      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <button className="button secondary-button" disabled={isPending} type="submit">
        {isPending ? lifecycleCopy.pendingLabel : lifecycleCopy.buttonLabel}
      </button>
    </form>
  );
}
