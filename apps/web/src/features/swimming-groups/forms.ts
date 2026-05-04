import { z } from 'zod';

export const createSwimGroupSchema = z.object({
  name: z.string().trim().min(1, 'Groepsnaam is verplicht.').max(120, 'Groepsnaam is te lang.'),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']).default('true'),
});

export const updateSwimGroupSchema = z.object({
  name: z.string().trim().min(1, 'Groepsnaam is verplicht.').max(120, 'Groepsnaam is te lang.'),
  swimLevel: z.string().trim().min(1, 'Niveau is verplicht.').max(120, 'Niveau is te lang.'),
  isActive: z.enum(['true', 'false']),
});

export type CreateSwimGroupInput = {
  name: string;
  swimLevel: string;
  isActive: boolean;
};

export type UpdateSwimGroupInput = {
  name: string;
  swimLevel: string;
  isActive: boolean;
};

export function normalizeSwimGroupName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

export function parseCreateSwimGroupFormData(formData: FormData) {
  const parsed = createSwimGroupSchema.safeParse({
    name: formData.get('name'),
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige groepgegevens.',
    };
  }

  return {
    success: true as const,
    data: {
      name: normalizeSwimGroupName(parsed.data.name),
      swimLevel: parsed.data.swimLevel.trim(),
      isActive: parsed.data.isActive === 'true',
    } satisfies CreateSwimGroupInput,
  };
}

export function parseUpdateSwimGroupFormData(formData: FormData) {
  const parsed = updateSwimGroupSchema.safeParse({
    name: formData.get('name'),
    swimLevel: formData.get('swimLevel'),
    isActive: formData.get('isActive') ?? 'true',
  });

  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message ?? 'Ongeldige groepgegevens.',
    };
  }

  return {
    success: true as const,
    data: {
      name: normalizeSwimGroupName(parsed.data.name),
      swimLevel: parsed.data.swimLevel.trim(),
      isActive: parsed.data.isActive === 'true',
    } satisfies UpdateSwimGroupInput,
  };
}
