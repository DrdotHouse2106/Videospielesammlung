// Erfolge (Abzeichen) und Sammlungsziele je Plattform
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { datumDe, anzahl } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

function Balken({ anteil, fertig }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-karte-hover" role="progressbar" aria-valuenow={Math.round(anteil * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${fertig ? 'bg-erfolg' : 'bg-akzent'}`} style={{ width: `${Math.round(Math.min(1, anteil) * 100)}%` }} />
    </div>
  );
}

export default function Erfolge({ route }) {
  const zeigeHinweis = useHinweis();
  const [d, setD] = useState(null);
  useEffect(() => { api.erfolge().then(setD).catch((e) => zeigeHinweis(e.message, 'fehler')); }, []);

  const erreicht = d?.erfolge.filter((e) => e.freigeschaltet_am) ?? [];
  const offen = (d?.erfolge.filter((e) => !e.freigeschaltet_am) ?? []).sort((a, b) => b.stand / b.ziel - a.stand / a.ziel);

  return (
    <Layout route={route} titel="Erfolge" zurueck="/einstellungen">
      {!d ? <p className="text-leise">Wird geladen …</p> : (
        <div className="mx-auto max-w-4xl space-y-4 pb-8">
          <section className="karte space-y-2 p-4">
            <p className="text-2xl font-bold">{d.freigeschaltet} <span className="text-base font-normal text-leise">von {d.gesamt} Erfolgen</span></p>
            <Balken anteil={d.freigeschaltet / d.gesamt} fertig={d.freigeschaltet === d.gesamt} />
          </section>

          {erreicht.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Freigeschaltet</h2>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {erreicht.map((e) => (
                  <li key={e.schluessel} className="karte space-y-1 p-3 text-center">
                    <span className="block text-4xl" aria-hidden="true">{e.symbol}</span>
                    <p className="font-semibold">{e.titel}</p>
                    <p className="text-xs text-leise">{e.beschreibung}</p>
                    <p className="text-[11px] text-erfolg">{datumDe(e.freigeschaltet_am)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold">Noch offen</h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {offen.map((e) => (
                <li key={e.schluessel} className="karte flex items-center gap-3 p-3">
                  <span className="text-3xl opacity-40 grayscale" aria-hidden="true">{e.symbol}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">{e.titel}</p>
                    <p className="text-xs text-leise">{e.beschreibung}</p>
                    <Balken anteil={e.stand / e.ziel} />
                    <p className="text-[11px] text-leise">{anzahl(e.stand)} / {anzahl(e.ziel)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {d.plattformen.length > 0 && (
            <section className="karte space-y-3 p-4">
              <h2 className="font-semibold">Sammlungsziele je Plattform</h2>
              <p className="text-xs text-leise">Deine Spiele im Vergleich zu allen Spielen, die für die Plattform in der Datenbank bekannt sind – die Liste wächst mit jedem neuen Eintrag.</p>
              <ul className="space-y-3">
                {d.plattformen.map((p) => (
                  <li key={p.id} className="space-y-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <a href={`#/katalog?plattform=${p.id}`} className="font-medium hover:underline">{p.name}</a>
                      <span className="text-leise">{anzahl(p.eigene)} von {anzahl(Math.max(p.bekannt, p.eigene))}</span>
                    </div>
                    <Balken anteil={p.eigene / Math.max(1, p.bekannt, p.eigene)} fertig={p.eigene >= p.bekannt} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}
