import { useEffect, useState } from 'react';
import { REGIONEN, VOLLSTAENDIGKEITEN, beschriftung } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { euro, euroMitVorzeichen, anzahl } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function Wert({ route }) {
  const zeigeHinweis = useHinweis();
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [abruf, setAbruf] = useState(null); // { erledigt, gesamt }
  const [nurOhneWert, setNurOhneWert] = useState(false);

  const laden = () => api.werte().then(setDaten).catch((e) => setFehler(e.message));
  useEffect(() => { laden(); }, []);

  async function preiseAbrufen() {
    const gesamt = daten.ohnePreisdaten;
    let erledigt = 0;
    setAbruf({ erledigt, gesamt });
    try {
      for (;;) {
        const r = await api.werteAktualisieren();
        erledigt += r.aktualisiert;
        setAbruf({ erledigt, gesamt: Math.max(gesamt, erledigt + r.offen) });
        if (r.offen === 0 || r.aktualisiert === 0) break;
      }
      zeigeHinweis('Marktpreise aktualisiert.');
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    } finally {
      setAbruf(null);
      laden();
    }
  }

  const liste = daten?.artikel.filter((a) => !nurOhneWert || a.wert == null) ?? [];

  return (
    <Layout route={route} titel="Wert der Sammlung">
      {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
      {!daten && !fehler && <p className="text-leise">Wird geladen …</p>}
      {daten && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kachel titel="Geschätzter Wert" wert={euro(daten.sammlungswert)} gross />
            <Kachel titel="Kaufpreise gesamt" wert={euro(daten.kaufwert)} />
            <Kachel
              titel="Wertentwicklung"
              wert={euroMitVorzeichen(daten.differenz)}
              klasse={daten.differenz > 0 ? 'text-erfolg' : daten.differenz < 0 ? 'text-gefahr' : ''}
              hinweis="nur Artikel mit Kaufpreis und Schätzwert"
              symbol={daten.differenz > 0 ? '▲' : daten.differenz < 0 ? '▼' : null}
            />
            <Kachel titel="Bewertet" wert={`${anzahl(daten.bewertet)} / ${anzahl(daten.gesamt)}`} hinweis="Einträge mit Schätzwert" />
          </div>

          <section className="karte space-y-2 p-4 text-sm">
            <h2 className="font-semibold">Woher kommen die Werte?</h2>
            <ol className="list-decimal space-y-1 pl-5 text-leise">
              <li><strong className="text-text">Eigene Schätzung</strong> – Feld „Marktwert“ am Artikel, hat immer Vorrang.</li>
              <li>
                <strong className="text-text">PriceCharting</strong> – Marktpreise passend zu Region und Vollständigkeit (lose, CIB, neu), in Euro umgerechnet.
                {!daten.priceChartingAktiv && ' Auf diesem Server nicht eingerichtet (PRICECHARTING_TOKEN).'}
              </li>
              <li><strong className="text-text">Community</strong> – Median der Schätzwerte aller Sammler hier (ab 3 Angaben, anonym).</li>
            </ol>
            {daten.priceChartingAktiv && daten.ohnePreisdaten > 0 && (
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button type="button" className="knopf-primaer" onClick={preiseAbrufen} disabled={Boolean(abruf)}>
                  <Symbol name="aktualisieren" className={`size-4 ${abruf ? 'animate-spin' : ''}`} />
                  {abruf ? `Preise werden abgerufen … ${abruf.erledigt}/${abruf.gesamt}` : `Marktpreise für ${daten.ohnePreisdaten} Einträge abrufen`}
                </button>
              </div>
            )}
          </section>

          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Deine Artikel nach Wert</h2>
            <label className="flex items-center gap-2 text-sm text-leise">
              <input type="checkbox" className="accent-akzent" checked={nurOhneWert} onChange={(e) => setNurOhneWert(e.target.checked)} />
              nur ohne Schätzwert
            </label>
          </div>

          {liste.length === 0 ? (
            <p className="karte p-4 text-sm text-leise">{daten.gesamt === 0 ? 'Deine Sammlung ist noch leer.' : 'Keine Einträge.'}</p>
          ) : (
            <ul className="karte divide-y divide-rand overflow-hidden">
              {liste.map((a) => (
                <li key={a.id}>
                  <a href={`#/artikel/${a.id}`} className="flex items-center gap-3 p-3 hover:bg-karte-hover">
                    <Cover url={a.bild_url} typ={a.typ} alt="" className="h-14 w-11 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.titel}{a.anzahl > 1 && <span className="text-leise"> · {a.anzahl}×</span>}</p>
                      <p className="truncate text-xs text-leise">
                        {[a.plattform, beschriftung(REGIONEN, a.region, 'kurz'), beschriftung(VOLLSTAENDIGKEITEN, a.vollstaendigkeit, 'kurz')].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-xs text-leise">
                        {a.besitzer > 1 ? `${a.besitzer} Sammler besitzen das` : 'Nur in deiner Sammlung'}
                        {a.quelle && ` · ${a.quelle}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className="font-bold">{a.gesamtwert != null ? euro(a.gesamtwert) : '–'}</p>
                      {a.kaufpreis != null && <p className="text-xs text-leise">Kauf: {euro(a.kaufpreis * a.anzahl)}</p>}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-leise">
            Alle Werte sind Schätzungen ohne Gewähr. Tatsächliche Verkaufspreise hängen stark von Zustand, Region und Nachfrage ab.
            {' '}<a href="#/statistik" className="underline">Zur Statistik</a>
          </p>
        </div>
      )}
    </Layout>
  );
}

function Kachel({ titel, wert, hinweis, klasse = '', gross, symbol }) {
  return (
    <div className={`karte p-4 ${gross ? 'col-span-2 md:col-span-1' : ''}`}>
      <p className="text-xs font-semibold tracking-wide text-leise uppercase">{titel}</p>
      <p className={`mt-1 font-bold tabular-nums ${gross ? 'text-3xl' : 'text-2xl'} ${klasse}`}>
        {symbol && <span aria-hidden="true" className="mr-1 text-base">{symbol}</span>}{wert}
      </p>
      {hinweis && <p className="mt-0.5 text-xs text-leise">{hinweis}</p>}
    </div>
  );
}
