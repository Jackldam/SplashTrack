import { z } from 'zod';

export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1, 'Voornaam is verplicht.').max(120, 'Voornaam is te lang.'),
  lastName: z.string().trim().min(1, 'Achternaam is verplicht.').max(120, 'Achternaam is te lang.'),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .transform((value) => value ?? '')
    .refine((value) => value === '' || !Number.isNaN(Date.parse(value)), {
      message: 'Geboortedatum is ongeldig.',
    }),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']).default('true'),
});

export type CreateStudentInput = {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  swimLevel: string;
  isActive: boolean;
};

export function normalizeCreateStudentInput(input: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  swimLevel: string;
  isActive: 'true' | 'false';
}): CreateStudentInput {
  return {
    firstName: input.firstName.trim().replace(/\s+/g, ' '),
    lastName: input.lastName.trim().replace(/\s+/g, ' '),
    dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
    swimLevel: input.swimLevel.trim(),
    isActive: input.isActive === 'true',
  };
}

export function parseCreateStudentFormData(formData: FormData) {
  const parsed = createStudentSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    dateOfBirth: formData.get('dateOfBirth'),
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige studentgegevens.',
    };
  }

  return {
    success: true as const,
    data: normalizeCreateStudentInput(parsed.data),
  };
}
