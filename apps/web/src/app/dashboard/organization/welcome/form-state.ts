export type WelcomePageActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const initialWelcomePageActionResult: WelcomePageActionResult = {
  status: 'idle',
  message: '',
};
