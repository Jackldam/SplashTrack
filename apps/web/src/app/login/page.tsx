import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/login/login-form';
import { getAuthSession } from '@/lib/auth-session';
import { dictionary, getCopyLanguage, getCurrentLanguage } from '@/lib/i18n';

type LoginPageProps = {
  searchParams?: Promise<{
    redirectTo?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, resolvedSearchParams, language] = await Promise.all([
    getAuthSession(),
    searchParams,
    getCurrentLanguage(),
  ]);
  const copy = dictionary[getCopyLanguage(language)];
  const redirectTo = resolvedSearchParams?.redirectTo || '/dashboard';

  if (session?.user) {
    redirect(redirectTo);
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <p className="eyebrow">SplashTrack</p>
        <h1>{copy.login.title}</h1>
        <p>{copy.login.intro}</p>
        <LoginForm copy={copy.login} redirectTo={redirectTo} />
      </section>
    </main>
  );
}
