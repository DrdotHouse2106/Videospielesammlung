// Preis-Historie eines Spiels: Marktpreise im Zeitverlauf (Linien) und von Nutzern
// gemeldete Angebote/Verkäufe (Punkte), dazu Tabelle und Meldeformular.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  PREISARTEN, PREISQUELLEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, MARKTPREIS_STUFEN, beschriftung,
} from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { euro, datumDe } from '../format.js';
import Symbol from './Symbole.jsx';
import { useHinweis } from './Hinweise.jsx';

const SERIEN = { lose: 'var(--color-serie-1)', cib: 'var(--color-serie-2)', neu: 'var(--color-serie-3)' };
const TAG_MS = 86_400_000;
const zeit = (datum) => Date.parse(`${datum}T00:00:00Z`);

function runderSchritt(max) {
  const roh = max / 4;
  const basis = 10 ** Math.floor(Math.log10(roh || 1));
  return [1, 2, 2.5, 5, 10].map((f) => f * basis).find((s) => s >= roh) ?? roh;
}

export default function PreisVerlauf({ katalogId, historie, darfMelden, onGeaendert }) {
  const [region, setRegion] = useState('pal');
  const [formOffen, setFormOffen] = useState(false);
  const [tabelle, setTabelle] = useState(false);
  const zeigeHinweis = useHinweis();

  const markt = historie.filter((h) => h.herkunft === 'marktpreis' && h.preisregion === region);
  const meldungen = historie.filter((h) => h.herkunft === 'meldung');
  const regionen = [...new Set(historie.filter((h) => h.herkunft === 'marktpreis').map((h) => h.preisregion))];

  return (
    <section className="karte space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Symbol name="statistik" className="size-5" />Preisverlauf</h3>
        {regionen.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Region der Marktpreise">
            {regionen.map((r) => (
              <button key={r} type="button" onClick={() => setRegion(r)} className={`${region === r ? 'chip-aktiv' : 'chip'} px-2.5 py-1 text-xs`}>
                {r === 'pal' ? 'PAL' : r === 'ntsc' ? 'NTSC-U' : 'NTSC-J'}
              </button>
            ))}
          </div>
        )}
      </div>

      {markt.length + meldungen.length === 0 ? (
        <p className="text-sm text-leise">Noch keine Preisdaten. {darfMelden && 'Hast du ein Angebot gesehen oder etwas verkauft? Melde den Preis!'}</p>
      ) : (
        <Diagramm markt={markt} meldungen={meldungen} />
      )}

      {(markt.length > 0 || meldungen.length > 0) && (
        <button type="button" className="text-sm text-akzent-hell underline" onClick={() => setTabelle((t) => !t)}>
          {tabelle ? 'Tabelle ausblenden' : 'Alle Werte als Tabelle'}
        </button>
      )}
      {tabelle && <Tabelle eintraege={[...markt, ...meldungen].sort((a, b) => b.datum.localeCompare(a.datum))} onGeaendert={onGeaendert} />}

      {!tabelle && meldungen.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-leise">Gemeldete Angebote & Verkäufe</h4>
          <Tabelle eintraege={[...meldungen].reverse().slice(0, 8)} onGeaendert={onGeaendert} />
        </div>
      )}

      {darfMelden && !formOffen && (
        <button type="button" className="knopf-sekundaer" onClick={() => setFormOffen(true)}>
          <Symbol name="plus" className="size-4" />Preis melden
        </button>
      )}
      {formOffen && (
        <MeldeFormular
          onFertig={async (daten) => {
            if (!daten) return setFormOffen(false);
            try {
              await api.preisMelden(katalogId, daten);
              zeigeHinweis('Danke! Der Preis wurde gespeichert.');
              setFormOffen(false);
              onGeaendert?.();
            } catch (e) {
              throw e;
            }
          }}
        />
      )}
      <p className="text-xs text-leise">
        Marktpreise werden bei jedem Abruf (PriceCharting) automatisch gespeichert. Meldungen stammen anonym von Nutzern und sind ohne Gewähr.
      </p>
    </section>
  );
}

function Diagramm({ markt, meldungen }) {
  const huelle = useRef(null);
  const [breite, setBreite] = useState(0);
  const [hover, setHover] = useState(null);
  const hoehe = 240;
  const rand = { oben: 12, rechts: 16, unten: 28, links: 56 };

  useLayoutEffect(() => {
    const beobachter = new ResizeObserver(([e]) => setBreite(Math.max(260, Math.floor(e.contentRect.width))));
    beobachter.observe(huelle.current);
    return () => beobachter.disconnect();
  }, []);

  const { punkte, serien, x, y, yTicks, xTicks } = useMemo(() => {
    const alle = [...markt, ...meldungen];
    let tMin = Math.min(...alle.map((h) => zeit(h.datum)));
    let tMax = Math.max(...alle.map((h) => zeit(h.datum)));
    if (tMax - tMin < 14 * TAG_MS) { tMin -= 7 * TAG_MS; tMax += 7 * TAG_MS; }
    const schritt = runderSchritt(Math.max(...alle.map((h) => h.preis)) * 1.1);
    const yMax = Math.ceil((Math.max(...alle.map((h) => h.preis)) * 1.05) / schritt) * schritt;
    const xf = (t) => rand.links + ((t - tMin) / (tMax - tMin)) * (breite - rand.links - rand.rechts);
    const yf = (p) => rand.oben + (1 - p / yMax) * (hoehe - rand.oben - rand.unten);
    const ser = MARKTPREIS_STUFEN.map((s) => ({
      ...s, farbe: SERIEN[s.value],
      werte: markt.filter((h) => h.art === s.value).sort((a, b) => a.datum.localeCompare(b.datum)),
    })).filter((s) => s.werte.length);
    const pk = [
      ...ser.flatMap((s) => s.werte.map((h) => ({ h, px: xf(zeit(h.datum)), py: yf(h.preis), label: `Marktpreis ${s.label}`, farbe: s.farbe }))),
      ...meldungen.map((h) => ({ h, px: xf(zeit(h.datum)), py: yf(h.preis), label: `${beschriftung(PREISARTEN, h.art)} · ${beschriftung(PREISQUELLEN, h.quelle)}`, meldung: true })),
    ];
    const anzahlX = Math.max(2, Math.floor((breite - rand.links) / 110));
    const xt = Array.from({ length: anzahlX }, (_, i) => tMin + ((tMax - tMin) * i) / (anzahlX - 1));
    const yt = [];
    for (let v = 0; v <= yMax + 0.001; v += schritt) yt.push(v);
    return { punkte: pk, serien: ser, x: xf, y: yf, yTicks: yt, xTicks: xt };
  }, [markt, meldungen, breite]);

  function bewegen(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let bester = null;
    let abstand = Infinity;
    for (const p of punkte) {
      const d = Math.hypot(p.px - mx, (p.py - my) * 0.6);
      if (d < abstand) { abstand = d; bester = p; }
    }
    setHover(abstand < 40 ? bester : null);
  }

  const monat = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });
  const hatAngebot = meldungen.some((m) => m.art === 'angebot');
  const hatVerkauf = meldungen.some((m) => m.art === 'verkauf');

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-leise" aria-label="Legende">
        {serien.map((s) => (
          <li key={s.value} className="flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={s.farbe} strokeWidth="2" strokeLinecap="round" /></svg>
            Marktpreis {s.label}
          </li>
        ))}
        {hatAngebot && <li className="flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>Angeboten</li>}
        {hatVerkauf && <li className="flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" fill="currentColor" /></svg>Verkauft</li>}
      </ul>
      <div ref={huelle} className="relative w-full min-w-0 overflow-hidden">
        {breite > 0 && <svg width={breite} height={hoehe} role="img" aria-label="Preisverlauf in Euro" onPointerMove={bewegen} onPointerLeave={() => setHover(null)} className="block touch-pan-y">
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={rand.links} x2={breite - rand.rechts} y1={y(v)} y2={y(v)} stroke="var(--color-rand)" strokeWidth="1" />
              <text x={rand.links - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--color-leise)">{euro(v).replace(',00', '')}</text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={t} x={x(t)} y={hoehe - 8} fontSize="11" fill="var(--color-leise)"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{monat.format(new Date(t))}</text>
          ))}
          {hover && <line x1={hover.px} x2={hover.px} y1={rand.oben} y2={hoehe - rand.unten} stroke="var(--color-leise)" strokeWidth="1" />}
          {serien.map((s) => (
            <g key={s.value}>
              {s.werte.length > 1 && (
                <polyline fill="none" stroke={s.farbe} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                  points={s.werte.map((h) => `${x(zeit(h.datum))},${y(h.preis)}`).join(' ')} />
              )}
              {/* Endpunkt (bzw. einziger Punkt) mit Ring in Flächenfarbe */}
              {[s.werte[s.werte.length - 1]].map((h) => (
                <circle key={h.id} cx={x(zeit(h.datum))} cy={y(h.preis)} r="4.5" fill={s.farbe} stroke="var(--color-karte)" strokeWidth="2" />
              ))}
            </g>
          ))}
          {meldungen.map((h) => (h.art === 'angebot' ? (
            <circle key={h.id} cx={x(zeit(h.datum))} cy={y(h.preis)} r="4.5" fill="var(--color-karte)" stroke="var(--color-text)" strokeWidth="2" />
          ) : (
            <path key={h.id} transform={`translate(${x(zeit(h.datum))} ${y(h.preis)})`} d="M0 -6 6 0 0 6 -6 0Z" fill="var(--color-text)" stroke="var(--color-karte)" strokeWidth="2" />
          )))}
          {hover && !hover.meldung && <circle cx={hover.px} cy={hover.py} r="5" fill={hover.farbe} stroke="var(--color-karte)" strokeWidth="2" />}
        </svg>}
        {hover && (
          <div className="pointer-events-none absolute z-10 rounded-lg border border-rand bg-flaeche px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(hover.px + 12, breite - 190), top: Math.max(0, hover.py - 60), width: 180 }}>
            <p className="text-base font-bold tabular-nums">{euro(hover.h.preis)}</p>
            <p>{hover.label}</p>
            <p className="text-leise">{datumDe(hover.h.datum)}{hover.h.vollstaendigkeit ? ` · ${beschriftung(VOLLSTAENDIGKEITEN, hover.h.vollstaendigkeit, 'kurz')}` : ''}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Tabelle({ eintraege, onGeaendert }) {
  const zeigeHinweis = useHinweis();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-leise">
            <th className="py-1 pr-2 font-medium">Datum</th>
            <th className="py-1 pr-2 font-medium">Art</th>
            <th className="hidden py-1 pr-2 font-medium sm:table-cell">Details</th>
            <th className="py-1 text-right font-medium">Preis</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-rand">
          {eintraege.map((h) => {
            const details = [beschriftung(REGIONEN, h.region, 'kurz'), beschriftung(ZUSTAENDE, h.zustand), beschriftung(VOLLSTAENDIGKEITEN, h.vollstaendigkeit, 'kurz'), h.notiz]
              .filter(Boolean).join(' · ') || (h.herkunft === 'marktpreis' ? 'PriceCharting' : '');
            return (
            <tr key={h.id}>
              <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">{datumDe(h.datum)}</td>
              <td className="py-1.5 pr-2">
                {h.herkunft === 'marktpreis'
                  ? `Marktpreis ${beschriftung(MARKTPREIS_STUFEN, h.art)}`
                  : <>{beschriftung(PREISARTEN, h.art)} · {h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">{beschriftung(PREISQUELLEN, h.quelle)}</a> : beschriftung(PREISQUELLEN, h.quelle)}</>}
                {details && <span className="block text-xs text-leise sm:hidden">{details}</span>}
              </td>
              <td className="hidden py-1.5 pr-2 text-xs text-leise sm:table-cell">{details}</td>
              <td className="py-1.5 text-right font-semibold whitespace-nowrap tabular-nums">{euro(h.preis)}</td>
              <td className="text-right">
                {h.darf_loeschen && h.herkunft === 'meldung' && (
                  <button type="button" aria-label="Meldung löschen" className="rounded p-1 text-leise hover:text-gefahr"
                    onClick={async () => {
                      if (!window.confirm('Diese Preis-Meldung löschen?')) return;
                      try { await api.preisMeldungLoeschen(h.id); onGeaendert?.(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
                    }}>
                    <Symbol name="muell" className="size-4" />
                  </button>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MeldeFormular({ onFertig }) {
  const [w, setW] = useState({ art: 'angebot', quelle: 'ebay', preis: '', datum: new Date().toISOString().slice(0, 10), vollstaendigkeit: '', zustand: '', region: 'pal_de', url: '', notiz: '' });
  const [fehler, setFehler] = useState({});
  const setze = (f) => (e) => setW((x) => ({ ...x, [f]: e.target.value }));
  const auswahl = (feld, liste, leer) => (
    <select className="eingabe" value={w[feld]} onChange={setze(feld)}>
      {leer && <option value="">{leer}</option>}
      {liste.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return (
    <form className="space-y-3 rounded-xl border border-rand p-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await onFertig(w); } catch (err) { setFehler({ ...err.felder, allgemein: Object.keys(err.felder ?? {}).length ? null : err.message }); }
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="beschriftung">Art</span>{auswahl('art', PREISARTEN)}</label>
        <label><span className="beschriftung">Wo?</span>{auswahl('quelle', PREISQUELLEN)}</label>
        <label><span className="beschriftung">Wann?</span><input type="date" className="eingabe" value={w.datum} onChange={setze('datum')} /></label>
        <label><span className="beschriftung">Preis (€)</span><input className="eingabe" inputMode="decimal" value={w.preis} onChange={setze('preis')} placeholder="z. B. 49,99" /></label>
        <label><span className="beschriftung">Vollständigkeit</span>{auswahl('vollstaendigkeit', VOLLSTAENDIGKEITEN, '– unbekannt –')}</label>
        <label><span className="beschriftung">Zustand</span>{auswahl('zustand', ZUSTAENDE, '– unbekannt –')}</label>
        <label><span className="beschriftung">Region</span>{auswahl('region', REGIONEN, '– unbekannt –')}</label>
        <label className="sm:col-span-2"><span className="beschriftung">Link zum Angebot (optional)</span><input className="eingabe" inputMode="url" value={w.url} onChange={setze('url')} placeholder="https://…" /></label>
        <label className="sm:col-span-3"><span className="beschriftung">Notiz (optional)</span><input className="eingabe" value={w.notiz} onChange={setze('notiz')} maxLength={500} placeholder="z. B. mit Kratzern auf dem Label" /></label>
      </div>
      {Object.values(fehler).filter(Boolean).map((f) => <p key={f} className="text-sm text-gefahr">{f}</p>)}
      <div className="flex gap-2">
        <button type="button" className="knopf-sekundaer" onClick={() => onFertig(null)}>Abbrechen</button>
        <button type="submit" className="knopf-primaer">Preis speichern</button>
      </div>
    </form>
  );
}
