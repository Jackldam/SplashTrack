export const STUDENT_DELETE_POLICY = {
  hardDeleteEnabled: false,
  archiveMode: 'deactivate' as const,
  uniquenessIncludesInactiveRecords: true,
  summary:
    'Studentrecords worden in fase 1 niet verwijderd. Deactiveren is de ondersteunde archiveringsflow en identity uniqueness blijft gelden voor actieve én inactieve records.',
  adminGuidance:
    'Gebruik deactiveren om een student uit actieve overzichten te halen zonder studentdata of auditspoor kwijt te raken. Hard delete blijft bewust uitgeschakeld totdat retention- en referentieregels expliciet zijn uitgewerkt.',
} as const;

export function getStudentDeletePolicySummary() {
  return STUDENT_DELETE_POLICY.summary;
}
