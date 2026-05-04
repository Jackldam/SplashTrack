import type { Metadata } from 'next';
import './globals.css';

import { LanguageSelector } from '@/app/language-selector';
import { appConfig } from '@/shared/env';
import { dictionary, getAvailableLanguages, getCopyLanguage, getCurrentLanguage } from '@/shared/i18n';

export const metadata: Metadata = {
  title: appConfig.appName,
  description: 'Modern Next.js foundation for SplashTrack.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [language, languages] = await Promise.all([getCurrentLanguage(), getAvailableLanguages()]);
  const copy = dictionary[getCopyLanguage(language)];

  return (
    <html lang={language}>
      <body>
        <LanguageSelector initialLanguage={language} label={copy.common.language} languages={languages} />
        {children}
      </body>
    </html>
  );
}
