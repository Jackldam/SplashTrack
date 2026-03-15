import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="page-shell">
      <section className="hero-card auth-card">
        <p className="eyebrow">403</p>
        <h1>Toegang geweigerd</h1>
        <p>
          Je bent wel ingelogd, maar je account heeft nog geen passende toegang voor deze route.
        </p>
        <div className="actions-row">
          <Link className="button" href="/dashboard">
            Opnieuw proberen
          </Link>
          <Link className="button secondary-button" href="/">
            Terug naar home
          </Link>
        </div>
      </section>
    </main>
  );
}
