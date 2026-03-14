export default function DashboardPage() {
  return (
    <section className="dashboard-panel">
      <p className="eyebrow">Protected route</p>
      <h2>Welkom in de dashboard shell</h2>
      <p>
        Dit is bewust alleen een technische basisroute. Geen adminpanelen, geen businessflows,
        geen feature-specifieke acties.
      </p>

      <div className="status-grid">
        <article>
          <h3>Auth guard</h3>
          <p>Server-side redirect naar login voor unauthenticated verkeer.</p>
        </article>
        <article>
          <h3>RBAC guard</h3>
          <p>Minimale rol/capability-checks via auth-context helper.</p>
        </article>
        <article>
          <h3>Next step</h3>
          <p>Latere batches kunnen featuremodules op deze shell inhaken.</p>
        </article>
      </div>
    </section>
  );
}
