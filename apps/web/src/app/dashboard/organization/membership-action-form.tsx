'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';

import { executeOrganizationMembershipAction } from '@/lib/organization-admin-actions';
import {
  DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT,
  ORGANIZATION_ADMIN_ACTIONS,
  type OrganizationAdminActionResult,
} from '@/lib/organization-admin-action-core';

type MembershipActionFormProps = {
  membershipId: string;
  action: 'membership.activate' | 'membership.deactivate';
  label: string;
  disabled?: boolean;
  helperText?: string;
};

export function MembershipActionForm({
  membershipId,
  action,
  label,
  disabled = false,
  helperText,
}: MembershipActionFormProps) {
  const [state, formAction, isPending] = useActionState<OrganizationAdminActionResult, FormData>(
    executeOrganizationMembershipAction,
    DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT,
  );

  const pendingLabel =
    action === ORGANIZATION_ADMIN_ACTIONS.activateMembership ? 'Activeren...' : 'Deactiveren...';

  return (
    <form action={formAction} className="membership-action-form" aria-busy={isPending}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" disabled={disabled || isPending}>
        {isPending ? pendingLabel : label}
      </button>
      {helperText ? <p className="section-note">{helperText}</p> : null}
      {state.status !== 'idle' ? (
        <p
          role="status"
          aria-live="polite"
          className={state.status === 'error' ? 'form-status-error' : 'form-status-success'}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

type MembershipRoleFormProps = {
  membershipId: string;
  currentRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  disabled?: boolean;
  helperText?: string;
};

const ROLE_OPTIONS: MembershipRoleFormProps['currentRole'][] = ['OWNER', 'ADMIN', 'MEMBER'];

export function MembershipRoleForm({
  membershipId,
  currentRole,
  disabled = false,
  helperText,
}: MembershipRoleFormProps) {
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [state, formAction, isPending] = useActionState<OrganizationAdminActionResult, FormData>(
    executeOrganizationMembershipAction,
    DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT,
  );

  useEffect(() => {
    if (state.status === 'success') {
      setSelectedRole(currentRole);
    }
  }, [currentRole, state.status]);

  const hasChanges = useMemo(() => selectedRole !== currentRole, [currentRole, selectedRole]);

  return (
    <form action={formAction} className="membership-role-form" aria-busy={isPending}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="action" value={ORGANIZATION_ADMIN_ACTIONS.updateMembershipRole} />

      <div className="membership-role-row">
        <label className="membership-role-label">
          <span className="sr-only">Nieuwe membership-rol</span>
          <select
            name="nextRole"
            value={selectedRole}
            disabled={disabled || isPending}
            onChange={(event) => setSelectedRole(event.target.value as MembershipRoleFormProps['currentRole'])}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={disabled || isPending || !hasChanges}>
          {isPending ? 'Opslaan...' : 'Sla rol op'}
        </button>
      </div>

      {helperText ? <p className="section-note">{helperText}</p> : null}
      {state.status !== 'idle' ? (
        <p
          role="status"
          aria-live="polite"
          className={state.status === 'error' ? 'form-status-error' : 'form-status-success'}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
