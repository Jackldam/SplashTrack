"use client";

import { useActionState } from 'react';
import { enrollStudentInCourseAction } from '@/lib/course-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function EnrollStudentInCourseForm({
  courseId,
  enrollableStudents,
}: {
  courseId: string;
  enrollableStudents: Array<{ id: string; displayName: string; swimLevel: string; isActive: boolean }>;
}) {
  const boundAction = enrollStudentInCourseAction.bind(null, courseId);
  const [state, formAction, isPending] = useActionState(boundAction, INITIAL_ACTION_STATE);

  if (enrollableStudents.length === 0) {
    return (
      <div className="empty-state">
        <h4>Geen beschikbare studenten</h4>
        <p>Alle actieve studenten zijn al ingeschreven in deze cursus.</p>
      </div>
    );
  }

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Student</span>
          <select name="studentId" required>
            <option value="">Selecteer een student</option>
            {enrollableStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {student.displayName} ({student.swimLevel})
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Student inschrijven...' : 'Student inschrijven'}
        </button>
      </div>
    </form>
  );
}
