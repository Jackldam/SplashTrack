"use client";

import { useActionState } from 'react';

import { createCourseAction } from '@/lib/course-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function CourseCreateForm() {
  const [state, formAction, isPending] = useActionState(
    createCourseAction,
    INITIAL_ACTION_STATE,
  );

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Naam</span>
          <input maxLength={120} name="name" required type="text" />
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

        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Beschrijving (optioneel)</span>
          <textarea maxLength={500} name="description" rows={3} />
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Cursus opslaan...' : 'Cursus aanmaken'}
        </button>
      </div>
    </form>
  );
}
