"use client";

import { useActionState } from 'react';

import {
  DEFAULT_UPDATE_STUDENT_ACTION_RESULT,
  updateStudentAction,
} from '@/lib/student-actions';
import type { StudentDetail } from '@/lib/student-detail';

export function StudentEditForm({ student }: { student: StudentDetail }) {
  const updateStudentForId = updateStudentAction.bind(null, student.id);
  const [state, formAction, isPending] = useActionState(
    updateStudentForId,
    DEFAULT_UPDATE_STUDENT_ACTION_RESULT,
  );

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Voornaam</span>
          <input defaultValue={student.firstName} maxLength={120} name="firstName" required type="text" />
        </label>

        <label className="field">
          <span>Achternaam</span>
          <input defaultValue={student.lastName} maxLength={120} name="lastName" required type="text" />
        </label>

        <label className="field">
          <span>Geboortedatum</span>
          <input
            defaultValue={student.dateOfBirth?.toISOString().slice(0, 10) ?? ''}
            name="dateOfBirth"
            type="date"
          />
        </label>

        <label className="field">
          <span>Niveau</span>
          <input defaultValue={student.swimLevel} maxLength={120} name="swimLevel" required type="text" />
        </label>

        <label className="field">
          <span>Status</span>
          <select defaultValue={student.isActive ? 'true' : 'false'} name="isActive">
            <option value="true">Actief</option>
            <option value="false">Inactief</option>
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Student opslaan...' : 'Wijzigingen opslaan'}
        </button>
      </div>
    </form>
  );
}
