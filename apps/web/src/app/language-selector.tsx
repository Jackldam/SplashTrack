'use client';

import { useState } from 'react';

import { languageCookieName, type Language } from '@/shared/i18n-shared';

const languageLabels: Record<string, string> = {
  nl: 'Nederlands',
  en: 'English',
};

const maxAgeSeconds = 60 * 60 * 24 * 365;

type LanguageSelectorProps = {
  initialLanguage: Language;
  label: string;
  languages: string[];
};

export function LanguageSelector({ initialLanguage, label, languages }: LanguageSelectorProps) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    window.localStorage.setItem(languageCookieName, nextLanguage);
    document.cookie = `${languageCookieName}=${nextLanguage}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <label className="language-selector">
      <span className="language-selector__label">{label}</span>
      <select
        aria-label={label}
        className="language-selector__select"
        onChange={(event) => handleLanguageChange(event.target.value as Language)}
        value={language}
      >
        {languages.map((languageCode) => (
          <option key={languageCode} value={languageCode}>
            {languageLabels[languageCode] ?? languageCode.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
