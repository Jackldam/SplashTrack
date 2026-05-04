import Link from 'next/link';

import { CAPABILITIES, getAuthContext } from '@/rbac/index';
import { appConfig } from '@/shared/env';
import { dictionary, getCopyLanguage, getCurrentLanguage } from '@/shared/i18n';
import { getBaseUrl } from '@/shared/utils';

export default async function HomePage() {
  const [authContext, language] = await Promise.all([getAuthContext(), getCurrentLanguage()]);
  const copy = dictionary[getCopyLanguage(language)];
  const hasOrganizationAdmin = authContext?.capabilities.includes(CAPABILITIES.organizationAdmin) ?? false;

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">{copy.home.eyebrow}</p>
        <h1>{appConfig.appName}</h1>
        <p>{copy.home.intro}</p>
        <dl className="meta-grid">
          <div>
            <dt>{copy.home.environment}</dt>
            <dd>{appConfig.nodeEnv}</dd>
          </div>
          <div>
            <dt>{copy.home.baseUrl}</dt>
            <dd>{getBaseUrl()}</dd>
          </div>
          <div>
            <dt>{copy.home.healthEndpoint}</dt>
            <dd>/api/health</dd>
          </div>
          <div>
            <dt>{copy.home.authEndpoint}</dt>
            <dd>/api/auth</dd>
          </div>
          <div>
            <dt>{copy.home.currentUser}</dt>
            <dd>{authContext?.session.user.email ?? copy.home.notLoggedIn}</dd>
          </div>
          <div>
            <dt>{copy.home.currentRole}</dt>
            <dd>{authContext?.membership?.role ?? copy.home.noMembership}</dd>
          </div>
        </dl>
        <div className="actions-row">
          <Link className="button" href={authContext?.session.user ? '/dashboard' : '/login'}>
            {authContext?.session.user ? copy.home.openDashboard : copy.home.goToLogin}
          </Link>
          {authContext?.session.user ? (
            <>
              {hasOrganizationAdmin ? (
                <Link className="button secondary-button" href="/dashboard/organization">
                  {copy.home.organizationShell}
                </Link>
              ) : null}
              <Link className="button secondary-button" href="/api/auth/sign-out">
                {copy.common.signOut}
              </Link>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
