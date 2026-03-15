import { z } from 'zod';

export const studentDirectoryStatusFilterSchema = z.enum(['all', 'active', 'inactive']);

const studentDirectoryQuerySchema = z.object({
  status: studentDirectoryStatusFilterSchema.default('all'),
  search: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => {
      const normalized = value?.replace(/\s+/g, ' ') ?? '';
      return normalized.length > 0 ? normalized : undefined;
    }),
});

export type StudentDirectoryStatusFilter = z.infer<typeof studentDirectoryStatusFilterSchema>;

export type StudentDirectoryQuery = {
  status: StudentDirectoryStatusFilter;
  search?: string;
};

export function parseStudentDirectoryQuery(input: {
  status?: string;
  search?: string;
}): StudentDirectoryQuery {
  const parsed = studentDirectoryQuerySchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: 'all',
      search: normalizeStudentDirectorySearch(input.search),
    };
  }

  return parsed.data;
}

export function normalizeStudentDirectorySearch(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, 120);
}

export function buildStudentDirectoryStatusLabel(status: StudentDirectoryStatusFilter) {
  switch (status) {
    case 'active':
      return 'Actief';
    case 'inactive':
      return 'Inactief';
    case 'all':
    default:
      return 'Alle statussen';
  }
}
