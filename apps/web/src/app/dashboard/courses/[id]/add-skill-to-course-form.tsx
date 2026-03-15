"use client";

import { useActionState } from 'react';
import { addSkillToCourseAction } from '@/lib/course-actions';

const INITIAL_ACTION_STATE = { status: 'idle' as const, message: '' };

export function AddSkillToCourseForm({
  courseId,
  availableSkills,
}: {
  courseId: string;
  availableSkills: Array<{ id: string; name: string; swimLevel: string; isActive: boolean }>;
}) {
  const boundAction = addSkillToCourseAction.bind(null, courseId);
  const [state, formAction, isPending] = useActionState(boundAction, INITIAL_ACTION_STATE);

  if (availableSkills.length === 0) {
    return (
      <div className="empty-state">
        <h4>Geen beschikbare vaardigheden</h4>
        <p>
          Alle actieve vaardigheden zijn al gekoppeld aan deze cursus, of er zijn nog geen
          vaardigheden aangemaakt.
        </p>
      </div>
    );
  }

  return (
    <form className="student-form" action={formAction}>
      <div className="student-form-grid">
        <label className="field">
          <span>Vaardigheid</span>
          <select name="skillId" required>
            <option value="">Selecteer een vaardigheid</option>
            {availableSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name} ({skill.swimLevel})
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.status === 'error' ? <p className="form-status-error">{state.message}</p> : null}
      {state.status === 'success' ? <p className="form-status-success">{state.message}</p> : null}

      <div className="actions-row">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Vaardigheid koppelen...' : 'Vaardigheid koppelen'}
        </button>
      </div>
    </form>
  );
}
