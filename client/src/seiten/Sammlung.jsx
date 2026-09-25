import { useEffect, useState } from 'react';
import { ARTIKELTYPEN, REGIONEN, ZUSTAENDE, VOLLSTAENDIGKEITEN } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { navigiere } from '../router.js';
import Layout from '../komponenten/Layout.jsx';
import ArtikelKarte from '../komponenten/ArtikelKarte.jsx';
import Symbol from '../komponenten/Symbole.jsx';

const SORTIERUNGEN = [
  { value: 'neueste', label: 'Zuletzt hinzugefügt' },
  { value: 'titel', label: 'Titel (A–Z)' },
  { value: 'plattform', label: 'Plattform' },
  { value: 'preis', label: 'Kaufpreis' },
  { value: 'kaufdatum', label: 'Kaufdatum' },
];

export default function Sammlung({ route }) {
  const filter = route.parameter;
  const [artikel, setArtikel] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [plattformen, setPlattformen] = useState([]);
  const [suchtext, setSuchtext] = useState(filter.q ?? '');
  const [filterOffen, setFilterOffen] = useState(Boolean(filter.plattform || filter.region || filter.zustand || filter.vollstaendigkeit));

  const setzeFilter = (aenderung) => navigiere('/', { ...filter, ...aenderung });

  // Suche mit kurzer Verzögerung übernehmen, damit nicht jede Taste eine Anfrage auslöst.
  useEffect(() => {
    if ((filter.q ?? '') === suchtext) return undefined;
    const t = setTimeout(() => setzeFilter({ q: suchtext }), 300);
    return () => clearTimeout(t);
  }, [suchtext]);

  useEffect(() => {
    const abbruch = new AbortController();
    api.artikelListe(filter, abbruch.signal)
      .then((liste) => { setArtikel(liste); setFehler(null); })
      .catch((e) => { if (e.name !== 'AbortError') setFehler(e.message); });
    return () => abbruch.abort();
  }, [JSON.stringify(filter)]);

  useEffect(() => {
    api.plattformen().then(setPlattformen).catch(() => {});
  }, []);

  const aktiveFilter = ['plattform', 'region', 'zustand', 'vollstaendigkeit'].filter((f) => filter[f]).length;
  const hatFilter = Boolean(filter.typ || filter.q || aktiveFilter);

  return (
    <Layout route={route} titel="Meine Sammlung">
      <div className="space-y-3">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Sammlung durchsuchen</span>
            <Symbol name="suche" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-leise" />
            <input
              type="search"
              value={suchtext}
              onChange={(e) => setSuchtext(e.target.value)}
              placeholder="Titel, Plattform, Farbe …"
              className="eingabe pl-10"
            />
          </label>
          <button
            type="button"
            onClick={() => setFilterOffen((o) => !o)}
            className={`knopf-sekundaer relative px-3 ${filterOffen ? 'border-akzent' : ''}`}
            aria-expanded={filterOffen}
            aria-label="Filter anzeigen"
          >
            <Symbol name="filter" />
            <span className="hidden sm:inline">Filter</span>
            {aktiveFilter > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-akzent text-[11px] text-akzent-text">
                {aktiveFilter}
              </span>
            )}
          </button>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Nach Artikeltyp filtern">
          <button type="button" className={!filter.typ ? 'chip-aktiv' : 'chip'} onClick={() => setzeFilter({ typ: undefined })}>
            Alle
          </button>
          {ARTIKELTYPEN.map((t) => (
            <button
              key={t.value}
              type="button"
              className={filter.typ === t.value ? 'chip-aktiv' : 'chip'}
              onClick={() => setzeFilter({ typ: filter.typ === t.value ? undefined : t.value })}
            >
              <Symbol name={t.value} className="size-4" />
              {t.mehrzahl}
            </button>
          ))}
        </div>

        {filterOffen && (
          <div className="karte grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <Auswahl label="Plattform" wert={filter.plattform} onChange={(v) => setzeFilter({ plattform: v })}
              optionen={plattformen.map((p) => ({ value: p.plattform, label: `${p.plattform} (${p.anzahl})` }))} />
            <Auswahl label="Region" wert={filter.region} onChange={(v) => setzeFilter({ region: v })} optionen={REGIONEN} />
            <Auswahl label="Zustand" wert={filter.zustand} onChange={(v) => setzeFilter({ zustand: v })} optionen={ZUSTAENDE} />
            <Auswahl label="Vollständigkeit" wert={filter.vollstaendigkeit} onChange={(v) => setzeFilter({ vollstaendigkeit: v })} optionen={VOLLSTAENDIGKEITEN} />
            <label>
              <span className="beschriftung">Sortierung</span>
              <select className="eingabe" value={filter.sortierung ?? 'neueste'} onChange={(e) => setzeFilter({ sortierung: e.target.value })}>
                {SORTIERUNGEN.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            {hatFilter && (
              <button type="button" className="knopf-sekundaer sm:col-span-2 lg:col-span-5" onClick={() => { setSuchtext(''); navigiere('/'); }}>
                Alle Filter zurücksetzen
              </button>
            )}
          </div>
        )}

        {fehler && <p className="karte border-gefahr/40 p-4 text-sm text-gefahr" role="alert">{fehler}</p>}

        {artikel === null && !fehler && <Ladeplatzhalter />}

        {artikel?.length === 0 && (
          <div className="karte flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Symbol name={filter.typ ?? 'spiel'} className="size-12 text-leise/60" />
            {hatFilter ? (
              <>
                <p className="font-semibold">Keine passenden Artikel gefunden.</p>
                <p className="text-sm text-leise">Probiere einen anderen Suchbegriff oder setze die Filter zurück.</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">Deine Sammlung ist noch leer</p>
                <p className="max-w-sm text-sm text-leise">
                  Füge dein erstes Spiel, deine erste Konsole oder dein Zubehör hinzu – per Suche, Barcode-Scan oder als eigenen Eintrag.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <a href="#/neu" className="knopf-primaer"><Symbol name="plus" />Hinzufügen</a>
                  <a href="#/neu?scan=1" className="knopf-sekundaer"><Symbol name="scan" />Barcode scannen</a>
                </div>
              </>
            )}
          </div>
        )}

        {artikel?.length > 0 && (
          <>
            <p className="text-sm text-leise">
              {artikel.length === 1 ? '1 Eintrag' : `${artikel.length} Einträge`}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {artikel.map((a) => <ArtikelKarte key={a.id} artikel={a} />)}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function Auswahl({ label, wert, onChange, optionen }) {
  return (
    <label>
      <span className="beschriftung">{label}</span>
      <select className="eingabe" value={wert ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Alle</option>
        {optionen.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Ladeplatzhalter() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-label="Wird geladen …">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="karte aspect-[3/5] animate-pulse" />
      ))}
    </div>
  );
}
