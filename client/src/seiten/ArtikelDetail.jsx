import { useEffect, useState } from 'react';
import {
  ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, beschriftung,
} from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { navigiere } from '../router.js';
import { euro, datumDe } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Abzeichen from '../komponenten/Abzeichen.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function ArtikelDetail({ route, id }) {
  const zeigeHinweis = useHinweis();
  const [artikel, setArtikel] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [laedtBild, setLaedtBild] = useState(false);

  useEffect(() => {
    api.artikel(id).then(setArtikel).catch((e) => setFehler(e.message));
  }, [id]);

  async function loeschen() {
    if (!window.confirm(`„${artikel.titel}“ wirklich aus der Sammlung löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    try {
      await api.artikelLoeschen(id);
      zeigeHinweis('Artikel gelöscht.');
      navigiere('/');
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    }
  }

  async function bildWaehlen(e) {
    const datei = e.target.files?.[0];
    e.target.value = '';
    if (!datei) return;
    setLaedtBild(true);
    try {
      setArtikel(await api.bildHochladen(id, datei));
      zeigeHinweis('Foto gespeichert.');
    } catch (err) {
      zeigeHinweis(err.message, 'fehler');
    } finally {
      setLaedtBild(false);
    }
  }

  async function bildEntfernen() {
    try {
      setArtikel(await api.bildEntfernen(id));
      zeigeHinweis('Eigenes Foto entfernt.');
    } catch (err) {
      zeigeHinweis(err.message, 'fehler');
    }
  }

  if (!artikel) {
    return (
      <Layout route={route} titel="Artikel" zurueck="/">
        {fehler ? <p className="text-gefahr" role="alert">{fehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const angaben = [
    ['Artikeltyp', beschriftung(ARTIKELTYPEN, artikel.typ)],
    ['Plattform', artikel.plattform],
    ['Region', beschriftung(REGIONEN, artikel.region)],
    ['Zustand', beschriftung(ZUSTAENDE, artikel.zustand)],
    ['Vollständigkeit', beschriftung(VOLLSTAENDIGKEITEN, artikel.vollstaendigkeit)],
    ['Farbe', artikel.farbe],
    ['Edition/Variante', artikel.edition],
    ['Modellnummer', artikel.modellnummer],
    ['Seriennummer', artikel.seriennummer],
    ['Barcode', artikel.barcode],
    ['Anzahl', artikel.anzahl > 1 ? `${artikel.anzahl} Stück` : null],
    ['Kaufpreis', artikel.kaufpreis != null ? euro(artikel.kaufpreis) : null],
    ['Kaufdatum', artikel.kaufdatum ? datumDe(artikel.kaufdatum) : null],
    ['Erscheinungsjahr', artikel.erscheinungsjahr],
  ].filter(([, wert]) => wert);

  return (
    <Layout
      route={route}
      titel={artikel.titel}
      zurueck="/"
      aktionen={(
        <a href={`#/artikel/${id}/bearbeiten`} className="rounded-lg p-2 text-leise hover:bg-karte hover:text-text" aria-label="Bearbeiten">
          <Symbol name="stift" />
        </a>
      )}
    >
      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[18rem_1fr]">
        <div className="space-y-3">
          <Cover url={artikel.bild_url} typ={artikel.typ} alt={artikel.titel} className="mx-auto aspect-[3/4] w-2/3 rounded-2xl border border-rand md:w-full" />
          <div className="flex justify-center gap-2">
            <label className={`knopf-sekundaer cursor-pointer px-3 py-1.5 ${laedtBild ? 'opacity-50' : ''}`}>
              <Symbol name="kamera" className="size-4" />
              {laedtBild ? 'Lädt hoch …' : artikel.bild_datei ? 'Foto ersetzen' : 'Foto hinzufügen'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={bildWaehlen} disabled={laedtBild} />
            </label>
            {artikel.bild_datei && (
              <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={bildEntfernen}>Foto entfernen</button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">{artikel.titel}</h2>
            {artikel.plattform && <p className="text-leise">{artikel.plattform}</p>}
            <div className="mt-2"><Abzeichen artikel={artikel} mitZustand /></div>
          </div>

          <dl className="karte divide-y divide-rand">
            {angaben.map(([label, wert]) => (
              <div key={label} className="grid grid-cols-[9rem_1fr] gap-2 px-4 py-2.5 text-sm">
                <dt className="text-leise">{label}</dt>
                <dd className={`break-words ${label === 'Barcode' || label === 'Seriennummer' ? 'font-mono' : ''}`}>{wert}</dd>
              </div>
            ))}
          </dl>

          {artikel.notizen && (
            <section className="karte p-4">
              <h3 className="mb-1 text-sm font-semibold text-leise">Eigene Notizen</h3>
              <p className="text-sm whitespace-pre-wrap">{artikel.notizen}</p>
            </section>
          )}

          <p className="text-xs text-leise">
            Erfasst am {datumDe(artikel.erstellt_am)}
            {artikel.aktualisiert_am !== artikel.erstellt_am && ` · zuletzt geändert am ${datumDe(artikel.aktualisiert_am)}`}
            {artikel.katalog_quelle === 'igdb' && ' · Daten: IGDB.com'}
          </p>

          <div className="flex flex-wrap gap-2">
            <a href={`#/artikel/${id}/bearbeiten`} className="knopf-primaer"><Symbol name="stift" className="size-4" />Bearbeiten</a>
            <button type="button" className="knopf-gefahr" onClick={loeschen}><Symbol name="muell" className="size-4" />Löschen</button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
