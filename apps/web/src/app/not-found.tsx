import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">404</p>
        <h1>Pagina niet gevonden</h1>
        <p>De gevraagde route bestaat nog niet in deze nieuwe frontend foundation.</p>
        <Link className="button" href="/">
          Terug naar home
        </Link>
      </section>
    </main>
  );
}
