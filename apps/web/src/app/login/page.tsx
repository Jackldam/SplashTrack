import { redirect } from 'next/navigation';

import { LoginForm } from '@/app/login/login-form';
import { getAuthSession } from '@/lib/auth-session';

export default async function LoginPage() {
  const session = await getAuthSession();

  if (session?.user) {
    redirect('/');
  }

  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <p className="eyebrow">Batch 3 foundation</p>
        <h1>Login</h1>
        <p>Better Auth is aangesloten op Prisma en klaar voor verdere uitbouw.</p>
        <LoginForm />
      </section>
    </main>
  );
}
