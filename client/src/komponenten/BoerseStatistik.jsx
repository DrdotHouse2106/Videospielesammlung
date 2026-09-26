// Anbieter-Statistik: Aufrufe, Anfragen und Wunschlisten-Treffer der eigenen Angebote.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { euro } from '../format.js';
import { useHinweis } from './Hinweise.jsx';

const KENNZAHLEN = [
  ['aufrufe', 'Aufrufe', 'Wie oft deine Angebotsseiten geöffnet wurden (je Person und Tag einmal)'],
  ['anfragen', 'Anfragen', 'Neue Unterhaltungen zu deinen Angeboten'],
  ['treffer', 'Wunschlisten-Treffer', 'Sammler, deren Wunschliste zu einem Angebot passte und die benachrichtigt wurden'],
];
const anzahl = (n) => (n ?? 0).toLocaleString('de-DE');
const zeitraumText = (t) => (t === 0 ? 'Gesamt' : t === 365 ? '1 Jahr' : t === 730 ? '2 Jahre' : `${t} Tage`);

function Veraenderung({ jetzt, vorher }) {
  if (vorher === undefined) return null;
  if (!vorher) return jetzt ? <span className="text-xs text-leise">neu im Zeitraum</span> : null;
  const prozent = Math.round(((jetzt - vorher) / vorher) * 100);
  if (prozent === 0) return <span className="text-xs text-leise">wie im Zeitraum davor</span>;
  return (
    <span className={`text-xs ${prozent > 0 ? 'text-erfolg' : 'text-warnung'}`}>
      {prozent > 0 ? '▲' : '▼'} {Math.abs(prozent)} % zum Zeitraum davor
    </span>
  );
}

/** Ohne Händler-Paket: nur Gesamtzahlen als Vorgeschmack. */
function Vorschau({ d }) {
  return (
    <section className="karte space-y-3 p-4 text-sm">
      <h2 className="font-semibold">Statistik zu deinen Angeboten</h2>
      <p>
        In den letzten {d.tage} Tagen wurden deine Angebote <strong>{anzahl(d.gesamt.aufrufe)}×</strong> aufgerufen,
        du hast <strong>{anzahl(d.gesamt.anfragen)}</strong> Anfragen erhalten und <strong>{anzahl(d.gesamt.treffer)}</strong> Sammler
        wurden über einen Wunschlisten-Treffer informiert.
      </p>
      <p className="text-leise">
        Die ausführliche Statistik – Verlauf pro Tag, Werte je Angebot, Anfragequote, Vergleich zum Vorzeitraum und die
        meistgesuchten Titel – ist Teil der Händler-Pakete. Gezählt wird schon jetzt: Nach dem Buchen siehst du sofort den
        bisherigen Verlauf.
      </p>
      {d.haendler
        ? <a className="knopf-primaer w-fit px-3 py-1.5" href="#/boerse/haendler">Händler-Pakete ansehen</a>
        : <a className="knopf-sekundaer w-fit px-3 py-1.5" href="#/boerse/haendler">Als Händler anmelden</a>}
    </section>
  );
}

export default function BoerseStatistik() {
  const zeigeHinweis = useHinweis();
  const [tage, setTage] = useState(30);
  const [kennzahl, setKennzahl] = useState('aufrufe');
  const [aktiv, setAktiv] = useState(null);
  const [d, setD] = useState(null);
  useEffect(() => { api.boerseStatistik(tage).then(setD).catch((e) => zeigeHinweis(e.message, 'fehler')); }, [tage]);
  if (!d) return <p className="text-leise">Wird geladen …</p>;
  if (d.gesperrt) return <Vorschau d={d} />;

  const max = Math.max(1, ...d.verlauf.map((t) => t[kennzahl]));
  const monatlich = d.einheit === 'monat';
  const tagText = (t) => (monatlich
    ? new Date(`${t.tag}-15T12:00:00`).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
    : new Date(`${t.tag}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }));
  const gezeigt = aktiv ?? d.verlauf.at(-1);
  const kennzahlText = KENNZAHLEN.find(([k]) => k === kennzahl)[1];
  const quote = d.gesamt.aufrufe ? `${(Math.round((d.gesamt.anfragen / d.gesamt.aufrufe) * 1000) / 10).toLocaleString('de-DE')} %` : '–';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Zeitraum">
        {d.zeitraeume.map((t) => (
          <button key={t} type="button" className={tage === t ? 'chip-aktiv' : 'chip'} onClick={() => { setTage(t); setAktiv(null); }}>{zeitraumText(t)}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {KENNZAHLEN.map(([k, titel, hinweis]) => (
          <button key={k} type="button" title={hinweis} onClick={() => { setKennzahl(k); setAktiv(null); }}
            className={`karte block p-4 text-left ${kennzahl === k ? 'border-akzent' : 'hover:border-akzent/60'}`} aria-pressed={kennzahl === k}>
            <p className="text-xs font-semibold tracking-wide text-leise uppercase">{titel}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{anzahl(d.gesamt[k])}</p>
            {d.vorher ? <Veraenderung jetzt={d.gesamt[k]} vorher={d.vorher[k]} /> : <span className="text-xs text-leise">{d.seit ? `seit ${new Date(`${d.seit}T12:00:00`).toLocaleDateString('de-DE')}` : 'noch keine Werte'}</span>}
          </button>
        ))}
        <div className="karte p-4" title="Anteil der Aufrufe, aus denen eine Anfrage wurde">
          <p className="text-xs font-semibold tracking-wide text-leise uppercase">Anfragequote</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{quote}</p>
          <span className="text-xs text-leise">Anfragen je Aufruf</span>
        </div>
      </div>

      <section className="karte space-y-2 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">{kennzahlText} pro {monatlich ? 'Monat' : 'Tag'}</h2>
          <p className="text-sm text-leise">
            {tagText(gezeigt)}: <strong className="text-text">{anzahl(gezeigt.aufrufe)}</strong> Aufrufe · {anzahl(gezeigt.anfragen)} Anfragen · {anzahl(gezeigt.treffer)} Treffer
          </p>
        </div>
        <div className="flex h-36 items-end gap-[2px] border-b border-rand" onMouseLeave={() => setAktiv(null)}>
          {d.verlauf.map((t) => (
            <button key={t.tag} type="button" className="group flex h-full min-w-0 flex-1 items-end"
              aria-label={`${tagText(t)}: ${t.aufrufe} Aufrufe, ${t.anfragen} Anfragen, ${t.treffer} Treffer`}
              onMouseEnter={() => setAktiv(t)} onFocus={() => setAktiv(t)} onClick={() => setAktiv(t)}>
              <span className={`block w-full rounded-t-[4px] ${gezeigt.tag === t.tag ? 'bg-akzent-hell' : 'bg-akzent group-hover:bg-akzent-hell'}`}
                style={{ height: `${t[kennzahl] ? Math.max(2, (t[kennzahl] / max) * 100) : 0}%` }} />
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-leise"><span>{tagText(d.verlauf[0])}</span><span>{monatlich ? 'dieser Monat' : 'heute'}</span></div>
      </section>

      <section className="karte space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Deine Angebote im Zeitraum</h2>
        {d.angebote.length === 0 ? <p className="text-leise">Noch keine Aufrufe, Anfragen oder Treffer in diesem Zeitraum.</p> : (
          <ul className="divide-y divide-rand">
            {d.angebote.map((a) => (
              <li key={a.id} className="space-y-0.5 py-2">
                <p className="break-words">
                  {a.geloescht ? <span className="text-leise">{a.titel}</span> : (
                    <a href={`#/boerse/angebot/${a.id}`} className="font-medium hover:underline">{a.titel}{a.plattform_kurz ? ` (${a.plattform_kurz})` : ''}</a>
                  )}
                  {!a.geloescht && a.status !== 'aktiv' && <span className="ml-2 text-xs text-leise">{a.status}</span>}
                </p>
                <p className="text-xs text-leise tabular-nums">
                  {anzahl(a.aufrufe)} Aufrufe · {anzahl(a.anfragen)} Anfragen · {anzahl(a.treffer)} Treffer
                  {a.quote !== null && ` · ${a.quote.toLocaleString('de-DE')} % Anfragequote`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.gefragt.length > 0 && (
        <section className="karte space-y-2 p-4 text-sm">
          <h2 className="font-semibold">Am meisten gesucht</h2>
          <p className="text-leise">So viele Sammler haben deine aktuell angebotenen Titel auf ihrer Wunschliste.</p>
          <ul className="divide-y divide-rand">
            {d.gefragt.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
                <a href={`#/boerse/angebot/${a.id}`} className="min-w-0 flex-1 truncate hover:underline">{a.titel}{a.plattform_kurz ? ` (${a.plattform_kurz})` : ''}</a>
                <span className="shrink-0 text-leise tabular-nums">{a.preis !== null ? `${euro(a.preis)} · ` : ''}{anzahl(a.gesucht_von)} suchen</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-leise">
        Datenschutzfreundlich: Gespeichert werden nur Tageszähler je Angebot – keine Namen, IP-Adressen oder Cookies.
        Eigene Aufrufe und Suchmaschinen zählen nicht. Die Werte bleiben für Langzeitvergleiche erhalten, solange dein Konto besteht.
      </p>
    </div>
  );
}
