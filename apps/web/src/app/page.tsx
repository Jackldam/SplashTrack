import Link from 'next/link';

import { getAuthContext } from '@/lib/authz';
import { appConfig } from '@/lib/env';
import { getBaseUrl } from '@/lib/utils';

export default async function HomePage() {
  const authContext = await getAuthContext();

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Batch 4 foundation</p>
        <h1>{appConfig.appName}</h1>
        <p>
          Nieuwe Next.js app-root naast de legacy ASP.NET-app. Better Auth draait nu samen met een
          minimale server-side RBAC skeleton en protected dashboard shell.
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
            <dd>{authContext?.session.user.email ?? 'Niet ingelogd'}</dd>
          </div>
          <div>
            <dt>Current role</dt>
            <dd>{authContext?.membership?.role ?? 'Geen membership'}</dd>
          </div>
        </dl>
        <div className="actions-row">
          <Link className="button" href={authContext?.session.user ? '/dashboard' : '/login'}>
            {authContext?.session.user ? 'Open dashboard' : 'Naar login'}
          </Link>
          {authContext?.session.user ? (
            <Link className="button secondary-button" href="/api/auth/sign-out">
              Sign out
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
