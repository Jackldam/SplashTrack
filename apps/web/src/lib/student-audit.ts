import { type Prisma } from '@prisma/client';

import type { AuthContext } from '@/lib/authz';
import { prisma } from '@/lib/prisma';

type StudentAuditLogRecord = {
  id: string;
  action: string;
  createdAt: Date;
  actorType: string;
  actorUser: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  metadata: Prisma.JsonValue;
};

export type StudentAuditActivityItem = {
  id: string;
  action: string;
  actionLabel: string;
  createdAt: Date;
  actorType: string;
  actorLabel: string;
  summary: string;
  changes: Array<{
    label: string;
    value: string;
  }>;
  rawMetadata: Prisma.JsonValue;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getScalarMetadataValue(metadata: unknown, key: string) {
  if (!isRecord(metadata)) {
    return null;
  }

  const value = metadata[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : null;
}

function getNestedMetadataRecord(metadata: unknown, key: string) {
  if (!isRecord(metadata)) {
    return null;
  }

  const value = metadata[key];
  return isRecord(value) ? value : null;
}

function formatMetadataValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nee';
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (value === null) {
    return 'Onbekend';
  }

  return null;
}

function buildUpdateChanges(metadata: unknown) {
  const previousStudent = getNestedMetadataRecord(metadata, 'previousStudent');
  const updatedStudent = getNestedMetadataRecord(metadata, 'updatedStudent');

  if (!previousStudent || !updatedStudent) {
    return [];
  }

  const comparableFields = [
    { key: 'firstName', label: 'Voornaam' },
    { key: 'lastName', label: 'Achternaam' },
    { key: 'dateOfBirth', label: 'Geboortedatum' },
    { key: 'swimLevel', label: 'Niveau' },
    { key: 'isActive', label: 'Status actief' },
  ] as const;

  return comparableFields.flatMap(({ key, label }) => {
    const previousValue = formatMetadataValue(previousStudent[key]);
    const nextValue = formatMetadataValue(updatedStudent[key]);

    if (previousValue === nextValue || (!previousValue && !nextValue)) {
      return [];
    }

    return [
      {
        label,
        value: `${previousValue ?? 'Onbekend'} → ${nextValue ?? 'Onbekend'}`,
      },
    ];
  });
}

export function buildStudentAuditActivityItem(log: StudentAuditLogRecord): StudentAuditActivityItem {
  const actorLabel = log.actorUser?.email ?? log.actorType;

  if (log.action === 'student.created') {
    return {
      id: log.id,
      action: log.action,
      actionLabel: 'Aangemaakt',
      createdAt: log.createdAt,
      actorType: log.actorType,
      actorLabel,
      summary: 'Studentrecord aangemaakt binnen de huidige organization.',
      changes: [
        {
          label: 'Niveau',
          value: getScalarMetadataValue(log.metadata, 'swimLevel') ?? 'Onbekend',
        },
        {
          label: 'Startstatus',
          value: getScalarMetadataValue(log.metadata, 'isActive') === 'true' ? 'Actief' : 'Inactief',
        },
      ],
      rawMetadata: log.metadata,
    };
  }

  if (log.action === 'student.updated') {
    const changes = buildUpdateChanges(log.metadata);

    return {
      id: log.id,
      action: log.action,
      actionLabel: 'Bijgewerkt',
      createdAt: log.createdAt,
      actorType: log.actorType,
      actorLabel,
      summary:
        changes.length > 0
          ? 'Studentgegevens gewijzigd met zichtbaar verschil ten opzichte van de vorige versie.'
          : 'Studentgegevens bijgewerkt zonder samenvatbaar veldverschil in de auditmetadata.',
      changes,
      rawMetadata: log.metadata,
    };
  }

  if (log.action === 'student.deactivated' || log.action === 'student.activated') {
    const previousIsActive = getScalarMetadataValue(log.metadata, 'previousIsActive');
    const nextIsActive = getScalarMetadataValue(log.metadata, 'nextIsActive');

    return {
      id: log.id,
      action: log.action,
      actionLabel: log.action === 'student.deactivated' ? 'Gedeactiveerd' : 'Heractiveerd',
      createdAt: log.createdAt,
      actorType: log.actorType,
      actorLabel,
      summary:
        log.action === 'student.deactivated'
          ? 'Student is gearchiveerd via deactiveerflow.'
          : 'Student is opnieuw actief gemaakt.',
      changes:
        previousIsActive || nextIsActive
          ? [
              {
                label: 'Status',
                value: `${previousIsActive === 'true' ? 'Actief' : 'Inactief'} → ${nextIsActive === 'true' ? 'Actief' : 'Inactief'}`,
              },
            ]
          : [],
      rawMetadata: log.metadata,
    };
  }

  return {
    id: log.id,
    action: log.action,
    actionLabel: log.action,
    createdAt: log.createdAt,
    actorType: log.actorType,
    actorLabel,
    summary: 'Audit-event beschikbaar zonder specifieke student-samenvatting.',
    changes: [],
    rawMetadata: log.metadata,
  };
}

export async function getRecentStudentAuditActivity(
  authContext: AuthContext,
  studentId: string,
): Promise<StudentAuditActivityItem[]> {
  if (!authContext.membership) {
    return [];
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      organizationId: authContext.membership.organization.id,
      entityType: 'student',
      entityId: studentId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 8,
    select: {
      id: true,
      action: true,
      createdAt: true,
      actorType: true,
      metadata: true,
      actorUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return auditLogs.map(buildStudentAuditActivityItem);
}
