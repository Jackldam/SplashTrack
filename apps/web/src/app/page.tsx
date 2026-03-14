import Link from 'next/link';

import { getAuthSession } from '@/lib/auth-session';
import { appConfig } from '@/lib/env';
import { getBaseUrl } from '@/lib/utils';

export default async function HomePage() {
  const session = await getAuthSession();

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Batch 3 foundation</p>
        <h1>{appConfig.appName}</h1>
        <p>
          Nieuwe Next.js app-root naast de legacy ASP.NET-app. Better Auth is nu gekoppeld aan
          Prisma als technische basis, zonder RBAC- of businessfeatures.
        </p>
        <dl className="meta-grid">
          <div>
            <dt>Environment</dt>
            <dd>{appConfig.nodeEnv}</dd>
          </div>
          <div>
            <dt>Base URL</dt>
            <dd>{getBaseUrl()}</dd>
          </div>
          <div>
            <dt>Health endpoint</dt>
            <dd>/api/health</dd>
          </div>
          <div>
            <dt>Auth endpoint</dt>
            <dd>/api/auth</dd>
          </div>
          <div>
            <dt>Current user</dt>
            <dd>{session?.user.email ?? 'Niet ingelogd'}</dd>
          </div>
        </dl>
        <div className="actions-row">
          <Link className="button" href={session?.user ? '/api/auth/sign-out' : '/login'}>
            {session?.user ? 'Auth routes' : 'Naar login'}
          </Link>
        </div>
      </section>
    </main>
  );
}
