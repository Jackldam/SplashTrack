import { z } from 'zod';

export const createCourseSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  description: z.string().trim().max(500, 'Beschrijving is te lang.').optional(),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']).default('true'),
});

export const updateCourseSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  description: z.string().trim().max(500, 'Beschrijving is te lang.').optional(),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']),
});

export type CreateCourseInput = {
  name: string;
  description: string | undefined;
  swimLevel: string;
  isActive: boolean;
};

export type UpdateCourseInput = {
  name: string;
  description: string | undefined;
  swimLevel: string;
  isActive: boolean;
};

export function normalizeCourseName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

export function parseCreateCourseFormData(formData: FormData) {
  const rawDescription = formData.get('description');
  const parsed = createCourseSchema.safeParse({
    name: formData.get('name'),
    description: typeof rawDescription === 'string' && rawDescription.trim() !== '' ? rawDescription.trim() : undefined,
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige cursusgegevens.',
    };
  }

  return {
    success: true as const,
    data: {
      name: normalizeCourseName(parsed.data.name),
      description: parsed.data.description,
      swimLevel: parsed.data.swimLevel.trim(),
      isActive: parsed.data.isActive === 'true',
    } satisfies CreateCourseInput,
  };
}

export function parseUpdateCourseFormData(formData: FormData) {
  const rawDescription = formData.get('description');
  const parsed = updateCourseSchema.safeParse({
    name: formData.get('name'),
    description: typeof rawDescription === 'string' && rawDescription.trim() !== '' ? rawDescription.trim() : undefined,
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige cursusgegevens.',
    };
  }

  return {
    success: true as const,
    data: {
      name: normalizeCourseName(parsed.data.name),
      description: parsed.data.description,
      swimLevel: parsed.data.swimLevel.trim(),
      isActive: parsed.data.isActive === 'true',
    } satisfies UpdateCourseInput,
  };
}
