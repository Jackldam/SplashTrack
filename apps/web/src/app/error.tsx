'use client';

import { useEffect } from 'react';

import { logger } from '@/lib/logger';

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    logger.error('Unhandled application error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Something went wrong</p>
        <h1>Er is een fout opgetreden.</h1>
        <p>Probeer het opnieuw. Als dit blijft gebeuren, controleer dan de logs.</p>
        <button className="button" type="button" onClick={reset}>
          Opnieuw proberen
        </button>
      </section>
    </main>
  );
}
