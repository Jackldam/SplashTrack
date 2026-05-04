'use client';

import { type ChangeEvent, useActionState, useEffect, useMemo, useState } from 'react';

import { addLanguage, saveTranslations } from '@/app/dashboard/translations/actions';
import { initialTranslationFormState } from '@/app/dashboard/translations/form-state';
import type { TranslationStore } from '@/shared/translation-store';

function fieldName(key: string, language: string) {
  return `entry:${encodeURIComponent(key)}:${encodeURIComponent(language)}`;
}

function getExportFileName() {
  return `splashtrack-translations-${new Date().toISOString().slice(0, 10)}.json`;
}

export function TranslationEditor({ store }: { store: TranslationStore }) {
  const [saveState, saveAction, isSaving] = useActionState(saveTranslations, initialTranslationFormState);
  const [addState, addAction, isAdding] = useActionState(addLanguage, initialTranslationFormState);
  const [query, setQuery] = useState('');
  const [jsonText, setJsonText] = useState(() => JSON.stringify(store, null, 2));
  const [fileError, setFileError] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const entries = useMemo(() => Object.entries(store.entries).sort(([a], [b]) => a.localeCompare(b)), [store.entries]);
  const exportJson = useMemo(() => JSON.stringify(store, null, 2), [store]);
  const exportHref = useMemo(
    () => `data:application/json;charset=utf-8,${encodeURIComponent(exportJson)}`,
    [exportJson],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCount = entries.filter(([key, entry]) => {
    if (!normalizedQuery) {
      return true;
    }

    return [key, ...store.languages.map((language) => entry[language] ?? '')]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  }).length;

  async function handleJsonFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFileError('');
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.json')) {
      setFileError('Kies een .json bestand.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setFileError('JSON-bestand is te groot. Gebruik maximaal 1 MB.');
      return;
    }

    try {
      setJsonText(await file.text());
    } catch {
      setFileError('Kon het JSON-bestand niet lezen.');
    }
  }

  return (
    <div className="dashboard-stack" data-hydrated={isHydrated} data-testid="translation-editor">
      <section className="dashboard-panel">
        <p className="eyebrow">Translation management</p>
        <h2>Vertalingen beheren</h2>
        <p>
          Beheer taalversies als JSON: exporteer de huidige vertalingen, werk ze buiten de app bij en upload of plak daarna
          een nieuwe versie. Samenvoegen voegt talen/teksten toe zonder bestaande waarden te wissen.
        </p>
        <dl className="meta-grid">
          <div>
            <dt>Talen</dt>
            <dd>{store.languages.join(', ')}</dd>
          </div>
          <div>
            <dt>Vertaalkeys</dt>
            <dd>{entries.length}</dd>
          </div>
        </dl>
      </section>

      <section className="dashboard-panel">
        <div className="section-heading translation-editor-heading">
          <div>
            <h3>JSON exporteren en importeren</h3>
            <p className="section-note">
              Aanbevolen flow: download de JSON, pas taalwaarden aan of voeg talen toe, en importeer terug met validatie.
            </p>
          </div>
          <a className="button" download={getExportFileName()} href={exportHref}>
            JSON downloaden
          </a>
        </div>

        <form action={saveAction} className="translation-form translation-json-form">
          <label className="field">
            <span>JSON-bestand uploaden</span>
            <input accept="application/json,.json" name="translationFile" onChange={handleJsonFile} type="file" />
          </label>
          {fileError ? <p className="form-status-error">{fileError}</p> : null}

          <label className="field">
            <span>JSON plakken of controleren</span>
            <textarea
              className="translation-json-editor"
              name="translations"
              onChange={(event) => setJsonText(event.target.value)}
              rows={16}
              spellCheck={false}
              value={jsonText}
            />
          </label>

          <fieldset className="translation-import-options">
            <legend>Importactie</legend>
            <label>
              <input
                checked={importMode === 'merge'}
                name="visibleImportMode"
                onChange={() => setImportMode('merge')}
                onClick={() => setImportMode('merge')}
                type="radio"
                value="merge"
              />
              Samenvoegen: voeg talen/keys toe en update aangeleverde waarden.
            </label>
            <label>
              <input
                checked={importMode === 'replace'}
                name="visibleImportMode"
                onChange={() => setImportMode('replace')}
                onClick={() => setImportMode('replace')}
                type="radio"
                value="replace"
              />
              Vervangen: overschrijf de volledige vertaalset.
            </label>
          </fieldset>

          <label className="field translation-replace-confirmation">
            <span>Bevestiging voor vervangen</span>
            <input autoCapitalize="characters" name="replaceConfirmation" placeholder="Typ REPLACE" />
          </label>

          <div className="button-row">
            <button className="button" disabled={isSaving || Boolean(fileError)} name="importMode" type="submit" value="merge">
              {isSaving && importMode === 'merge' ? 'Valideren...' : 'JSON valideren en samenvoegen'}
            </button>
            <button className="button" disabled={isSaving || Boolean(fileError)} name="importMode" type="submit" value="replace">
              {isSaving && importMode === 'replace' ? 'Valideren...' : 'JSON valideren en vervangen'}
            </button>
          </div>

          {saveState.status !== 'idle' ? (
            <p className={saveState.status === 'error' ? 'form-status-error' : 'form-status-success'}>
              {saveState.message}
            </p>
          ) : null}
        </form>
      </section>

      <details className="dashboard-panel translation-manual-details">
        <summary>
          <span>
            <strong>Handmatig per key bewerken</strong>
            <small>Voor kleine correcties; JSON import blijft veiliger voor grotere wijzigingen.</small>
          </span>
        </summary>

        <section className="translation-manual-body">
          <div className="dashboard-panel translation-add-panel">
            <h3>Extra taal toevoegen</h3>
            <form action={addAction} className="translation-form">
              <div className="translation-add-grid">
                <label className="field">
                  <span>Taalcode</span>
                  <input
                    aria-describedby="language-help"
                    autoCapitalize="none"
                    inputMode="text"
                    name="language"
                    pattern="[a-z]{2}(-[a-z]{2})?"
                    placeholder="bijv. de, fr, es of pt-br"
                    required
                  />
                </label>
                <button className="button" disabled={isAdding} type="submit">
                  {isAdding ? 'Toevoegen...' : 'Taal toevoegen'}
                </button>
              </div>
              <p className="form-hint" id="language-help">
                Gebruik een ISO-code met twee letters. Regio&apos;s mogen met een koppelteken, bijvoorbeeld <strong>en-gb</strong>.
              </p>
              {addState.status !== 'idle' ? (
                <p className={addState.status === 'error' ? 'form-status-error' : 'form-status-success'}>
                  {addState.message}
                </p>
              ) : null}
            </form>
          </div>

          <div className="dashboard-panel">
            <div className="section-heading translation-editor-heading">
              <div>
                <h3>Vertaalteksten</h3>
                <p className="section-note">
                  Zoek een key en pas per taal direct de tekst aan. Lege velden worden als lege vertaling opgeslagen.
                </p>
              </div>
              <button className="button" disabled={isSaving} form="translation-store-form" type="submit">
                {isSaving ? 'Opslaan...' : 'Vertalingen opslaan'}
              </button>
            </div>

            <form action={saveAction} className="translation-form" id="translation-store-form">
              {store.languages.map((language) => (
                <input key={language} name="languages" type="hidden" value={language} />
              ))}
              {entries.map(([key]) => (
                <input key={key} name="keys" type="hidden" value={key} />
              ))}

              <label className="field translation-search">
                <span>Zoeken</span>
                <input
                  autoComplete="off"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Zoek op key of tekst..."
                  type="search"
                  value={query}
                />
              </label>
              <p className="form-hint">
                {visibleCount} van {entries.length} keys zichtbaar.
              </p>

              <div className="translation-entry-list" data-testid="structured-translation-list">
                {entries.map(([key, entry]) => {
                  const isVisible = !normalizedQuery || [key, ...store.languages.map((language) => entry[language] ?? '')]
                    .join(' ')
                    .toLowerCase()
                    .includes(normalizedQuery);

                  return (
                    <article className="translation-entry-card" hidden={!isVisible} key={key}>
                      <div className="translation-entry-card__header">
                        <span className="translation-key">{key}</span>
                        <span className="translation-language-count">{store.languages.length} talen</span>
                      </div>
                      <div className="translation-language-grid">
                        {store.languages.map((language) => (
                          <label className="field translation-value-field" key={language}>
                            <span>{language}</span>
                            <textarea
                              aria-label={`Vertaling ${key} ${language}`}
                              defaultValue={entry[language] ?? ''}
                              name={fieldName(key, language)}
                              placeholder={`Vertaling voor ${language}`}
                              rows={2}
                            />
                          </label>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </form>
          </div>
        </section>
      </details>
    </div>
  );
}
