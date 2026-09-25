// Marktwert & Verbreitung eines Spiels/Geräts auf der Detailseite.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { euro, preisregion, datumDe } from '../format.js';
import Symbol from './Symbole.jsx';

const STUFEN = [
  ['lose', 'Lose (nur Modul/Disc/Gerät)', (a) => !a || ['nur_geraet', undefined, null, ''].includes(a.vollstaendigkeit)],
  ['cib', 'Komplett (CIB)', (a) => a?.vollstaendigkeit === 'cib' && a?.zustand !== 'neu_ovp'],
  ['neu', 'Neu/OVP', (a) => a?.zustand === 'neu_ovp'],
  ['nur_ovp', 'Nur OVP', (a) => a?.vollstaendigkeit === 'nur_ovp'],
  ['nur_anleitung', 'Nur Anleitung', () => false],
];

export default function WertBox({ artikel, eigenerArtikel }) {
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    if (!artikel.katalog_id) return;
    api.katalogWert(artikel.katalog_id, preisregion(artikel.region), artikel.plattform)
      .then(setDaten).catch((e) => setFehler(e.message));
  }, [artikel.katalog_id, artikel.region, artikel.plattform]);

  if (!artikel.katalog_id) {
    return eigenerArtikel && artikel.marktwert == null ? null : (
      <section className="karte p-4 text-sm">
        <h3 className="mb-1 flex items-center gap-2 font-semibold"><Symbol name="wert" className="size-5" />Wert</h3>
        {artikel.marktwert != null ? <p>Deine Schätzung: <strong>{euro(artikel.marktwert)}</strong></p> : null}
      </section>
    );
  }

  const c = daten?.community;
  const p = daten?.marktpreise;
  return (
    <section className="karte space-y-3 p-4 text-sm">
      <h3 className="flex items-center gap-2 font-semibold"><Symbol name="wert" className="size-5" />Wert & Verbreitung</h3>
      {fehler && <p className="text-gefahr">{fehler}</p>}
      {!daten && !fehler && <p className="text-leise">Wird geladen …</p>}
      {daten && (
        <>
          {eigenerArtikel && artikel.marktwert != null && (
            <p>Deine Schätzung: <strong className="text-base">{euro(artikel.marktwert)}</strong> <span className="text-leise">pro Stück</span></p>
          )}
          {p ? (
            <div>
              <p className="mb-1 text-leise">
                Marktpreise ({p.konsole}) laut PriceCharting
                {daten.abgerufen_am && `, Stand ${datumDe(new Date(daten.abgerufen_am).toISOString())}`}:
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {STUFEN.filter(([feld]) => p[feld]).map(([feld, label, passend]) => (
                  <div key={feld} className={`rounded-lg px-2 py-1 ${eigenerArtikel && passend(artikel) ? 'bg-akzent/15 ring-1 ring-akzent/40' : ''}`}>
                    <dt className="text-xs text-leise">{label}</dt>
                    <dd className="font-semibold tabular-nums">{euro(p[feld])}</dd>
                  </div>
                ))}
              </dl>
              <a href={p.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-akzent-hell underline">Auf PriceCharting ansehen</a>
            </div>
          ) : daten.priceChartingAktiv ? (
            <p className="text-leise">Für dieses Spiel wurden keine Marktpreise gefunden.</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Zahl label="Sammler besitzen das" wert={c.besitzer} />
            <Zahl label="Exemplare insgesamt" wert={c.exemplare} />
            <Zahl label="Median Kaufpreis" wert={c.median_kaufpreis != null ? euro(c.median_kaufpreis) : '–'} />
            <Zahl label="Median Schätzwert" wert={c.median_marktwert != null ? euro(c.median_marktwert) : '–'} />
          </div>
          <p className="text-xs text-leise">Community-Preise werden erst ab {c.mindestanzahl} Angaben angezeigt und sind anonym.</p>
        </>
      )}
    </section>
  );
}

function Zahl({ label, wert }) {
  return (
    <div className="rounded-lg bg-karte-hover px-2 py-1.5">
      <p className="text-base font-bold tabular-nums">{wert}</p>
      <p className="text-xs text-leise">{label}</p>
    </div>
  );
}
