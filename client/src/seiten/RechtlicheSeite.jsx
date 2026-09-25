// Impressum, Datenschutz, Nutzungsbedingungen, Sicherheit – für alle lesbar, vom Admin bearbeitbar.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { datumDe } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Markdown from '../komponenten/Markdown.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function RechtlicheSeite({ route, slug }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [seite, setSeite] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [entwurf, setEntwurf] = useState(null); // { titel, inhalt } im Bearbeitungsmodus
  const [vorschau, setVorschau] = useState(false);

  useEffect(() => { api.seite(slug).then(setSeite).catch((e) => setFehler(e.message)); }, [slug]);
  const istAdmin = benutzer?.rolle === 'admin';

  async function speichern() {
    try {
      setSeite(await api.seiteSpeichern(slug, entwurf));
      setEntwurf(null);
      zeigeHinweis('Seite gespeichert.');
    } catch (e) {
      zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler');
    }
  }

  return (
    <Layout route={route} titel={seite?.titel ?? 'Rechtliches'} zurueck={benutzer ? '/einstellungen' : undefined}
      aktionen={istAdmin && seite && !entwurf && (
        <button type="button" className="rounded-lg p-2 text-leise hover:bg-karte hover:text-text" aria-label="Seite bearbeiten"
          onClick={() => setEntwurf({ titel: seite.titel, inhalt: seite.inhalt })}>
          <Symbol name="stift" />
        </button>
      )}>
      <div className="mx-auto max-w-3xl pb-8">
        {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
        {!seite && !fehler && <p className="text-leise">Wird geladen …</p>}
        {seite && !entwurf && (
          <article className="karte p-5 text-sm sm:p-8 sm:text-base">
            <Markdown text={seite.inhalt || '*Diese Seite wurde noch nicht ausgefüllt.*'} />
            <p className="mt-8 text-xs text-leise">Zuletzt geändert am {datumDe(seite.aktualisiert_am)}</p>
          </article>
        )}
        {entwurf && (
          <div className="space-y-3">
            <p className="rounded-xl border border-warnung/40 bg-warnung/10 p-3 text-sm">
              Die Vorlagen sind <strong>keine Rechtsberatung</strong>. Ersetze alle Angaben in [eckigen Klammern] und lass die Texte
              im Zweifel prüfen. Formatierung: <code># Überschrift</code>, <code>**fett**</code>, <code>- Liste</code>, <code>[Text](https://…)</code>.
            </p>
            <label className="block">
              <span className="beschriftung">Titel</span>
              <input className="eingabe" value={entwurf.titel} onChange={(e) => setEntwurf({ ...entwurf, titel: e.target.value })} />
            </label>
            <div className="flex gap-2" role="tablist">
              <button type="button" className={!vorschau ? 'chip-aktiv' : 'chip'} onClick={() => setVorschau(false)}>Bearbeiten</button>
              <button type="button" className={vorschau ? 'chip-aktiv' : 'chip'} onClick={() => setVorschau(true)}>Vorschau</button>
            </div>
            {vorschau
              ? <article className="karte p-5 text-sm"><Markdown text={entwurf.inhalt} /></article>
              : <textarea className="eingabe min-h-[60vh] font-mono text-sm" value={entwurf.inhalt} onChange={(e) => setEntwurf({ ...entwurf, inhalt: e.target.value })} />}
            <div className="flex gap-2">
              <button type="button" className="knopf-sekundaer" onClick={() => setEntwurf(null)}>Abbrechen</button>
              <button type="button" className="knopf-primaer" onClick={speichern}>Speichern & veröffentlichen</button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
