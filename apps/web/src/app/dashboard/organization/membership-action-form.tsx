'use client';

import { useActionState } from 'react';

import {
  DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT,
  executeOrganizationMembershipAction,
  type OrganizationAdminActionResult,
} from '@/lib/organization-admin-actions';

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

  return (
    <form action={formAction} className="membership-action-form">
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" disabled={disabled || isPending}>
        {isPending ? 'Bezig...' : label}
      </button>
      {helperText ? <p className="section-note">{helperText}</p> : null}
      {state.status !== 'idle' ? (
        <p role="status" className={state.status === 'error' ? 'form-status-error' : 'form-status-success'}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
