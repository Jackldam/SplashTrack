"use client";

import { useActionState } from 'react';

import { enrollStudentAction } from '@/lib/swim-group-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

type EnrollStudentFormProps = {
  groupId: string;
  enrollableStudents: Array<{
    id: string;
    displayName: string;
    swimLevel: string;
  }>;
};

export function EnrollStudentForm({ groupId, enrollableStudents }: EnrollStudentFormProps) {
  const enrollForGroup = enrollStudentAction.bind(null, groupId);
  const [state, formAction, isPending] = useActionState(
    enrollForGroup,
    INITIAL_ACTION_STATE,
  );

  if (enrollableStudents.length === 0) {
    return (
      <p className="section-note">Alle actieve studenten zijn al ingeschreven in deze groep.</p>
    );
  }

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Student</span>
          <select name="studentId" required>
            <option value="">— Selecteer een student —</option>
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
