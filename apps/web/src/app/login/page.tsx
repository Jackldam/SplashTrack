import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/login/login-form';
import { getAuthSession } from '@/lib/auth-session';

type LoginPageProps = {
  searchParams?: Promise<{
    redirectTo?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, resolvedSearchParams] = await Promise.all([getAuthSession(), searchParams]);
  const redirectTo = resolvedSearchParams?.redirectTo || '/dashboard';

  if (session?.user) {
    redirect(redirectTo);
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <p className="eyebrow">SplashTrack</p>
        <h1>Login</h1>
        <p>Log in om het dashboard te openen.</p>
        <LoginForm redirectTo={redirectTo} />
      </section>
    </main>
  );
}
