'use server';

import {
  createSubOrganizationAction as createSubOrganizationActionImpl,
  updateSubOrganizationAction as updateSubOrganizationActionImpl,
  upsertSubOrganizationMemberAction as upsertSubOrganizationMemberActionImpl,
} from '@/lib/sub-organization-admin';

export async function createSubOrganizationAction(previousState: unknown, formData: FormData) {
  return createSubOrganizationActionImpl(previousState, formData);
}

export async function updateSubOrganizationAction(
  organizationId: string,
  previousState: unknown,
  formData: FormData,
) {
  return updateSubOrganizationActionImpl(organizationId, previousState, formData);
}

export async function upsertSubOrganizationMemberAction(
  organizationId: string,
  previousState: unknown,
  formData: FormData,
) {
  return upsertSubOrganizationMemberActionImpl(organizationId, previousState, formData);
}
