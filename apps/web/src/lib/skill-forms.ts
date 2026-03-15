import { z } from 'zod';

export const createSkillSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  description: z.string().trim().max(500, 'Beschrijving is te lang.').optional(),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']).default('true'),
});

export const updateSkillSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  description: z.string().trim().max(500, 'Beschrijving is te lang.').optional(),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']),
});

export type CreateSkillInput = {
  name: string;
  description: string | undefined;
  swimLevel: string;
  isActive: boolean;
};

export type UpdateSkillInput = {
  name: string;
  description: string | undefined;
  swimLevel: string;
  isActive: boolean;
};

export function normalizeSkillName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

export function parseCreateSkillFormData(formData: FormData) {
  const rawDescription = formData.get('description');
  const parsed = createSkillSchema.safeParse({
    name: formData.get('name'),
    description: typeof rawDescription === 'string' && rawDescription.trim() !== '' ? rawDescription.trim() : undefined,
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige vaardigheidsgegevens.',
    };
  }

  return {
    success: true as const,
    data: {
      name: normalizeSkillName(parsed.data.name),
      description: parsed.data.description,
      swimLevel: parsed.data.swimLevel.trim(),
      isActive: parsed.data.isActive === 'true',
    } satisfies CreateSkillInput,
  };
}

export function parseUpdateSkillFormData(formData: FormData) {
  const rawDescription = formData.get('description');
  const parsed = updateSkillSchema.safeParse({
    name: formData.get('name'),
    description: typeof rawDescription === 'string' && rawDescription.trim() !== '' ? rawDescription.trim() : undefined,
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige vaardigheidsgegevens.',
    };
  }

  return {
    success: true as const,
    data: {
      name: normalizeSkillName(parsed.data.name),
      description: parsed.data.description,
      swimLevel: parsed.data.swimLevel.trim(),
      isActive: parsed.data.isActive === 'true',
    } satisfies UpdateSkillInput,
  };
}
