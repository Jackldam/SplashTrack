'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { resetWelcomePage, saveWelcomePage } from '@/app/dashboard/organization/welcome/actions';
import { initialWelcomePageActionResult } from '@/app/dashboard/organization/welcome/form-state';
import { MAX_WELCOME_CARDS, type WelcomePageContent } from '@/lib/welcome-page';

function StatusMessage({ state }: { state: typeof initialWelcomePageActionResult }) {
  if (state.status === 'idle') {
    return null;
  }

  return (
    <p className={state.status === 'error' ? 'form-status-error' : 'form-status-success'} role="status">
      {state.message}
    </p>
  );
}

export function WelcomePageEditor({ content, isDefault }: { content: WelcomePageContent; isDefault: boolean }) {
  const [saveState, saveAction, isSaving] = useActionState(saveWelcomePage, initialWelcomePageActionResult);
  const [resetState, resetAction, isResetting] = useActionState(resetWelcomePage, initialWelcomePageActionResult);
  const cards = Array.from({ length: MAX_WELCOME_CARDS }, (_, index) => content.cards[index]);

  return (
    <div className="dashboard-stack">
      <section className="dashboard-panel">
        <p className="eyebrow">Welcome page</p>
        <h2>Welkomstpagina beheren</h2>
        <p>
          Deze content verschijnt bovenaan het dashboard voor leden van je huidige organisatie. Content wordt per organisatie opgeslagen;
          andere tenants zien alleen hun eigen versie of de standaard fallback.
        </p>
        <p className="section-note">Huidige status: {isDefault ? 'standaard fallback actief' : 'aangepaste organisatiepagina actief'}.</p>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading">
          <div>
            <h3>Content</h3>
            <p className="section-note">Gebruik alleen tekst en veilige links. HTML wordt nergens als HTML gerenderd.</p>
          </div>
          <Link className="button secondary-button" href="/dashboard/organization">
            Terug naar organisatie
          </Link>
        </div>

        <form action={saveAction} className="welcome-form">
          <div className="welcome-form-grid">
            <label className="field">
              <span>Titel</span>
              <input defaultValue={content.title} maxLength={120} name="title" required />
            </label>
            <label className="field">
              <span>Subtitel</span>
              <input defaultValue={content.subtitle ?? ''} maxLength={180} name="subtitle" />
            </label>
          </div>

          <label className="field">
            <span>Bodytekst</span>
            <textarea defaultValue={content.body} maxLength={2000} name="body" required rows={7} />
          </label>

          <div className="welcome-form-grid">
            <label className="field">
              <span>CTA-label</span>
              <input defaultValue={content.ctaLabel ?? ''} maxLength={80} name="ctaLabel" placeholder="Bijv. Open studentoverzicht" />
            </label>
            <label className="field">
              <span>CTA-link</span>
              <input defaultValue={content.ctaHref ?? ''} maxLength={500} name="ctaHref" placeholder="/dashboard/students of https://..." />
            </label>
          </div>

          <div className="welcome-card-editor-list">
            <div>
              <h3>Kaarten</h3>
              <p className="section-note">Maximaal 3 kaarten. Laat een kaart volledig leeg om hem niet te tonen.</p>
            </div>
            {cards.map((card, index) => (
              <fieldset className="welcome-card-fieldset" key={index}>
                <legend>Kaart {index + 1}</legend>
                <div className="welcome-form-grid">
                  <label className="field">
                    <span>Titel</span>
                    <input defaultValue={card?.title ?? ''} maxLength={80} name={`cardTitle${index}`} />
                  </label>
                  <label className="field">
                    <span>Linktekst</span>
                    <input defaultValue={card?.linkLabel ?? ''} maxLength={80} name={`cardLinkLabel${index}`} />
                  </label>
                </div>
                <label className="field">
                  <span>Tekst</span>
                  <textarea defaultValue={card?.body ?? ''} maxLength={240} name={`cardBody${index}`} rows={3} />
                </label>
                <label className="field">
                  <span>Link</span>
                  <input defaultValue={card?.href ?? ''} maxLength={500} name={`cardHref${index}`} placeholder="/dashboard/groups of https://..." />
                </label>
              </fieldset>
            ))}
          </div>

          <div className="button-row">
            <button className="button" disabled={isSaving} type="submit">
              {isSaving ? 'Opslaan...' : 'Opslaan'}
            </button>
            <Link className="button secondary-button" href="/dashboard">
              Preview op dashboard
            </Link>
          </div>
          <StatusMessage state={saveState} />
        </form>
      </section>

      <section className="dashboard-panel subtle-card">
        <div className="section-heading">
          <div>
            <h3>Reset naar standaard</h3>
            <p className="section-note">Verwijdert alleen de aangepaste welkomstpagina van deze organisatie.</p>
          </div>
          <form action={resetAction}>
            <button className="button secondary-button" disabled={isResetting} type="submit">
              {isResetting ? 'Resetten...' : 'Reset naar standaard'}
            </button>
          </form>
        </div>
        <StatusMessage state={resetState} />
      </section>
    </div>
  );
}
