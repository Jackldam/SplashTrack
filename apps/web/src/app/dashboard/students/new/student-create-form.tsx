"use client";

import { useActionState } from 'react';

import {
  createStudentAction,
  DEFAULT_CREATE_STUDENT_ACTION_RESULT,
} from '@/lib/student-actions';

export function StudentCreateForm() {
  const [state, formAction, isPending] = useActionState(
    createStudentAction,
    DEFAULT_CREATE_STUDENT_ACTION_RESULT,
  );

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Voornaam</span>
          <input maxLength={120} name="firstName" required type="text" />
        </label>

        <label className="field">
          <span>Achternaam</span>
          <input maxLength={120} name="lastName" required type="text" />
        </label>

        <label className="field">
          <span>Geboortedatum</span>
          <input name="dateOfBirth" type="date" />
        </label>

        <label className="field">
          <span>Niveau</span>
          <input maxLength={120} name="swimLevel" required type="text" />
        </label>

        <label className="field">
          <span>Status</span>
          <select defaultValue="true" name="isActive">
            <option value="true">Actief</option>
            <option value="false">Inactief</option>
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Student opslaan...' : 'Student aanmaken'}
        </button>
      </div>
    </form>
  );
}
