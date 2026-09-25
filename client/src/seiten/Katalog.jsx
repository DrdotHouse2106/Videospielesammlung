// Globaler Katalog: Plattformen nach Hersteller, Suche und Liste – auch ohne Anmeldung.
import { useEffect, useState } from 'react';
import { ARTIKELTYPEN } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { navigiere } from '../router.js';
import { anzahl } from '../format.js';
import { nachHersteller, usePlattformen } from '../plattformen.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';

export default function Katalog({ route }) {
  const { benutzer } = useSitzung();
  const p = route.parameter;
  const plattformen = usePlattformen();
  const [suchtext, setSuchtext] = useState(p.q ?? '');
  const [daten, setDaten] = useState(null);
  const plattform = plattformen.find((x) => String(x.id) === p.plattform);
  const zeigeListe = Boolean(p.plattform || p.q || p.typ);

  useEffect(() => {
    if ((p.q ?? '') === suchtext) return undefined;
    const t = setTimeout(() => navigiere('/katalog', { ...p, q: suchtext, seite: undefined }), 300);
    return () => clearTimeout(t);
  }, [suchtext]);

  useEffect(() => {
    if (!zeigeListe) return;
    setDaten(null);
    api.katalogListe({ plattform: p.plattform, q: p.q, typ: p.typ, seite: p.seite }).then(setDaten).catch(() => setDaten({ eintraege: [], gesamt: 0, seite: 1, seiten: 1 }));
  }, [p.plattform, p.q, p.typ, p.seite]);

  return (
    <Layout route={route} titel={plattform ? `Katalog: ${plattform.name}` : 'Katalog'} zurueck={zeigeListe ? '/katalog' : undefined}>
      <div className="space-y-4">
        <label className="relative block">
          <span className="sr-only">Katalog durchsuchen</span>
          <Symbol name="suche" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-leise" />
          <input type="search" value={suchtext} onChange={(e) => setSuchtext(e.target.value)} placeholder="Spiele, Konsolen, Zubehör suchen …" className="eingabe pl-10" />
        </label>

        {zeigeListe && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button type="button" className={!p.typ ? 'chip-aktiv' : 'chip'} onClick={() => navigiere('/katalog', { ...p, typ: undefined, seite: undefined })}>Alle</button>
            {ARTIKELTYPEN.map((t) => (
              <button key={t.value} type="button" className={p.typ === t.value ? 'chip-aktiv' : 'chip'}
                onClick={() => navigiere('/katalog', { ...p, typ: t.value, seite: undefined })}>
                <Symbol name={t.value} className="size-4" />{t.mehrzahl}
              </button>
            ))}
          </div>
        )}

        {!zeigeListe && (
          <div className="space-y-5">
            {nachHersteller(plattformen).map(([hersteller, liste]) => (
              <section key={hersteller}>
                <h2 className="mb-2 text-sm font-semibold tracking-wide text-leise uppercase">{hersteller}</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {liste.map((x) => (
                    <a key={x.id} href={`#/katalog?plattform=${x.id}`} className="karte flex items-center gap-3 p-3 hover:border-akzent/60 hover:bg-karte-hover">
                      <span className="flex h-10 min-w-12 items-center justify-center rounded-lg bg-akzent/15 px-2 text-sm font-bold text-akzent-hell">{x.kurz}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{x.name}</span>
                        <span className="block text-xs text-leise">
                          {anzahl(x.katalog)} im Katalog{benutzer && x.meine ? ` · ${anzahl(x.meine)} bei dir` : ''}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {zeigeListe && !daten && <p className="text-leise">Wird geladen …</p>}
        {zeigeListe && daten && (
          <>
            <p className="text-sm text-leise">{anzahl(daten.gesamt)} Einträge</p>
            {daten.eintraege.length === 0 && <p className="karte p-4 text-sm text-leise">Nichts gefunden.</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {daten.eintraege.map((e) => (
                <a key={e.id} href={`#/katalog/${e.id}`} className="karte flex flex-col overflow-hidden hover:border-akzent/60 hover:bg-karte-hover">
                  <Cover url={e.cover_url} typ={e.typ} alt={e.titel} className="aspect-[3/4] w-full" />
                  <div className="p-3">
                    <p className="line-clamp-2 text-sm font-semibold">{e.titel}</p>
                    <p className="text-xs text-leise">{[e.erscheinungsjahr, e.besitzer ? `${e.besitzer} Sammler` : null].filter(Boolean).join(' · ')}</p>
                  </div>
                </a>
              ))}
            </div>
            {daten.seiten > 1 && (
              <div className="flex items-center justify-center gap-3">
                <button type="button" className="knopf-sekundaer" disabled={daten.seite <= 1} onClick={() => navigiere('/katalog', { ...p, seite: daten.seite - 1 })}>Zurück</button>
                <span className="text-sm text-leise">Seite {daten.seite} von {daten.seiten}</span>
                <button type="button" className="knopf-sekundaer" disabled={daten.seite >= daten.seiten} onClick={() => navigiere('/katalog', { ...p, seite: daten.seite + 1 })}>Weiter</button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
