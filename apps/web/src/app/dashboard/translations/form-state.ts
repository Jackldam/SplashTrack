export type TranslationFormState = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const initialTranslationFormState: TranslationFormState = {
  status: 'idle',
  message: '',
};
