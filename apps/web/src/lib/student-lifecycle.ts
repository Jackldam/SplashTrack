export type StudentLifecycleAction = 'student.activate' | 'student.deactivate';

export type StudentLifecycleActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const DEFAULT_STUDENT_LIFECYCLE_ACTION_RESULT: StudentLifecycleActionResult = {
  status: 'idle',
  message: '',
};

export function resolveStudentLifecycleAction(isActive: boolean): StudentLifecycleAction {
  return isActive ? 'student.deactivate' : 'student.activate';
}

export function resolveStudentLifecycleCopy(isActive: boolean) {
  if (isActive) {
    return {
      action: resolveStudentLifecycleAction(isActive),
      buttonLabel: 'Student deactiveren',
      pendingLabel: 'Student deactiveren...',
      helperText:
        'De student blijft bewaard in de directory en audit-log, maar telt niet meer mee als actief.',
      successMessage: 'Student is gedeactiveerd.',
      auditAction: 'student.deactivated',
      nextIsActive: false,
    } as const;
  }

  return {
    action: resolveStudentLifecycleAction(isActive),
    buttonLabel: 'Student heractiveren',
    pendingLabel: 'Student heractiveren...',
    helperText: 'De student wordt opnieuw actief en telt weer mee in overzichten en level spread.',
    successMessage: 'Student is opnieuw geactiveerd.',
    auditAction: 'student.activated',
    nextIsActive: true,
  } as const;
}
